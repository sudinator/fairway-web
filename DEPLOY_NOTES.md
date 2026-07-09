# Birdie Num Num — Deploy & Migration Notes

## Convention
- Every database migration's full SQL is pasted **inline in the chat** at delivery
  time (not just shipped in the bundle), so it can be run without opening files.
- Migrations are run **manually** in the Supabase SQL editor, in numeric order.
  Run each new migration once; `create or replace` / `add column if not exists`
  make re-runs safe.
- App code is cumulative: deploying the latest bundle ships all prior code. Only
  the **migrations** must be applied by hand.

## Migration order (run in this sequence)
Baseline (supabase/migrations/): 0001 → 0013. These are the original schema and
core RPCs (groups, members, games, scoring, markers, finish_game, delete_game).

App-authored (migrations/): run after the baseline, in order:
- 0014 round_clock
- 0015 multiuse_group_invites
- 0016 trifecta
- 0017 notifications_lockdown
- 0018 live_scorecard
- 0019 avatars
- 0020 analytics
- 0021 live_teams_stats
- 0022 scorecard_ownership
- 0023 reset_game_scores
- 0024 trifecta_scoring
- 0025 group_roster
- 0026 post_game_rounds
- 0027 admin_group_oversight      (master-admin: all-groups overview + archive/unarchive)
- 0028 admin_support_session      (master-admin: logged enter/exit a group)
- 0029 admin_delete_group         (master-admin: hard-delete a group, preserves rounds)
- 0030 default_group              (designate a default group; stranded users land there)
- 0031 admin_game_repair          (master-admin: force end/reopen/reset/delete/reassign any game)
- 0032 admin_merge_users_groups   (merge groups; ban; revoke invites; list/wipe/merge users)
- 0033 lock_privileged_profile_columns  (CRITICAL: block self-grant of is_admin/banned)
- 0034 enforce_ban_in_access      (fold "not banned" into is_admin/is_group_member/is_group_admin)
- 0035 stroke_basis               (Stroke play: gross vs net total basis)
- 0036 skins_mode                 (individual Skins: carryover vs split)  [REQUIRED for split skins]
- 0037 feedback                   (in-app bug/feature/question table + RLS)  [REQUIRED for the Feedback feature]
- 0038 auth_blocklist             (banned_emails + born-banned profile trigger; ban/wipe sync; default-group refuse; admin_unblock_email)
- 0039 support_session_expiry     (group_members.support_started_at + expire_support_sessions reaper; admin_enter_group stamps + reaps)
- 0040 score_validation           (defense-in-depth value check trigger on game_players)  [OPTIONAL - app UI can't produce bad values; guards only the raw API]
- 0041 live_stroke_trifecta       (live RPC get_live_scorecard now returns trifecta_scoring + stroke_basis)  [REQUIRED for correct live Stroke play / match-scored Trifecta]

### Recent migrations (0035-0041) - notes
- REQUIRED before the matching feature works: 0036 (split skins), 0037 (feedback),
  0041 (live Stroke/Trifecta). Code is safe to deploy ahead of them - it falls back
  to sensible defaults - but the feature is wrong/broken until the migration runs.
- 0038/0039 are operational hardening (keep banned/wiped users out; auto-clear
  forgotten support sessions). Run both. 0038 creates the `banned_emails` table and
  a BEFORE INSERT trigger on `profiles`; 0039 adds a column + reaper and re-creates
  `admin_enter_group`.
- 0040 is optional. RLS already scopes WHO can write a row; this trigger only adds a
  VALUE sanity-check (catches malformed arrays from a hand-crafted API call, not the
  app UI). Test it against a real score write before relying on it.

### Security floor (run + verify)
- 0033 is the critical one: without it any user could `update profiles set is_admin=true`
  on their own row and unlock every admin RPC. Run it first if nothing else.
- 0034 edits the three core access helpers (is_admin, is_group_member, is_group_admin),
  which previously lived ONLY in the live DB — they are now captured here. High blast
  radius: test a suspended account is locked out AND a normal account still works.
- activity_log RLS is correct (admin-only read; insert gated to actor_id=auth.uid()).
  Just confirm row-level security is ENABLED on the table (and on profiles).

### Master-admin oversight set (0027–0030) — notes
- All functions are SECURITY DEFINER and gated by `is_admin()`; they assume the
  live DB already has the `is_admin()` helper (it predates these migrations).
- 0028 adds `group_members.is_support`; 0030 adds `groups.is_default` with a
  partial unique index so only one group can be the default.
- 0028 and 0030 each REPLACE `admin_group_overview()` with a wider return type,
  so they `drop function if exists public.admin_group_overview();` first.
  Always run them in order — running 0030 without 0028 still works (it drops and
  recreates), but the column adds must have happened.
- If `admin_set_group_status` is missing, 0027 wasn't run. If `admin_enter_group`
  is missing, 0028 wasn't run. Etc.

---

# Birdie Num Num — v1.22.0

Full offline/lock resilience for GROUP scoring + penalties/sand in the backup.
NO migration. Built on the restored v1.5.2 core (offline/lock recovery unchanged
in spirit, now extended).

## Gap 1 fixed: penalties & sand are backed up
The local backup now stores penalties and sand alongside scores/putts/fairways,
and the recovery merge restores them. Previously an offline/lock entry could
recover the strokes but lose the penalty/sand metadata.

## Gap 2 fixed: in group scoring, ALL players' scores are backed up & synced
- The scoring device (marker) now writes a local backup for EVERY player it
  scores, not just its own row. So if the marker enters the group's scores with
  no signal or the screen locks, every player's entry is held safely on the
  device.
- Recovery now reconciles EVERY backed-up row, not just "my" row. On reopen, the
  marker's device pushes any holes the DB is missing (offline entries) back up for
  all players.
- New: when the device comes back ONLINE, it reloads and syncs automatically — no
  need to reopen the game.
- Pushing another player's recovered row uses the marker's server-side rights; a
  push that isn't permitted is harmless (the backup is kept, nothing is lost).

## Preserved guarantees
- A backup is NEVER discarded by load(); it only fills holes the DB is missing.
  Real scores always win; nothing is removed by recovery.
- The master reset now clears EVERY local backup for the game on the resetting
  device (including marker-held rows), so a pre-game test wipe leaves nothing to
  resurface. Other devices are untouched — their real scores stay protected.

## How preservation now holds, end to end
- Screen lock mid-entry: synchronous disk backup lands before the network write;
  recovered on reopen. (any player, group or solo)
- No signal: entries held on disk; synced on the next online event or reopen.
  (any player, group or solo)
- App killed: disk backup survives; recovered on relaunch. (any player)

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 130/130 pass (incl. mergeBackupRow recovery + the marker-clobber
  guard reproduction)

## Smoke-test (two devices, the group case this fixes)
1. Device A is the marker. Put A in airplane mode. Enter scores for all players.
2. Kill/relaunch A (still offline) -> scores still shown (from backup).
3. Turn signal back on -> scores sync to the server automatically; Device B sees
   them. Nothing lost.

## v1.54.0 — Yardage backfill (admin tool)
- No migration. No new env var (uses existing GOLF_API_KEY already set for course search).
- After deploy: open the **Courses** tab as an admin -> the "YARDAGE BACKFILL - ADMIN" panel -> **Preview** (no writes) -> review -> **Apply**.
- Writes only favorite_courses.data.tees[].yardages (missing cells only). Nothing else is touched.
- Re-runnable safely (already-filled tees report "nothing to fill").

## v1.54.1 — Yardage editor (admin)
- No migration, no new env var.
- Courses tab -> YARDAGE BACKFILL panel -> section 2 "Fix one course": Load courses -> pick a course.
  - Re-look-up: search golfcourseapi, pick the correct course, "Fill all matching tees" (or map each tee), Save.
  - Manual: type yardages per tee/hole, Save.
- Saving writes only favorite_courses.data.tees[].yardages. external_id is NOT changed.

## v1.59.0 — Group finish posts everyone + mid-round skins switch
- **Migration REQUIRED: `migrations/0045_post_group_rounds.sql`** — run it in the Supabase SQL editor before/at deploy.
  - Adds `post_group_rounds(p_game uuid, p_tee_group int)` (SECURITY DEFINER). Finishing a tee group now posts a round for EVERY player in that group (group scoring: one keeper holds everyone's scores), not just the keeper. Mirrors `post_game_rounds` but scoped to one tee group and callable by any game member. Idempotent.
- No new env var.
- Behavior: "Finish group" now writes all group members' rounds immediately. "End game" still posts everyone via `post_game_rounds`. Both are idempotent (one round per game+user, updated in place).
- Also: skins games can now switch **When a hole ties (Carry over / Halved)** mid-round from the in-game Settings panel; team best-ball skins can also switch **Team score (Best ball / Aggregate)** there. No migration needed for that part (uses existing `skins_mode` / `team_score_mode` columns).
- Retro-fix for the affected Francis Byrne round: re-open the game (organizer) and tap **End game** again — `post_game_rounds` will then post the partners' rounds from the scores already stored on their player rows.

## v1.59.2 — post_group_rounds aligned to the 0044 fix + client date fix
- **Migration renumbered to `migrations/0045_post_group_rounds.sql`** (the earlier 0043 name collided with the existing 0043/0044 already in Supabase). Run it AFTER 0043/0044 — it relies on the unique index on rounds(game_id, user_id) from 0043 for its ON CONFLICT upsert.
- post_group_rounds now mirrors the fixed post_game_rounds (0044): stamps the game's MATCH date (games.played_at), and uses ON CONFLICT (game_id, user_id) DO UPDATE so concurrent group finishes can't abort the post with a unique violation.
- Client fix: recordMyGameRound now stamps the match date (game.played_at) instead of the creation timestamp — restores the v1.53.1 behavior that an earlier working copy had reverted, and keeps the client consistent with both RPCs.
- Repo hygiene: 0044_post_game_rounds_fix.sql re-added to the repo so bundles carry it. (0043 is still only in your live DB + local repo; paste it anytime and I'll fold it in.)

## v1.60.0 — Change game structure mid-round (setup tab)
- No migration, no new env var.
- The Game setup tab (organizer) now exposes the structural choices that were previously only available at New game:
  - Skins: a "Skins style" selector — Individual / 1:1 Teams / 2v2 Best-ball. Switching is score-preserving; Individual clears teams/foursomes/pairings (with a confirm when scores exist), the team styles hand off to the Teams/Matchups steps to assign sides.
  - Match: a "Players" selector — Individual / Team (4 v 4).
- All changes write live to the game and standings recompute; no scores are touched.
- NOTE: this is the setup-tab half. The New-game picker still uses its own controls; converging both onto one shared component (so they can't drift again) is the planned next step.

## v1.60.2 — Preserve-and-hide for structure switches
- **Migration REQUIRED: `migrations/0046_structure_stash.sql`** — adds games.structure_stash (jsonb). Run before/at deploy.
- Switching a skins game between Individual / 1:1 Teams / 2v2 Best-ball, and a match between Individual / Team, now STASHES the team structure (teams/foursomes/pairings) instead of discarding it. Switching back restores it intact — matchups reappear filled in. Player team assignments live on game_players and were never touched, so they survive too.
- Plain game_type switches already preserved structure (setFormat never clears); this brings the skins/match sub-toggles in line.
- No behavior change for legacy games (stash starts null; first switch populates it).

## v1.62.0 — game-shape module + tests
- No migration. Pure refactor: shapeOf/dotStrokes/chBasis/pkey moved to lib/game-shape.ts; tournaments.tsx imports them.
- New: `npm test` runs lib/game-shape.test.ts (no extra deps; uses tsc + node). Run it before shipping format/scoring changes.

## v1.66.1 — Offline Phase 3 hardening (no migration)
No schema change; deploy is code-only.
- **Drain-before-finish:** Finishing a tee group (finishMyGroup) and ending a game (endGame) now `await drainOutbox()` and re-check `countPending()` AFTER the requireOnline guard. If any holes still haven't uploaded, the action is blocked with a prompt to Sync now and retry — so a round is never recorded from pre-sync server state (which would drop late offline holes).
- **Reset/wipe coherence:** the load() reset branch now also clears the row's synced watermark (clearSyncedWatermark) when it discards a pre-reset backup, so a stale “already synced” marker can't suppress re-pushing fresh post-reset scores. deleteGame now calls clearAllGameScores(gameId) + clearActiveGame() so a deleted game leaves no snapshot/backups/watermarks/active-pointer behind. (resetGame already wiped local via clearAllGameScores.)

## v1.69.0 — Avatars everywhere (migration 0047)
**Run migration 0047_live_avatar.sql** in the Supabase SQL editor before/at deploy. It recreates get_live_scorecard (from 0041) with one added field, 'avatar_url' (from the existing denormalized game_players.avatar_url column — no new columns). Without it the public live page falls back to initials for everyone.
App changes (no data): profile photos (or initials) now also render on the game leaderboard was already present; added to the skins leaderboards, singles match header, match result cards, team strips, and the public live leaderboard. Native <select> pickers and dense per-hole scorecard columns intentionally left text-only.


## Backfill — app-only releases (no migration unless noted)
These shipped between the migration/structural entries above and were not individually noted here; recorded now to keep DEPLOY_NOTES in sync with BACKLOG.
- v1.66.0 group share-to-chat card; v1.66.2 horizontal individual share card.
- v1.67.0 dashboard "How you compare" card; v1.67.1 compare-card readability.
- v1.68.0 avatars in groups + directory.
- v1.69.1 tee reminder (later moved); v1.69.2 course-library per-tee yardage.
- v1.70.0 team/match Group results segment summary; v1.70.1 tee moved under group-scorecard profile.
- v1.71.0 dashboard click-a-stat TREND chart (bars + rolling averages).
- v1.71.1 fixes: Stableford trend estimates instead of plotting 0 for gross-only rounds; de-duplicated Group-results columns on <18-hole games; avatars added to Group-results rows; removed dead dashboard perRound helper; this backfill.
Migrations remain: 0045 post_group_rounds, 0046 structure_stash, 0047 live_avatar (documented above) — run in order in the Supabase SQL editor.


## v1.72.0 — Money foundation (migration 0048)
**Run migration 0048_money.sql** in the Supabase SQL editor (idempotent; safe to run now even though the Money UI lands in the next release). Creates group_guests, expenses, expense_shares, settlements, and adds venmo_handle/paypal_handle/phone to profiles, all RLS-gated by active group membership. No app screens use these yet — this release ships the tested money logic (lib/money.ts) and the schema; the Money tab follows. Outstanding migrations to run in order: 0045, 0046, 0047, 0048.

## v1.75.0 — Multiple payers (migration 0049)
**Run migration 0049_expense_payers.sql** in the Supabase SQL editor (idempotent; run after 0048). Adds the expense_payers table (who paid, how much) + RLS. Existing single-payer expenses keep working via the payer_user_id fallback. Outstanding migrations in order: 0045, 0046, 0047, 0048, 0049.

## v1.76.0 — Phase 2 (migration 0050)
**Run migration 0050_expense_audit.sql** (idempotent; after 0049). Adds expense_audit for per-expense edit history + RLS. Category summary needs no migration. Outstanding migrations in order: 0045, 0046, 0047, 0048, 0049, 0050.

## v1.77.0 — Group activity log (migration 0051)
**Run migration 0051_group_activity.sql** (idempotent; after 0050). Immutable, group-wide money log visible to all members (the 'Log' tab in Money). Logs expense create/edit/delete, settlements, and guest adds. expense_audit (0050) is now unused for logging (per-expense history reads from group_activity); the 0050 table can stay in place harmlessly. Outstanding migrations in order: 0045, 0046, 0047, 0048, 0049, 0050, 0051.

## v1.77.1 — Fix: Money member visibility (migration 0052)
**Run migration 0052_group_pay_roster.sql** (idempotent; after 0051). profiles RLS was hiding other members from non-admins, so the Money split/payer lists collapsed to just yourself. Adds a SECURITY DEFINER group_pay_roster() returning every active member's id/name/avatar + venmo/paypal/phone (guarded by is_group_member). The app falls back to the old direct query if 0052 isn't run, but the full roster only appears once it is. Run order: 0045..0052.

## v1.79.0 — Group results: legs & team points
Run migration **0053_leg_config.sql** in Supabase SQL editor (adds `games.leg_config jsonb`, idempotent). Run order is now 0045 → 0053. No other steps; existing games default to leaderboard-only until an organizer assigns leg points in setup.

## v1.80.0 - Money: simplify toggle
Run migration **0054_money_simplify.sql** (adds groups.money_simplify boolean default true, idempotent). Run order now 0045 -> 0054. Existing groups default to fewest-payments (current behavior).

## v1.81.0 - Money: Zelle
Run migration **0055_zelle.sql** (adds profiles.zelle_handle, redefines group_pay_roster to return it; idempotent). Run order now 0045 -> 0055.
- Run migration 0056_expense_source.sql (adds expenses.source_game_id + source_kind + one-bet-per-game index) before the Betting→Money post button is used.
- Run migration 0057_tee_times.sql (creates tee_times + tee_time_rsvps + RLS) before the Tee Times UI ships.
- Tee Times UI (v1.86.0) is live in the More menu for the TGC group only. Migration 0057 MUST be run first or the tab will error on load.
- Run migration 0058_rounds_soft_delete.sql (adds rounds.deleted_at) so deleting a game round sticks instead of being re-posted.
- IMPORTANT: run 0058_rounds_soft_delete.sql. Without it the rounds list still loads (v1.87.3 falls back to unfiltered), but soft-deleted rounds won't be hidden until the column exists.

## v1.89.0 — Tee Times P3 (notifications/reminders + activity log)
- **NO migration.** Reuses the existing `group_activity` table (0051) for the audit trail and adds no schema. Nothing to run in Supabase for this release.
- Deadline reminder is a **WhatsApp export with a deep link** (organizer taps "Copy reminder for WhatsApp" on the tee-time detail → pastes to the group). The link is `https://birdienumnum.vercel.app/?tt=<tee_time_id>` and opens the app straight on that tee time's RSVP window. Deep-link plumbing added in `app/page.tsx` (stashes `?tt=` to localStorage before auth, cleans the URL) and `components/home.tsx` (reads it once, switches to the Tee Times tab, passes `initialTeeId`).
- **Activity logging** to `group_activity` with `tt_`-prefixed actions: `tt_posted`, `tt_cancelled`, `tt_rsvp` (self), `tt_rsvp_org` (organizer set on someone's behalf, records target), `tt_promote`, `tt_captain`. Each carries `meta.{tee_time_id, seq, ...}`. New **Activity** sub-tab on the tee-time detail shows that tee time's history (resolves "but I signed up" disputes). `components/money.tsx` now excludes `tt%` actions from the Money log (`.not("action","like","tt%")`) so they don't bleed into it.
- UI: the shared `Eyebrow` (components/ui.tsx) gained an optional `style` prop (backward-compatible); Tee Times uses it to space the gold section labels (list "All upcoming/Past/Cancelled" and Signups "In/Maybe/Out/Not responded"), which were flush against the cards.
- Verified locally: `tsc --noEmit` clean, 174 tests pass, `next build` compiles successfully (prerender needs the Supabase env vars, as always).

## v1.90.0 — Tee Times P4 (round → game handoff) + tee/format defaults
- **NO migration.** Uses `tee_times.game_id` (already exists, migration 0057) and `group_activity` (0051). Nothing to run.
- **Handoff:** the tee-time detail (organizer) shows **"Create game from this tee time"** when no game is linked and the IN list is non-empty; once linked it shows **"Open linked game"** (never double-creates). "Create" hands a seed up through `home.tsx` (new one-shot `gameSeed`/`openGameId`, cleared on leaving the Games tab — mirrors `moneyInitialTab`) → `Tournaments` opens Create Game prefilled with the course (+ default tee), the play date, and the IN-list members preselected. The organizer picks format/tee/allowance and creates as normal; on create the game id is written to `tee_times.game_id` and a `tt_game_linked` row is logged. **Group/tee-group assignment stays manual** (done in game setup) and **guests are added manually** in review (no per-guest handicap edit UI, so they're not seeded).
- **Tee default (TGC only):** picking a course now defaults the tee to a "member" tee by name, else the tee whose total yardage is closest to 6400, else the first tee (`defaultTeeIdx` in tournaments.tsx; gated on `TGC_GROUP_ID`). Format already defaults to Stableford / 100% app-wide, so a TGC handoff opens with that.
- **Activity log** now shows the **year** in each timestamp (e.g. "Jul 3, 2026, 9:14 PM"), visible to all members on the tee-time Activity sub-tab.
- Verified locally: `tsc --noEmit` clean, 174 tests pass, `next build` compiles successfully.

## v1.91.0 — Tee Times: guest carry-forward + drop-a-guest (waitlist)
- **NO migration.** Uses existing tables only.
- **Guest carry-forward (corrects v1.90.0):** the P4 handoff now carries the tee time's IN-list guests into Create Game as guest players. Guests with no handicap on file come in flagged "NEEDS HCP" with an inline index field; the organizer can fill it or leave it (they're still created and play off scratch). `GameSeed.guestNames` now populated from `ins[].guest_names`; guest `course_handicap` is null-guarded.
- **Drop a guest for the waitlist:** on the Signups tab, an organizer sees each IN member's guests as removable chips; removing one frees exactly one spot and the next waitlisted member moves into the field automatically (field/waitlist recomputes by signup order). Logged as `tt_guest_removed`; the host member gets a notification that their guest was removed.
- Verified locally: `tsc --noEmit` clean, 174 tests pass, `next build` compiles successfully.

## v1.92.0 — Betting: include/exclude a player (amateur-in-a-pro-event)
- **RUN migration 0059_game_players_bets.sql** (adds `game_players.bets boolean not null default true` + the `set_player_bets` organizer-gated RPC). Run after 0058. Full SQL is printed in chat.
- New games: **TGC members default IN**, **guests default OUT** (guest rows insert `bets=false`). Existing rows default `true` (past games unchanged).
- The game's Betting panel "Who's betting" toggles now **persist** to `game_players.bets` (organizer/admin only; buttons disabled for others) via `set_player_bets`. Realtime on `game_players` refreshes the room so the banners stay in sync.
- Excluded players **still play and appear on the leaderboard** (tagged "no bet", $0). The pot and all payouts are computed over bettors only, so an excluded player who posts the low score simply hands 1st to the next betting player. The clean-sweep watch / achieved banners now **follow the money** (bettors only) via `segWinnersBet`/`segTotalsBet`; the standings still show everyone's scores. The Money post already reflects bettors only.
- Verified locally: tsc clean, tests pass (incl. new bettor-only cases), build clean.

## v1.93.0 — Betting→Money Phase 2 (re-post corrected winnings)
- **NO migration.** Uses existing tables/RPCs.
- When scores change after winnings were posted, the game now detects that the posted bet expense no longer matches the current scores. The Betting panel (organizer) shows **"Scores changed since posting → Review & re-post"** with a per-bettor old→new preview; the play view shows a room-level **"Posted bet winnings are out of date"** banner (visible right after an edit), and the organizer is notified (group_activity `bet_stale` + best-effort push).
- **Re-post = net-balance model (no payment reversal):** it deletes the old linked bet expense and posts the corrected one. Settlements are group-level, so they're untouched and `computeBalances` reconciles automatically — anyone who overpaid the old amount now shows as **owed back** in Money; the residual settles through the normal Settle flow. Logged as `bet_reposted` with old→new.
- **Bug fix (from v1.92.0):** the "keep bettor list in sync" effect was re-adding new players unconditionally, which pulled guests (bets=false) back into the bet. It now only auto-includes players whose `bets !== false`, so guests stay out by default.
- Verified locally: tsc clean, all tests pass, build clean.

## v1.93.1 — Bug-fix sweep (code-only, NO migration)
Five fixes from a fresh code review:
- **#1 Re-post rollback:** if the corrected splits fail to save during a re-post, the new expense is now deleted so you end up cleanly *un-posted* rather than with a half-written entry that would compute wrong balances. (Matches the original post's rollback.)
- **#2 Organizer mark-out clears guests:** when the organizer marks a member Out/Maybe, their guests are cleared (matching a member's own RSVP), so guests don't linger on the row or reappear if the member is later marked back In.
- **#5 One source of truth for "who's betting":** the payout panel now derives the bettor list from the persisted `bets` flag — the same source the clean-sweep banners use — so they can never disagree. Toggling optimistically updates the shared player list and persists via `set_player_bets`. (Removed the separate in-memory list + its sync effect.)
- **#7 Fresh stale-notify per episode:** the "organizer notified winnings are stale" guard now resets once winnings are corrected, so a *second* stale episode on the same game re-notifies (still never spamming within one episode).
- **Round-delete warning:** deleting a round that came from a game now shows a confirm clarifying it only removes it from personal history/handicap and does NOT change the game result or posted winnings.
- Left as-is by decision: #3 (captains already control their own game's money), #4 (poster/creator + group admin own money entries), #6 (guarded a non-scenario — the bet field is set before posting).
- Verified: tsc clean, all tests pass, build clean.

## v1.93.2 — Tee-time reliability sweep (RUN migration 0060)
- **RUN migration 0060_tee_seq.sql** (unique index on (group_id, seq) + `assign_tee_seq` BEFORE INSERT trigger). Full SQL printed in chat. Run after 0059.
  - Heads-up: the unique index will fail to create if a group already has two tee times sharing a number (from a past browser-numbering collision). If it errors, resolve the duplicate seq first, then re-run.
- **#1 Organizer actions now surface errors:** RSVP, organizer mark-in/out, cancel, captain assign, waitlist promote, and remove-guest now capture the Supabase error. On failure they show a message (dismissible banner in the detail view; alert for a member's own RSVP) and **skip the success activity-log entry and any navigation** — no more silent "looks like it worked."
- **#2 Collision-safe numbering:** the tee-time number is now assigned by the database atomically (per-group advisory lock, max()+1) instead of computed in the browser, so two organizers posting at once can't get the same number. The form still shows a best-guess preview; the DB number is authoritative and used in the activity log.
- **#3 Max-spots validation:** blank now means the 60-player max (not "unlimited"); the field accepts a whole number 1–60 only (input has min/max/step, and `post()` rejects 0/negatives/non-integers with a clear message). Fixes the old `parseInt || null` footgun where 0 became "no limit" and negatives broke capacity.
- **Waitlist wording:** the "you'll join the waitlist" copy now explains you're still signed up and will move into the field automatically. Waitlisted members show **"Waitlist #N"** (position), and your own response line shows **"In the field"** or **"Waitlist #N"**. Model unchanged (position stays computed from signup order — that's what makes auto-promotion clean).
- Verified: tsc clean, all tests pass, build clean.

## v1.94.0 — Randomize groups (keeps guests with their sponsor) — RUN migration 0061
- **RUN migration 0061_guest_sponsor_groups.sql** (adds `game_players.guest_of` + the `set_tee_groups` batch RPC). Full SQL printed in chat. Run after 0060. Idempotent.
- **Guests now carry a sponsor.** A new `guest_of` column records which member invited each guest, populated on every guest-add path: (1) creating a game from a tee time attributes each guest to the member whose RSVP listed them; (2) the create-flow and (3) the in-game "Add guest" both have a **"Guest of…"** picker (defaults to the person adding) and a **"Add a past guest…"** quick-pick sourced from the group's shared guest list (`group_guests`), which also stays in sync when a brand-new guest is added. In-game guests are now correctly inserted with `bets = false` (a latent bug — previously they defaulted into the money game).
- **🎲 Randomize groups** (Stableford/stroke setup, in the Groups step): shuffles the field into balanced foursomes and writes every tee group in one transaction via `set_tee_groups`. A member and the guests they sponsored stay in the same foursome. Sizes come out balanced (5 → [3,2], 10 → [4,3,3]; never a lone single when avoidable) and no group ever exceeds four.
- **Overflow rule:** a sponsor keeps a full foursome (themselves + up to 3 guests). If a member brought 4+ guests, the extra guests are left **unassigned** with a banner naming them, for the organizer to place by hand. A group can never exceed four.
- **Pre-round only:** the button is disabled once any score is entered or a group is locked (you can't reshuffle a round that's underway).
- Pure algorithm in `lib/grouping.ts` with 281 unit tests. Verified: tsc clean, all tests pass, build clean.

## v1.94.1 — WhatsApp export gets the tap-to-open link (no migration)
- The main **"Copy for WhatsApp"** tee-time message now ends with a clickable deep link (`👉 Open in the app to RSVP or view: …/?tt=<id>`), matching the reminder message. Tapping it opens the app straight on that tee time (the link survives the Google sign-in redirect via the existing `?tt=` capture in page.tsx → home.tsx). The reminder message already had this; only the full-field export was missing it.
- Code-only. Verified: tsc clean, tests pass, build clean.

## v1.94.2 — WhatsApp deep link auto-switches to the tee time's group (no migration)
- A tee-time deep link (`/?tt=<id>`) now works even when the recipient is viewing a different group. home.tsx resolves the tee time's group_id and switches the active group to it (persisting to profiles.active_group_id + boot cache) BEFORE handing the id to the Tee Times screen — so the tee time is in the loaded list when it opens.
- Robustness: the id is only passed to Tee Times once the target group is active (a new `deepReady` gate), which fixes the prior race where Tee Times would "consume" the deep link against the wrong group and silently give up. If the tee time is unknown or the user isn't a member (RLS hides it), it falls back gracefully to the current group with no error.
- Code-only. Verified: tsc clean, tests pass, build clean.

## v1.94.3 — Fix: game_players.bets NOT-NULL violation on game setup (no migration required)
- Cause: member player rows (create-game roster, self-join, add-member) omitted `bets` and relied on the column's DB default. If the live `game_players.bets` column ended up NOT NULL without a working default (0059's `add column if not exists ... default true` silently skips setting the default when the column already existed from an earlier state), those inserts sent NULL and failed with "null value in column bets ... violates not-null constraint."
- Fix (code): all four game_players insert paths now set `bets` explicitly — members `true` (in the TGC money game), guests `false` — so inserts never depend on the DB default. No migration needed.
- OPTIONAL root-cause cleanup (safe, idempotent) to restore the column default so future/manual inserts also behave:
    alter table public.game_players alter column bets set default true;
- Verified: tsc clean, tests pass, build clean.

## v1.95.0 — Robustness hardening (defensive writes + default repair + error surfacing) — RUN migration 0062
- **RUN migration 0062_repair_column_defaults.sql** (re-asserts DB defaults on the ~18 columns added via `add column if not exists ... default`, which silently skips the default if the column already existed). Read-only-safe on existing data; idempotent. Full SQL printed in chat. Run after 0061.
- **Defensive writes (Item 1):** every `game_players` INSERT now sets all NOT-NULL state columns explicitly via a shared `GP_STATE_DEFAULTS` ({penalties:[], sand:[], is_marker:false, group_locked:false}) plus is_guest/bets — so inserts never depend on a DB default again (the `bets` incident could also have hit penalties/sand/is_marker/group_locked, which blankCard() previously omitted). New standing rule: never rely on a DB default for a NOT-NULL column; always set it in the insert.
- **Error surfacing (Item 4):** added a tiny global toast (components/toast.tsx, mounted once in home). Key user-facing game-setup writes that previously swallowed errors now surface a message on failure: add member, add guest, tee-group assignment, betting toggle, and Randomize. Best-effort logging/notification catches remain intentional.
- **SMOKE_TEST.sql** added to the repo: run it in the Supabase SQL editor after any migration to catch a missing-default drift before members do (Check 1 is read-only; Check 2 attempts the app's inserts and rolls back). See the walkthrough.
- Verified: tsc clean, all tests pass, build clean.

## v1.96.0 — Resume an interrupted game setup (no migration)
- Leaving the Create Game screen mid-setup no longer loses your picks. The in-progress setup (name, date, course+tee, format & options, selected members, guests with sponsors, teams) is saved to a device-local draft as you go — no game row is created until you finish, so there's still nothing to clean up.
- Returning to Create Game shows a **"Resume your setup?"** banner (Resume / Start fresh). Resume restores everything (course re-matched by name once favorites load); Start fresh clears the draft and uses the tee-time defaults. The draft is cleared automatically when the game is created.
- Keyed by group + originating tee time (bnn_setup_draft:<group>:<teeTime>), so drafts never bleed across tee times or groups. New lib/setup-draft.ts. Note: an explicit Cancel keeps the draft (so you can resume later); use "Start fresh" on the banner to discard.
- Verified: tsc clean, all tests pass, build clean.

## v1.96.1 — Automated robustness check on every deploy (CI; app unchanged)
- Added .github/workflows/robustness.yml. On every push/PR (and daily + on-demand) it runs two jobs:
  1. **Types, tests, build** — `tsc --noEmit`, `npm test` (349 pure-logic tests), `next build`. Catches code/logic/type regressions before deploy.
  2. **Database schema guard (read-only)** — runs ci/schema-check.sh against the database in the `SUPABASE_DB_URL` repo secret: lists NOT-NULL columns without a default (informational) and HARD-FAILS if any "state" column the app relies on a default for is missing one (ci/assert-defaults.sql). This is the automated version of SMOKE_TEST.sql and directly guards against the `bets` drift class. 100% read-only — safe to point at production. Skips (doesn't fail) until the secret is set.
- To enable the DB guard: GitHub repo → Settings → Secrets and variables → Actions → New repository secret → name `SUPABASE_DB_URL`, value = the Supabase "Session pooler" connection URI (Supabase → Project Settings → Database → Connection string → URI, Session pooler). Read-only use.
- App behavior is unchanged from v1.96.0 (this release adds CI + ci/ scripts only; no app code, no migration). We validated the guard against a real Postgres: it passes when defaults exist and fails (naming the column) when one is dropped.

## v1.97.0 — Resume drafts for course creation and tee-time creation (no migration)
- Factored the draft logic into one shared helper (lib/form-draft.ts: loadFormDraft/saveFormDraft/clearFormDraft/draftAgeLabel). Game setup (lib/setup-draft.ts) now delegates to it; Courses and Tee Times use it directly.
- **Courses:** starting a NEW course and leaving mid-entry no longer loses your work (name, tees, per-hole par/SI/yardages, ratings). "Add a course" shows a "Resume your course?" banner (Resume / Start fresh); the draft clears on save. Editing an EXISTING course is not drafted (its data is already saved). Picking a searched course or "Enter manually" counts as starting fresh.
- **Tee Times:** creating a NEW tee time and leaving no longer loses it (type, title, date, tee-off times, course, spots, deadline, notes). "New Tee Time" shows a "Resume your tee time?" banner; draft clears on post. Editing an existing tee time is not drafted. The auto-fill-deadline effect is guarded so a resumed deadline isn't overwritten.
- Consistent with game setup: Cancel keeps the draft (resume later); use "Start fresh" to discard. Device-local only, keyed per group.
- Verified: tsc clean, all tests pass, build clean.

## v1.97.1 — Game guests are per-game only (no permanent guest list) — no migration
- Fixed a workflow mismatch: game guests were being written into the persistent group_guests table and surfaced as a "past guests" quick-pick on new game setups. Game guests are temporary to a game, so:
  - Removed the group_guests writes from both guest-add paths (create-flow and in-game). Game guests now live only as per-game game_players rows.
  - Removed the "Add a past guest…" quick-pick from the create-game and in-game add-guest screens.
- Kept the per-game "playing with…" (sponsor) picker, which writes game_players.guest_of — this is what lets the randomizer keep a guest in their host's foursome. It's chosen per game (defaults to whoever's adding), so the same guest can be invited by a different member next time with no permanent tie.
- Tee-time handoff unchanged: guests assigned via RSVPs still flow into game setup (seed.guests -> guestPlayers, attributed to their sponsoring member).
- Money's own guest feature (group_guests, for splitting expenses) is untouched — that remains the one place a guest is deliberately persisted, and betting settle-up was already member-only (posts by user_id), so nothing there depended on the game-guest writes.
- Verified: tsc clean, all tests pass, build clean.

## v1.98.0 — Per-expense guest sponsor + retire-guest (Money)
- RUN migration 0063_guest_per_expense_sponsor.sql (full SQL below / in the file). Adds expense_shares.sponsor_user_id (nullable), makes group_guests.sponsor_user_id nullable, and adds group_guests.archived (default false) + group_guests.became_member_id (nullable). Idempotent; validated on a real Postgres.
- The member responsible for a guest is now chosen PER EXPENSE (stored on the share), not fixed on the guest. In Add Expense, each included guest shows a required "Sponsored by" picker that starts blank; Save is blocked until every guest has one. Creating a guest now asks for a NAME ONLY.
- Settle-up math (lib/money.ts resolveMember) uses the per-expense sponsor, falling back to the guest's old fixed sponsor for any pre-0063 shares — so existing balances do NOT move. Covered by new unit tests (per-expense split, legacy fallback, guestCoverageBySponsor).
- Balances "incl. <guests>" line now attributes each guest's portion to whoever sponsored it on each expense (a guest can roll to different members).
- Retire a guest: Balances screen → Guests section → Retire (optionally mark "now a member"). Retiring hides the guest from the add-a-guest picker on new expenses; past expenses are untouched and no balances move. Un-retire restores them. Guest inserts set archived=false explicitly.
- ci/assert-defaults.sql now also guards group_guests.archived.
- Verified: tsc clean, tests pass (money 51 / legs 23 / grouping 281), build clean, migration idempotent on real Postgres.

### 0063_guest_per_expense_sponsor.sql
```sql
alter table public.expense_shares
  add column if not exists sponsor_user_id uuid references auth.users(id) on delete set null;
alter table public.group_guests
  alter column sponsor_user_id drop not null;
alter table public.group_guests
  add column if not exists archived boolean not null default false;
alter table public.group_guests
  add column if not exists became_member_id uuid references auth.users(id) on delete set null;
```

## v1.99.0 — Guests in a posted bet, booked to their sponsor (symmetric win/lose)
- RUN migration 0065_bet_guest_payers.sql (full SQL below). Extends expense_payers with guest_id + sponsor_user_id, makes user_id nullable, swaps the member-only unique constraint for a party-based unique index, and adds a one-party check — mirroring what 0063 did for expense_shares. Idempotent; validated on real Postgres.
- Posting a bet that includes a guest no longer blocks. Each guest bettor is booked as their OWN line (win or lose), attributed to the member sponsoring them for that game (game_players.guest_of). Winning guests credit the sponsor (guest payer); losing guests are owed by the sponsor (guest share). Both roll into the sponsor's balance and settle through them.
- To carry a betting guest onto the ledger, the app finds-or-creates a lightweight Money guest record by name at post time (only because the bet posts to Money — consistent with "persist a guest only when money's involved"). That guest then appears in the Money guest list and can be retired. Re-posting the same bet reuses the record (dedup by name), so no duplicates.
- Settle-up engine (lib/money.ts): computeBalances + pairwiseDebts now resolve the PAYER side guest->sponsor (previously only shares); betResultToPost carries guest_id + sponsor_user_id onto posted rows; guestCoverageBySponsor also covers payers so the Balances "incl. <guest>" line shows for wins and losses. New unit tests cover winning-guest crediting, betResultToPost guest passthrough, and coverage.
- Still blocked (by design): a guest with no sponsor assigned, or a real non-member account in the pot — clear message either way.
- Confirm card + expense detail show the guest's own line ("· guest of X"); Balances shows "incl. <guest>".
- Verified: tsc clean, tests pass (money 56 / legs 23 / grouping 281), build clean, migration idempotent on real Postgres; end-to-end scenario check (guest of P5, -$25) yields P5 +$95 incl. Sam and settle-up P2->P5 $75, P4->P5 $20, P4->P3 $25.

### 0065_bet_guest_payers.sql
```sql
alter table public.expense_payers
  add column if not exists guest_id uuid references public.group_guests(id) on delete cascade;
alter table public.expense_payers
  add column if not exists sponsor_user_id uuid references auth.users(id) on delete set null;
alter table public.expense_payers
  alter column user_id drop not null;
alter table public.expense_payers drop constraint if exists expense_payers_uk;
create unique index if not exists expense_payers_party_uk
  on public.expense_payers(expense_id, coalesce(user_id::text, ''), coalesce(guest_id::text, ''));
alter table public.expense_payers drop constraint if exists expense_payers_one_party;
alter table public.expense_payers
  add constraint expense_payers_one_party check ((user_id is not null) <> (guest_id is not null));
```

## v1.99.1 — Bet-generated guests are per-game throwaways, separated from Money guests
- RUN migration 0066_bet_guest_source_game.sql (SQL below). Adds group_guests.source_game_id (nullable, references games).
- A guest auto-created for a posted bet is now tagged with its game (source_game_id) and keyed per game: re-posting the same game reuses the record; the same name in a different game is a separate record (guest + game = sponsor + date context). Two different people named "Sam" in two games are simply two records — correctness is unaffected since the sponsor is always per-transaction.
- These bet-generated guests are hidden from the deliberate add-a-guest picker (Add Expense) and from the Retire list (Balances → Guests), so they never clutter the reusable Money-guest workflow. They still resolve by name on the expense detail and the "incl. <guest>" balance line.
- Deliberate Money guests (added in the Money tab) keep source_game_id null and are unchanged.
- Group-agnostic: all keyed off game.group_id + game.id, so this ports to any group if betting opens beyond TGC.
- Verified: tsc clean, tests pass (money 56 / legs 23 / grouping 281), build clean, migration idempotent on real Postgres.

### 0066_bet_guest_source_game.sql
```sql
alter table public.group_guests
  add column if not exists source_game_id uuid references public.games(id) on delete set null;
```

## v1.99.2 — Default 4-or-fewer-player games to a single tee group (no migration)
- At game creation, if the roster is 4 players or fewer, everyone is defaulted into Group 1 (they tee off together). The organizer can still split them manually in the Groups step. Bigger rosters continue to start ungrouped for assignment.
- Applies to all formats (a 2-player match, a 2v2 foursome, etc. all default to one group when the total is <=4).
- Forward-only (affects newly created games); no schema change.

## v1.99.3 — Betting payouts consistent: no payout until scores are in (no migration)
- Overall 1st/2nd now follows the same rule as the sixes: it stays "not all scores in — no payout yet" until every bettor has completed all 18 holes, instead of showing/assigning money to whoever was leading mid-round. The leaderboard remains the place to see who's currently ahead.
- Tightened the sixes to match their own wording too: a six settles only once EVERY bettor has all six of its holes in (previously it could settle as soon as one bettor finished the six). Sixes still pay progressively as each is completed.
- Clean sweep is gated on all 18 being in.
- No change to any FINAL posted result — posting already requires the game to be ended (all holes in), so settled amounts are identical; this only fixes the mid-round display/assignment. Applies to the payout panel and the WhatsApp/share export.
- Verified: tsc clean, tests pass (added a mid-round test: overall unpaid, a completed six still pays), build clean.

## v1.99.4 — Six-hole segment leader ranks by under-par pace (no migration)
- While a six is IN PROGRESS, the "leading"/"tied" player on the six-hole segment card is now whoever is most under par for the holes they've actually played — the same pace metric the main leaderboard uses (2·holes − points for Stableford; net vs par-of-holes-played for stroke). Previously it ranked by raw cumulative points, which disagreed with the leaderboard: a player 15 pts thru 6 (3 under) was shown ahead of one 12 pts thru 4 (4 under). Now the 4-under player leads, and the lead flip-flops correctly as holes come in.
- Display is unchanged in format: still shows raw points/net · thru the LEADER's own holes (e.g. "Bob · 12 pts · thru hole 4 · leading"), so the over/under is easy to read off.
- Once every bettor has all six holes in, everyone is on the same par pace, so this collapses to exactly who won the six — no change to completed sixes, and no change to any payout (payouts still settle only when all scores are in, per v1.99.3). Clean-sweep watch now tracks the pace leader of the last six.
- Verified: tsc clean, tests pass (computeBetting 29 / money 56 / legs 23 / grouping 281), build clean.

## v1.100.0 — Players keep their own stats in group scoring (score stays the scorer's)
- RUN migration 0067_save_hole_stats.sql (full SQL below). Adds a save_hole_stats(p_player, p_putts, p_fairways, p_penalties, p_sand) SECURITY DEFINER chokepoint: a signed-in player may update ONLY their OWN row's peripheral stats, and it never touches scores/clock. Mirrors the 0022 save_hole_scores ownership pattern. Idempotent; validated on real Postgres (owner writes stats with score intact; a non-owner is rejected).
- GROUP SCORING ONLY. Individual scoring is unchanged — you enter your own score and stats as before.
- In a group where someone else keeps score: open the group card and tap your OWN row on any hole. The gross score is greyed out ("kept by <marker>", view-only) and putts / fairway / sand / penalties are editable in the same hole pop-up the marker uses. The marker still owns the number; the scorer MAY also enter stats.
- Conflict rule: LAST-WRITE-WINS per stat column. The scorer overrides simply by entering a stat (their save becomes the latest). Peripheral stats do not affect the gross/net/Stableford score, so the number is never at risk.
- Sync safety: every writer now pushes ONLY the columns it changed vs the confirmed-synced watermark (new lib/sync-cols.ts, unit-tested), so the marker's background flush never clobbers a stat it didn't touch and a non-marker's device never writes a score it doesn't own (a hard mask drops `scores`, and stats route through the chokepoint). Watermark advances per written column. No change to the reconcile/merge model.
- NOTE: multi-device realtime behavior can't be integration-tested in CI — smoke-test on two phones (marker + player) before relying on it: marker enters scores, player taps own row and edits putts, confirm both land and neither clobbers the other; then toggle offline/online and confirm it reconciles.
- Verified: tsc clean, tests pass (game-shape 85 / computeBetting 29 / money 56 / legs 23 / grouping 281 / sync-cols 6), build clean, migration idempotent on real Postgres.

### 0067_save_hole_stats.sql
```sql
create or replace function public.save_hole_stats(
  p_player    uuid,
  p_putts     jsonb default null,
  p_fairways  jsonb default null,
  p_penalties jsonb default null,
  p_sand      jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); owner uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select user_id into owner from public.game_players where id = p_player;
  if owner is null then raise exception 'no such player, or that row has no owner to keep its own stats'; end if;
  if owner <> uid then raise exception 'you can only edit your own stats'; end if;
  update public.game_players set
      putts     = coalesce(p_putts,     putts),
      fairways  = coalesce(p_fairways,  fairways),
      penalties = coalesce(p_penalties, penalties),
      sand      = coalesce(p_sand,      sand)
   where id = p_player;
end $$;
```

## v1.100.1 — The group scorer sees their own card in Results (no migration)
- Previously the individual "Enter your scores" card in the Results tab was hidden whenever ANY marker existed — including when the marker was YOU. So the group scorer couldn't see their own card mid-round (only after the game ended).
- Now it's hidden only when someone ELSE keeps your score (a non-marker mid-game, who uses the group card's per-row stats pop-up instead). The group scorer and self-scorers see their own card in Results as expected. The "someone is keeping score" notice likewise no longer shows to the scorer themselves.
- Gate changed from "a marker exists" to markerOwnsMyRow (a marker other than me). No schema/logic change beyond the visibility gate; the scorer owns their own row, so editing it here is the same single-writer path as the group card.
- Verified: tsc clean, tests pass, build clean.

## v1.101.0 — Everyone sees their own card in group scoring + a join-and-RSVP link for new players (no migration)
### Own card for everyone in group mode
- In group scoring, the Results tab now shows EVERY player their own individual card — not just the scorer. For a player whose score is kept by someone else, the gross score is view-only (🔒 "kept by X") while putts / fairway / sand / penalties stay editable, saving instantly through the save_hole_stats chokepoint (0067). The group scorer and self-scorers get a fully-editable card as before.
- Replaces the old "your card is hidden — tap the group card" redirect. (The group card's per-row stats pop-up from v1.100.0 still works too; this just makes the individual card the natural place.) Header reads YOUR CARD (locked) / ENTER YOUR SCORES / YOUR FINAL SCORES appropriately. HoleScoreModal + ScoreEntryCard gained a scoreLocked mode.
### Join-and-RSVP link for brand-new players
- Tee-time detail (admins only) gains "Copy sign-up link (new players)". It mints a multi-use group invite code (create_group_invite_multi, 14-day, unlimited uses) and builds `/join/<code>?tt=<teeTimeId>`.
- A brand-new person who taps it: Continue with Google (creates their account) → the group invite is redeemed (joins the group) → they land straight on the tee time to RSVP. An existing member who taps it skips the join (no-op) and just opens the tee time. The /join page now carries ?tt through the OAuth round-trip and forwards to it on success.
- Security model unchanged: minting a join link is admin-only (same as the group invite link); the code just also points at a tee time. The regular "Copy for WhatsApp" (members) link is untouched.
- Verified: tsc clean, tests pass (game-shape/golf/money/legs/grouping/sync-cols), build clean. No migration (reuses existing create_group_invite_multi + redeem RPCs and the save_hole_stats chokepoint from 0067).

## v1.102.0 — Analytics accuracy + test mode + incomplete-round nudge + profile nudge + name caps
- RUN migration 0068_analytics_v2.sql (full SQL below). Adds daily_active.opens (raw open counter) and profiles.is_test; rewrites mark_active (counts opens), adds admin_set_test(user,bool), and rewrites get_admin_analytics.
- ROUNDS now count COMPLETED only (status='final') and NEVER deleted (deleted_at is null). Started-but-not-finished rounds are tracked separately (rounds_started); a partial round is legitimate once marked complete (9/15 holes fine). The Rounds tile shows done + "N started".
- INCOMPLETE-ROUND NUDGE (home): when you have an unfinished round, a banner offers Finish scoring / Mark complete (sets status='final' so it counts) / Delete (soft-delete). "Mark complete" stores gross = sum of entered strokes.
- ABANDONED % now spans BOTH games and rounds (stale >3d, non-deleted): abandoned = (stale active games with no round) + (stale started rounds) over (games + rounds).
- OPENS: Today / This week / This month each show UNIQUE users (big) + TOTAL views (small). Stickiness stays on unique (DAU/MAU). Labels now say "· unique" and a footnote clarifies unique vs views.
- TEST MODE: profiles.is_test excludes an account from EVERY metric while leaving it fully functional. Toggle in Profile (admin only) via admin_set_test. Use it for feature testing so stats stay clean.
- NEW STATS (all excluding test accounts): rounds/active-user, churn (lapsed 30–60d), round-completion %, and an Engagement section (tee times created, RSVPs, bets posted all-time/30d, money settled, invite links created, joins via invite, % of games using a group scorer).
- WEEKLY PROFILE NUDGE (home): if a profile is missing a photo or handicap index, a dismissible banner (re-appears after 7 days) links to the Profile tab.
- NAME CAPITALISATION: profile names are title-cased on save (home NameGate + Profile panel) — "amit sud" -> "Amit Sud", preserving O'Brien / McDonald.
- Deferred (needs new client instrumentation; no push feature exists yet): PWA-install rate and notification opt-in stats.
- Verified: tsc clean, tests pass (game-shape/golf/money/legs/grouping/sync-cols), build clean; get_admin_analytics validated on real Postgres (unique vs total opens, completed-only + deleted-excluded rounds, test-user exclusion, abandoned incl. games+rounds). Idempotent.

### 0068_analytics_v2.sql
```sql
-- 0068_analytics_v2.sql
-- Analytics accuracy pass:
--   * daily_active.opens — raw open counter so we can show TOTAL views alongside UNIQUE users.
--   * profiles.is_test — test/QA accounts are fully functional but excluded from every metric
--     (so feature testing doesn't pollute stats). Admin-set via admin_set_test().
--   * get_admin_analytics rewritten: Rounds count COMPLETED rounds only (status='final'),
--     never deleted (deleted_at is null); a separate started/abandoned figure is exposed.
--     Abandoned% now spans BOTH games and rounds. Total + unique opens for today/7d/30d.
--     Test users excluded throughout. Plus new engagement stats.

alter table public.daily_active add column if not exists opens int not null default 1;
alter table public.profiles     add column if not exists is_test boolean not null default false;

-- Ping on app open now also counts the open (for total views).
create or replace function public.mark_active()
returns void language plpgsql security definer set search_path = public as $function$
begin
  if auth.uid() is null then return; end if;
  insert into daily_active(user_id, day, opens) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set opens = daily_active.opens + 1;
end;
$function$;
grant execute on function public.mark_active() to authenticated;

-- Admin: flag/unflag a user as a test account (excluded from analytics).
create or replace function public.admin_set_test(p_user uuid, p_is_test boolean)
returns void language plpgsql security definer set search_path = public as $function$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.profiles set is_test = coalesce(p_is_test, false) where id = p_user;
end;
$function$;
grant execute on function public.admin_set_test(uuid, boolean) to authenticated;

create or replace function public.get_admin_analytics()
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  j jsonb;
  v_dau int; v_wau int; v_mau int; v_a7 numeric; v_a30 numeric;
  v_views_today int; v_views_7d int; v_views_30d int;
  v_created int; v_ended int;
  v_rdone int; v_rstarted int; v_rdone30 int;
  v_churn int;
  v_games_total int; v_rounds_total int; v_abandoned int;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;

  -- Active users (UNIQUE) + opens (TOTAL), test accounts excluded.
  select count(distinct da.user_id) filter (where da.day = current_date),
         count(distinct da.user_id) filter (where da.day > current_date - 7),
         count(distinct da.user_id) filter (where da.day > current_date - 30),
         coalesce(sum(da.opens) filter (where da.day = current_date), 0),
         coalesce(sum(da.opens) filter (where da.day > current_date - 7), 0),
         coalesce(sum(da.opens) filter (where da.day > current_date - 30), 0)
    into v_dau, v_wau, v_mau, v_views_today, v_views_7d, v_views_30d
  from daily_active da join profiles p on p.id = da.user_id
  where coalesce(p.is_test, false) = false;

  select coalesce(count(*)::numeric,0) / 7  into v_a7
    from daily_active da join profiles p on p.id = da.user_id
    where da.day > current_date - 7 and coalesce(p.is_test,false) = false;
  select coalesce(count(*)::numeric,0) / 30 into v_a30
    from daily_active da join profiles p on p.id = da.user_id
    where da.day > current_date - 30 and coalesce(p.is_test,false) = false;

  -- Churn: active 30–60 days ago but NOT in the last 30 days.
  select count(*) into v_churn from (
    select da.user_id
    from daily_active da join profiles p on p.id = da.user_id
    where coalesce(p.is_test,false) = false
    group by da.user_id
    having max(da.day) between current_date - 60 and current_date - 31
  ) t;

  -- Games (test creators excluded).
  select count(*), count(*) filter (where g.status = 'ended')
    into v_created, v_ended
  from games g left join profiles p on p.id = g.created_by
  where coalesce(p.is_test,false) = false;

  -- Rounds: completed only, never deleted; started (non-deleted, not final) tracked apart.
  select count(*) filter (where r.status = 'final'),
         count(*) filter (where r.status <> 'final'),
         count(*) filter (where r.status = 'final' and r.created_at > now() - interval '30 days')
    into v_rdone, v_rstarted, v_rdone30
  from rounds r join profiles p on p.id = r.user_id
  where r.deleted_at is null and coalesce(p.is_test,false) = false;

  -- Abandoned spans games AND rounds: stale (>3d) games with no round + stale started rounds.
  v_games_total := v_created;
  v_rounds_total := v_rdone + v_rstarted;
  v_abandoned :=
      (select count(*) from games g left join profiles p on p.id = g.created_by
        where coalesce(p.is_test,false)=false and g.status='active'
          and g.created_at < now() - interval '3 days'
          and not exists (select 1 from rounds r where r.game_id = g.id and r.deleted_at is null))
    + (select count(*) from rounds r join profiles p on p.id = r.user_id
        where coalesce(p.is_test,false)=false and r.deleted_at is null
          and r.status <> 'final' and r.created_at < now() - interval '3 days');

  j := jsonb_build_object(
    'totals', jsonb_build_object(
      'users',         (select count(*) from profiles where coalesce(deactivated,false)=false and coalesce(is_test,false)=false),
      'users_new_30d', (select count(*) from profiles where created_at > now() - interval '30 days' and coalesce(is_test,false)=false),
      'active_groups', (select count(distinct g.group_id) from games g left join profiles p on p.id=g.created_by where g.created_at > now() - interval '30 days' and g.group_id is not null and coalesce(p.is_test,false)=false),
      'games',         v_created,
      'games_30d',     (select count(*) from games g left join profiles p on p.id=g.created_by where g.created_at > now() - interval '30 days' and coalesce(p.is_test,false)=false),
      'rounds',        v_rdone,          -- completed only, excludes deleted
      'rounds_30d',    v_rdone30,
      'rounds_started', v_rstarted,      -- started but not completed (non-deleted)
      'rounds_per_active_user', case when v_mau > 0 then round(v_rdone30::numeric / v_mau, 1) else 0 end
    ),
    'active', jsonb_build_object(
      'dau', v_dau, 'wau', v_wau, 'mau', v_mau,
      'views_today', v_views_today, 'views_7d', v_views_7d, 'views_30d', v_views_30d,
      'avg7',  round(coalesce(v_a7, 0), 1),
      'avg30', round(coalesce(v_a30, 0), 1),
      'stickiness_pct', case when v_mau > 0 then round(100.0 * v_dau / v_mau) else 0 end,
      'churn_30d', v_churn,
      'series', coalesce((
        select jsonb_agg(jsonb_build_object('day', d::text, 'n', coalesce(c.n, 0)) order by d)
        from generate_series(current_date - 29, current_date, interval '1 day') g(d)
        left join (
          select da.day, count(distinct da.user_id) n from daily_active da
          join profiles p on p.id = da.user_id where coalesce(p.is_test,false)=false
          group by da.day
        ) c on c.day = g.d::date
      ), '[]'::jsonb)
    ),
    'formats', (
      select coalesce(jsonb_object_agg(game_type, n), '{}'::jsonb)
      from (select g.game_type, count(*) n from games g left join profiles p on p.id=g.created_by
            where coalesce(p.is_test,false)=false group by g.game_type) t
    ),
    'engagement', jsonb_build_object(
      'tee_times_30d',    (select count(*) from tee_times where created_at > now() - interval '30 days'),
      'tee_rsvps_30d',    (select count(*) from tee_time_rsvps rr join tee_times tt on tt.id=rr.tee_time_id where tt.created_at > now() - interval '30 days'),
      'bets_posted',      (select count(*) from expenses where source_kind = 'tgc_bet'),
      'bets_30d',         (select count(*) from expenses where source_kind = 'tgc_bet' and created_at > now() - interval '30 days'),
      'settled_cents',    (select coalesce(sum(amount_cents),0) from settlements),
      'invites_created_30d', (select count(*) from group_invites where created_at > now() - interval '30 days'),
      'joins_via_invite',    (select coalesce(sum(use_count),0) from group_invites),
      'group_scoring_pct', case when v_created > 0 then round(100.0 * (
          select count(*) from games g left join profiles p on p.id=g.created_by
          where coalesce(p.is_test,false)=false
            and (g.marker_user_id is not null or exists (select 1 from game_players gp where gp.game_id=g.id and gp.is_marker))
        ) / v_created) else 0 end
    ),
    'features', jsonb_build_object(
      'avatars_set',      (select count(*) from profiles where avatar_url is not null and coalesce(is_test,false)=false),
      'ai_summaries',     (select count(*) from profiles where dashboard_ai is not null and coalesce(is_test,false)=false),
      'live_shared',      (select count(*) from games where share_token is not null),
      'courses_added_30d',(select count(*) from favorite_courses where created_at > now() - interval '30 days' and coalesce(deleted,false)=false)
    ),
    'health', jsonb_build_object(
      'completion_pct', case when v_created > 0 then round(100.0 * v_ended / v_created) else 0 end,
      'round_completion_pct', case when (v_rdone + v_rstarted) > 0 then round(100.0 * v_rdone / (v_rdone + v_rstarted)) else 0 end,
      'abandoned_pct', case when (v_games_total + v_rounds_total) > 0 then round(100.0 * v_abandoned / (v_games_total + v_rounds_total)) else 0 end,
      'avg_holes', coalesce((
        select round(avg(c), 1) from (
          select (select count(*) from jsonb_array_elements(gp.scores) e where e <> 'null'::jsonb) c
          from game_players gp where jsonb_typeof(gp.scores) = 'array'
        ) t where c > 0
      ), 0),
      'never_joined_group_pct', case when (select count(*) from profiles where coalesce(is_test,false)=false) > 0 then round(100.0 * (
          select count(*) from profiles p where coalesce(p.is_test,false)=false
            and not exists (select 1 from group_members m where m.user_id = p.id and m.status = 'active')
        ) / (select count(*) from profiles where coalesce(is_test,false)=false)) else 0 end,
      'activated_7d_pct', coalesce((
        select round(100.0 * count(*) filter (where exists (
                 select 1 from rounds r where r.user_id = p.id and r.deleted_at is null
                   and r.status='final' and r.created_at <= p.created_at + interval '7 days'
               )) / nullif(count(*), 0))
        from profiles p where p.created_at > now() - interval '90 days' and coalesce(p.is_test,false)=false
      ), 0),
      'retention_w1_pct', coalesce((
        select round(100.0 * count(*) filter (where exists (
                 select 1 from daily_active d2 where d2.user_id = f.user_id
                   and d2.day between f.first_day + 1 and f.first_day + 7)) / nullif(count(*), 0))
        from (select da.user_id, min(da.day) first_day from daily_active da join profiles p on p.id=da.user_id where coalesce(p.is_test,false)=false group by da.user_id) f
        where f.first_day between current_date - 37 and current_date - 7
      ), 0),
      'retention_w4_pct', coalesce((
        select round(100.0 * count(*) filter (where exists (
                 select 1 from daily_active d2 where d2.user_id = f.user_id
                   and d2.day between f.first_day + 22 and f.first_day + 28)) / nullif(count(*), 0))
        from (select da.user_id, min(da.day) first_day from daily_active da join profiles p on p.id=da.user_id where coalesce(p.is_test,false)=false group by da.user_id) f
        where f.first_day between current_date - 58 and current_date - 28
      ), 0)
    )
  );
  return j;
end;
$function$;
grant execute on function public.get_admin_analytics() to authenticated;
```

## v1.103.0 — Admin per-user test-account toggle (no migration)
- The admin Users list now has a per-user "Test account" toggle (expand a user's row -> ANALYTICS section). It calls the existing admin_set_test RPC (from 0068), so an admin can flag ANY account as test, not just their own. A test account is excluded from every analytics figure but works normally.
- Intended workflow: flag a SECOND account you control (your own second Google login, or a burner) as test, sign in as it on another device/incognito, and use it to see what a regular member sees in response to your admin actions — without polluting analytics. NOTE: this is not impersonation; you must actually sign in as that account. Acting-as-another-member from your own session is a separate, security-sensitive feature not included here.
- No migration (reuses profiles.is_test + admin_set_test from 0068). Verified: tsc clean, tests pass, build clean.

## v1.104.0 — Push notifications, phase 1: subscription plumbing (RUN migration 0069)
This phase gets a device REGISTERED for push and lets the service worker DISPLAY a push. It does NOT send pushes yet — the Vercel sender + Supabase webhook + event wiring come in phase 2. So after this deploy, the Notifications toggle should subscribe a device without error (a row appears in push_subscriptions), but nothing will actually buzz until phase 2.

SETUP (one-time):
1. RUN migration 0069 (full SQL below).
2. In Vercel → Project → Settings → Environment Variables, add (Production + Preview):
   - NEXT_PUBLIC_VAPID_PUBLIC_KEY = BPosOVuEyjpY3zfcnhq_LP__z1IEs2_sgNPg9JNYG38_n54R5wpGgRx4cyq-lr5w9_UIdMC0Fn2bIocDJj9H0fc
   - VAPID_PRIVATE_KEY = <the private key from the chat message — DO NOT commit it to the repo>   (server-only; used by the phase-2 sender)
   The public key is also embedded in public/sw.js for re-subscribe; keep the two in sync if you ever rotate keys.
3. Redeploy so the env vars are picked up.

WHAT SHIPPED:
- push_subscriptions table (one row per device endpoint) with RLS (users manage only their own; the phase-2 sender reads via the service role). profiles.push_prefs jsonb for per-type prefs (absent key = on; used in phase 2). notifications gains type + link so a push can deep-link; create_notification extended with optional p_type/p_link (existing 2/3-arg calls unaffected — validated).
- Service worker: push / notificationclick / pushsubscriptionchange handlers (cache/offline logic untouched). Clicking a notification focuses an open tab and routes it, or opens a new one at the deep link.
- Profile → Notifications: capability-based opt-in. iPhone-not-installed shows explicit "Add to Home Screen from Safari" steps (and warns that a Chrome-added icon won't push); Android/desktop/installed-iOS get a Turn-on button that requests permission, subscribes, and stores the subscription.
- Verified: tsc clean, tests pass, build clean; 0069 idempotent on real Postgres.

TEST (phase 1): On Android/desktop Chrome, Profile → Notifications → Turn on → allow → confirm a row appears in push_subscriptions. On iPhone: install via Safari (Share → Add to Home Screen), open from the icon, then Turn on. (No push is sent yet — that's phase 2.)

### 0069_push_subscriptions.sql
```sql
-- 0069_push_subscriptions.sql
-- Web Push plumbing (phase 1): store each device's push subscription, add per-type push
-- preferences, and give notifications a type + deep-link so a push can open the right
-- screen. The sender (Vercel route) + webhook come in phase 2; nothing here sends a push.

-- One row per browser/device push endpoint. A user may have several (phone, desktop…).
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  platform    text,
  user_agent  text,
  disabled    boolean not null default false,  -- flipped true by the sender after repeated failures
  fail_count  int not null default 0,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id) where disabled = false;

alter table public.push_subscriptions enable row level security;
-- Users manage ONLY their own subscriptions. The sender reads via the service role,
-- which bypasses RLS, so no broad read policy is needed here.
drop policy if exists push_sub_select on public.push_subscriptions;
drop policy if exists push_sub_insert on public.push_subscriptions;
drop policy if exists push_sub_update on public.push_subscriptions;
drop policy if exists push_sub_delete on public.push_subscriptions;
create policy push_sub_select on public.push_subscriptions for select using (user_id = auth.uid());
create policy push_sub_insert on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy push_sub_update on public.push_subscriptions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_sub_delete on public.push_subscriptions for delete using (user_id = auth.uid());

-- Per-type push preferences (absent key = ON). A "_master" key of false mutes everything.
alter table public.profiles add column if not exists push_prefs jsonb not null default '{}'::jsonb;

-- Let a notification carry a type + deep link so the push (and the in-app bell) can route.
alter table public.notifications add column if not exists type text;
alter table public.notifications add column if not exists link text;

-- Extend create_notification with optional type + link, preserving existing 2/3-arg calls.
-- Drop the old signatures first so there's a single unambiguous overload.
drop function if exists public.create_notification(uuid, text);
drop function if exists public.create_notification(uuid, text, uuid);
create or replace function public.create_notification(
  p_recipient uuid,
  p_message   text,
  p_group_id  uuid default null,
  p_type      text default null,
  p_link      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sender uuid := auth.uid();
begin
  if v_sender is null then
    raise exception 'not authenticated';
  end if;
  if p_recipient is null or p_message is null then
    raise exception 'recipient and message are required';
  end if;

  if not (
    p_recipient = v_sender
    or is_admin()
    or exists (select 1 from profiles p where p.id = p_recipient and p.is_admin = true)
    or exists (
      select 1 from games g
      join game_players gp on gp.game_id = g.id
      where g.created_by = v_sender and gp.user_id = p_recipient
    )
    or exists (
      select 1 from group_members ga
      join group_members gm on gm.group_id = ga.group_id
      where ga.user_id = v_sender and ga.role = 'admin' and ga.status = 'active'
        and gm.user_id = p_recipient and gm.status = 'active'
    )
  ) then
    raise exception 'not allowed to notify this user';
  end if;

  insert into notifications (user_id, message, group_id, type, link)
  values (p_recipient, p_message, p_group_id, p_type, p_link);
end;
$function$;
grant execute on function public.create_notification(uuid, text, uuid, text, text) to authenticated;
```

## v1.105.0 — Push notifications, phase 2: sender + webhook + event triggers + prefs (RUN migration 0070)
Now notifications actually PUSH. A Supabase webhook on `notifications` INSERT calls a Vercel route that pushes to the recipient's devices IF their preference for that type is "push". Three events are wired: added to a game, you owe money, you got paid.

SETUP (one-time, after Phase 1's VAPID vars are already set):
1. RUN migration 0070 (full SQL below) — event triggers that create the notification rows.
2. Add TWO more Vercel env vars (Production + Preview; mark sensitive; untick Development for the sensitive ones):
   - SUPABASE_SERVICE_ROLE_KEY = <Supabase dashboard → Project Settings → API → service_role secret>
   - PUSH_WEBHOOK_SECRET = <the secret from the chat message>
   Redeploy after adding.
3. Create the Supabase Database Webhook (Supabase dashboard → Database → Webhooks → Create):
   - Table: public.notifications
   - Events: Insert
   - Type: HTTP Request; Method: POST
   - URL: https://birdienumnum.vercel.app/api/push
   - HTTP Headers: add  x-webhook-secret : <same PUSH_WEBHOOK_SECRET value>
   Save.

WHAT SHIPPED:
- app/api/push/route.ts (Node runtime): verifies the x-webhook-secret header, reads the recipient's push_prefs + push_subscriptions via the service role, and web-pushes only if that type resolves to "push". Dead subscriptions (404/410) are deleted; repeated failures disable a subscription. Added web-push dependency.
- Migration 0070: SECURITY DEFINER triggers create notification rows for game_added (game_players insert; organizer not self-notified; guests skipped), money_owed (expense_shares insert; payer skipped; de-duped to one per user+group per 6h so bet re-posts don't spam), money_paid (settlements insert → payee).
- Profile → Notifications: a per-type menu (Push / In-app / Off) writing to profiles.push_prefs. Defaults: game_added/money_owed/money_paid = Push; the rest In-app. Types beyond the three wired ones are shown as "· soon".
- Notification deep links now open the right tab: /?tab=money, /?tab=games (home.tsx handles ?tab=).
- Delivery resolution (route + client) share the same DEFAULT_DELIVERY map; "in-app only" and "off" simply don't push (the bell still shows the row for non-off types).
- Verified: tsc clean, tests pass, build clean; 0070 idempotent + logic validated on real Postgres (creator/payer skipped, repost de-duped, payee notified).

TEST (end-to-end, needs the webhook + env vars live): On a device with notifications turned on, have someone add you to a game / post a bet you owe on / settle up with you, and confirm the phone notification arrives and tapping it opens the right tab. In-app-only types show only in the bell. iPhone must be installed via Safari with notifications on.

### 0070_push_events.sql
```sql
-- 0070_push_events.sql
-- Create notification rows for the key events, so the phase-2 webhook can push them.
-- These run as triggers (SECURITY DEFINER, owner privileges) so they insert regardless
-- of who performed the action and without the create_notification relationship checks.
-- The webhook + each user's per-type preference decide whether a row is actually pushed.

-- 1) Added to a game — fires once per player row at game creation / when added later.
create or replace function public.notify_game_added() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare creator uuid; grp uuid;
begin
  if new.user_id is null then return new; end if;                -- guests have no account
  select created_by, group_id into creator, grp from games where id = new.game_id;
  if creator is not null and new.user_id = creator then return new; end if;  -- don't ping the organizer about themselves
  insert into notifications (user_id, message, group_id, type, link)
  values (new.user_id, 'You''ve been added to a new game.', grp, 'game_added', '/?tab=games');
  return new;
end $fn$;
drop trigger if exists trg_notify_game_added on public.game_players;
create trigger trg_notify_game_added after insert on public.game_players
  for each row execute function public.notify_game_added();

-- 2) You owe money — fires when an expense share lands against a real user who isn't the
--    payer. De-duped to at most one per user+group per 6h so bet re-posts don't spam.
create or replace function public.notify_money_owed() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare payer uuid; grp uuid;
begin
  if new.user_id is null then return new; end if;               -- guest share
  if new.share_cents <= 0 then return new; end if;
  select payer_user_id, group_id into payer, grp from expenses where id = new.expense_id;
  if payer is not null and new.user_id = payer then return new; end if;   -- the payer isn't owing themselves
  if exists (
    select 1 from notifications n
    where n.user_id = new.user_id and n.type = 'money_owed'
      and n.group_id is not distinct from grp
      and n.created_at > now() - interval '6 hours'
  ) then return new; end if;                                     -- already told them recently
  insert into notifications (user_id, message, group_id, type, link)
  values (new.user_id,
          'New charge: you owe $' || to_char(new.share_cents / 100.0, 'FM999990.00') || '. Tap to open Money.',
          grp, 'money_owed', '/?tab=money');
  return new;
end $fn$;
drop trigger if exists trg_notify_money_owed on public.expense_shares;
create trigger trg_notify_money_owed after insert on public.expense_shares
  for each row execute function public.notify_money_owed();

-- 3) You got paid — fires when a settlement is recorded; notifies the payee.
create or replace function public.notify_money_paid() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.to_user_id is null then return new; end if;
  insert into notifications (user_id, message, group_id, type, link)
  values (new.to_user_id,
          'You''ve been paid $' || to_char(new.amount_cents / 100.0, 'FM999990.00') || '.',
          new.group_id, 'money_paid', '/?tab=money');
  return new;
end $fn$;
drop trigger if exists trg_notify_money_paid on public.settlements;
create trigger trg_notify_money_paid after insert on public.settlements
  for each row execute function public.notify_money_paid();
```

## v1.106.0 — Every member can reach the Groups (Club) tab (no migration)
- The Groups tab was hidden for a non-admin member who belonged to a single group, so they had no way to switch groups or reach the "Request a new group" form. It's now visible to everyone (showGroupsTab = true). The request form and the active-group switcher already rendered for all members inside that tab and weren't admin-gated; only the tab's visibility was blocking them. Creation remains request-and-approve for now.
- No migration. Verified: tsc clean, tests pass, build clean.
- (Terminology rename Group -> Club is planned as a separate pass pending the final name.)

## v1.107.0 — Rename "Group" -> "Club" across the UI (no migration)
The top-level community concept is now called a **Club** everywhere users see it. Roles stay **members** and **admins**.
- Renamed ONLY user-facing text (tab label "Clubs", the Clubs panel, request-a-club, active-club switcher, invites, club course library, admin club requests/oversight, Users list, money ledger copy, join-link page, help/FAQ, activity-log summaries, notification labels). The header selector, empty states, and confirm dialogs now say Club.
- Deliberately LEFT the in-game "Group" concept unchanged: tee groups, group scoring, group scorecard, group scorer, "keep score for this group", playing groups, the game-setup Groups tab. Those are a different thing and still read "Group".
- Database and code internals are UNCHANGED — tables (groups, group_members, group_invites, group_guests), columns (group_id), functions (create_group_invite_multi, is_group_admin, join_default_group), tab keys ("groups"), deep-link ?tab=groups, action enums (group_requested/approved), and props (isGroupAdmin) all still use "group". This keeps the rename zero-risk; users never see those names.
- NO migration. Verified: tsc clean, tests pass, build clean. Creation is still request-and-approve (v1.106.0 made the Clubs tab visible to everyone so any member can request one).
