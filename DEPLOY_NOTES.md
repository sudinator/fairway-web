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

## v1.108.0 — Show names not emails in member-facing lists + one-time name title-case backfill (RUN migration 0071)
- Club member list (Clubs tab): now ordered alphabetically by name; the redundant email line under each name is gone. Names show for everyone who has one (which is everyone who's signed in — the app gates all use behind the name screen). Email only appears as the identifier for a PENDING invite (someone added by email who hasn't signed in yet). Remove-confirm now uses the name.
- Players · Current Club tab: the email on the right is now shown ONLY when a player has no name yet (pending invite); named members without a phone show nothing there instead of their email.
- Admin Users panel: unchanged — still shows email, since it's your account-management view and abandoned signups may have no name.
- Migration 0071 (data backfill, full SQL below): title-cases existing profile names to match the app's on-save titleCaseName exactly — capitalises the first letter of each word (after start / space / apostrophe / hyphen) only when lowercase; leaves ALL-CAPS and intentional mid-caps like McDonald/DeVito untouched. Verified char-for-char against the JS function on real Postgres. Safe to re-run.
- Verified: tsc clean, tests pass, build clean.

### 0071_title_case_names.sql
```sql
-- 0071_title_case_names.sql
-- One-time backfill: title-case existing profile names the same way the app now does
-- on save (lib/golf.ts titleCaseName). It uppercases the first letter of each word
-- (start of string, or after a space, apostrophe, or hyphen) ONLY when that letter is
-- lowercase. It deliberately does NOT lowercase anything, so intentional mid-word caps
-- (McDonald, DeVito) and ALL-CAPS names are left untouched — exactly matching the app.
-- Safe to re-run: rows already correct are skipped.
create or replace function public.bnn_title_case(s text) returns text
language plpgsql immutable as $fn$
declare result text := ''; i int; ch text; prev text := '';
begin
  if s is null then return null; end if;
  for i in 1..length(s) loop
    ch := substr(s, i, 1);
    if (i = 1 or prev ~ '[\s''\-]') and ch ~ '[a-z]' then
      result := result || upper(ch);
    else
      result := result || ch;
    end if;
    prev := ch;
  end loop;
  return result;
end $fn$;

update public.profiles
set display_name = public.bnn_title_case(display_name)
where display_name is not null
  and display_name <> public.bnn_title_case(display_name);

drop function public.bnn_title_case(text);
```

## v1.108.1 — Members can read their club-mates' names/avatars (RLS fix, RUN migration 0072)
- Root cause: the profiles SELECT policy was `id = auth.uid() OR is_admin()`, so a non-admin member could read only their own profile row. Everywhere the app reads other members' profiles (Club member list, Players tab, Money tab + payment handles, game-setup roster, tee-group shuffle, notify-admins-on-request), RLS silently returned nothing for co-members, so they showed as emails + letter avatars. App admins never saw it (is_admin() reads all). Names were always in the DB.
- Fix (migration 0072, full SQL below): a SECURITY DEFINER helper `shares_active_club(other)` checks whether the caller shares an ACTIVE club (group) with a given user, and the profiles SELECT policy is widened to `id = auth.uid() OR is_admin() OR shares_active_club(id)`. The helper is SECURITY DEFINER so the policy's subquery isn't itself filtered by group_members RLS (avoids recursive-RLS).
- No app code changes — this fixes all six read sites at once. Tradeoff accepted: co-members can read each other's row (incl. email) at the API level; the UI still shows names, not emails.
- Validated on real Postgres with RLS enforced under a non-owner role: pre-fix a member saw only themselves; post-fix a member sees self + co-members only (not strangers), a stranger sees only their own club, an app admin sees all; idempotent on re-run.

### 0072_profiles_readable_by_comembers.sql
```sql
-- 0072_profiles_readable_by_comembers.sql
-- Members could only read their OWN profile row (SELECT policy was
-- `id = auth.uid() OR is_admin()`), so non-admin members saw emails + letter avatars
-- instead of their club-mates' names/photos everywhere (Club member list, Players tab,
-- Money tab, game-setup roster, tee-group shuffle). App admins never saw the bug because
-- is_admin() let them read all rows. This lets a member also read the profile of anyone
-- they share an ACTIVE club (group) with. A SECURITY DEFINER helper does the co-membership
-- check so the policy's own subquery isn't itself filtered by group_members' RLS.
create or replace function public.shares_active_club(other uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from group_members me
    join group_members them on them.group_id = me.group_id
    where me.user_id = auth.uid() and me.status = 'active'
      and them.user_id = other  and them.status = 'active'
  );
$$;

drop policy if exists "read own or admin all" on public.profiles;
drop policy if exists "read own, co-members, or admin" on public.profiles;
create policy "read own, co-members, or admin" on public.profiles
for select using (
  id = auth.uid()
  or public.is_admin()
  or public.shares_active_club(id)
);
```

## v1.109.0 — Wire four more event notifications (RUN migration 0073)
Adds SECURITY DEFINER triggers (fan-out, same pattern as 0070) for the four event-driven types that were showing "· soon", and flips them to live in the Profile → Notifications menu. All four default to In-app (they only push if a user opts that type up to Push). tee_reminder stays "· soon" — it's time-based and needs a scheduler (pg_cron), a separate build.
- tee_new: on tee_times INSERT -> notifies all active club members except the creator; link /?tt=<id>.
- bet_posted: on expenses INSERT where source_kind='tgc_bet' -> notifies the game's players except the poster; de-duped per user+club per 6h so bet re-posts (delete+reinsert) don't spam; link /?tab=money.
- game_finished: on games UPDATE when status flips to 'ended' (guarded so it fires once) -> notifies the game's players; link /?tab=games.
- group_member: on group_members INSERT/UPDATE when a row becomes active (join, or invited->active) -> notifies the OTHER active members ("<Name> joined <Club>."); the club's first member (creator) pings no one; link /?tab=groups.
- No route change (DEFAULT_DELIVERY already had these types). No client wiring needed — triggers fire regardless of code path.
- Validated on real Postgres: correct recipients, creator/poster excluded, game-finished fires once, bet re-post deduped, idempotent.

### 0073_push_events_more.sql
```sql
-- 0073_push_events_more.sql
-- Four more event notifications (fan-out via SECURITY DEFINER triggers, like 0070).
-- Defaults (client + route DEFAULT_DELIVERY) are in-app for all four, so they only
-- buzz a phone if the user opts that type up to Push.

-- 1) New tee time posted -> notify all active club members except the creator.
create or replace function public.notify_tee_new() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into notifications (user_id, message, group_id, type, link)
  select gm.user_id, 'New tee time posted — tap to RSVP.', new.group_id, 'tee_new', '/?tt=' || new.id::text
  from group_members gm
  where gm.group_id = new.group_id and gm.status = 'active' and gm.user_id is not null
    and gm.user_id is distinct from new.created_by;
  return new;
end $fn$;
drop trigger if exists trg_notify_tee_new on public.tee_times;
create trigger trg_notify_tee_new after insert on public.tee_times
  for each row execute function public.notify_tee_new();

-- 2) A bet was posted -> notify the game's players (not the poster). De-duped per
--    user+club per 6h so bet re-posts (delete+reinsert) don't spam.
create or replace function public.notify_bet_posted() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.source_kind is distinct from 'tgc_bet' or new.source_game_id is null then return new; end if;
  insert into notifications (user_id, message, group_id, type, link)
  select gp.user_id, 'A bet was posted in your game — see the Money tab.', new.group_id, 'bet_posted', '/?tab=money'
  from game_players gp
  where gp.game_id = new.source_game_id and gp.user_id is not null
    and gp.user_id is distinct from new.created_by
    and not exists (
      select 1 from notifications n
      where n.user_id = gp.user_id and n.type = 'bet_posted'
        and n.group_id is not distinct from new.group_id
        and n.created_at > now() - interval '6 hours'
    );
  return new;
end $fn$;
drop trigger if exists trg_notify_bet_posted on public.expenses;
create trigger trg_notify_bet_posted after insert on public.expenses
  for each row execute function public.notify_bet_posted();

-- 3) Game finished -> notify the game's players when status flips to 'ended'.
create or replace function public.notify_game_finished() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.status is distinct from 'ended' or old.status is not distinct from 'ended' then return new; end if;
  insert into notifications (user_id, message, group_id, type, link)
  select gp.user_id, 'Your game is final — see the results.', new.group_id, 'game_finished', '/?tab=games'
  from game_players gp
  where gp.game_id = new.id and gp.user_id is not null;
  return new;
end $fn$;
drop trigger if exists trg_notify_game_finished on public.games;
create trigger trg_notify_game_finished after update on public.games
  for each row execute function public.notify_game_finished();

-- 4) New member joins a club -> notify the OTHER active members. Fires when a row
--    becomes active (insert active, or invited->active), not on the club's first member.
create or replace function public.notify_group_member() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare nm text; cn text;
begin
  if new.user_id is null or new.status is distinct from 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'active' then return new; end if;
  select coalesce(nullif(display_name, ''), 'A new golfer') into nm from profiles where id = new.user_id;
  select name into cn from groups where id = new.group_id;
  insert into notifications (user_id, message, group_id, type, link)
  select gm.user_id, coalesce(nm, 'A new golfer') || ' joined ' || coalesce(cn, 'your club') || '.', new.group_id, 'group_member', '/?tab=groups'
  from group_members gm
  where gm.group_id = new.group_id and gm.status = 'active' and gm.user_id is not null
    and gm.user_id is distinct from new.user_id;
  return new;
end $fn$;
drop trigger if exists trg_notify_group_member on public.group_members;
create trigger trg_notify_group_member after insert or update on public.group_members
  for each row execute function public.notify_group_member();
```

### Migration 0074 — tee-time reminders (pg_cron)
Enables pg_cron + schedules send_tee_reminders() every 15 min. Inserts tee_reminder
notifications only (webhook/push handles delivery). If the SQL editor errors on the
`create extension` line, enable pg_cron first via Dashboard -> Database -> Extensions,
then re-run. Verify with: select * from cron.job where jobname='tee-reminders';
Push still requires the webhook + Vercel env vars to be live to reach phones.
```sql
-- 0074_tee_reminders.sql
-- Time-based tee-time reminders, delivered through the existing
-- notifications -> Database Webhook -> /api/push pipeline (type 'tee_reminder', def push).
-- The scheduler only INSERTS notification rows; no pg_net / Edge Function needed.
--
-- Two reminders, both de-duplicated per (user, tee time, reminder-kind) via the link marker:
--   A) Deadline nudge  : 24h before signup_deadline, to ACTIVE club members who have NOT responded.
--   B) Morning-of      : 06:00-11:59 America/New_York on play_date, to players who chose 'in'.
--
-- pg_cron runs in UTC; that is fine because the windows are computed against stored
-- timestamps (signup_deadline is timestamptz; play_date is compared in America/New_York).

create extension if not exists pg_cron;

create or replace function public.send_tee_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A) Deadline nudge: within 24h of the signup deadline, members with no RSVP row yet.
  insert into notifications (user_id, message, group_id, type, link)
  select gm.user_id,
         'RSVP closes soon for the ' || to_char(t.play_date, 'Dy, Mon FMDD')
           || ' tee time — let your club know if you''re in.',
         t.group_id,
         'tee_reminder',
         '/?tt=' || t.id::text || '&r=deadline'
  from public.tee_times t
  join public.group_members gm
    on gm.group_id = t.group_id
   and gm.status = 'active'
   and gm.user_id is not null
  where t.status = 'upcoming'
    and t.signup_deadline is not null
    and now() >= t.signup_deadline - interval '24 hours'
    and now() <  t.signup_deadline
    and not exists (
      select 1 from public.tee_time_rsvps r
      where r.tee_time_id = t.id and r.user_id = gm.user_id
    )
    and not exists (
      select 1 from public.notifications n
      where n.user_id = gm.user_id
        and n.type = 'tee_reminder'
        and n.link = '/?tt=' || t.id::text || '&r=deadline'
    );

  -- B) Morning-of: on the play date (06:00-11:59 Eastern), to players who said 'in'.
  insert into notifications (user_id, message, group_id, type, link)
  select r.user_id,
         'Tee time today — ' || to_char(t.play_date, 'Dy, Mon FMDD') || '. See you out there.',
         t.group_id,
         'tee_reminder',
         '/?tt=' || t.id::text || '&r=day'
  from public.tee_times t
  join public.tee_time_rsvps r
    on r.tee_time_id = t.id
   and r.choice = 'in'
   and r.user_id is not null
  where t.status = 'upcoming'
    and (now() at time zone 'America/New_York')::date = t.play_date
    and extract(hour from (now() at time zone 'America/New_York')) >= 6
    and extract(hour from (now() at time zone 'America/New_York')) < 12
    and not exists (
      select 1 from public.notifications n
      where n.user_id = r.user_id
        and n.type = 'tee_reminder'
        and n.link = '/?tt=' || t.id::text || '&r=day'
    );
end;
$$;

-- Schedule it every 15 minutes. Idempotent: drop an existing job of the same name first.
do $$
begin
  perform cron.unschedule('tee-reminders');
exception when others then
  null;
end;
$$;

select cron.schedule('tee-reminders', '*/15 * * * *', $$ select public.send_tee_reminders(); $$);
```

### Migration 0075 — tee-time roles (members create, creator organizes, captain runs game)
Opens tee-time creation to any active member, lets the creator manage signups, and adds
two SECURITY DEFINER RPCs (set_tee_time_captain, link_tee_time_game). No new tables.
Validated on Postgres with a 15-case authorization matrix (non-owner role).
```sql
-- 0075_tee_time_roles.sql
-- Looser tee-time roles:
--   * ANY active group member can create a tee time (was admin/owner only).
--   * The tee-time CREATOR can manage everyone's RSVPs for that tee time
--     (mark in/out, promote from waitlist, remove guests) — "acts as admin" for it.
--   * Captain assignment/reassignment (admin, creator, or current captain) and
--     game linking (the captain who created the game) go through SECURITY DEFINER
--     RPCs so neither grants blanket edit rights over the tee time.
-- Creating/editing/cancelling the tee time itself is unchanged (creator or admin).

-- 1) Any active member can create a tee time (created_by must be the caller, no spoofing).
drop policy if exists tt_insert on public.tee_times;
create policy tt_insert on public.tee_times for insert
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.group_members gm
                where gm.group_id = tee_times.group_id and gm.user_id = auth.uid()
                  and gm.status = 'active'));

-- 2) RSVP writes: the tee-time CREATOR joins admins/owners as an "organizer" who can
--    write anyone's RSVP (members can still write only their own).
drop policy if exists ttr_insert on public.tee_time_rsvps;
create policy ttr_insert on public.tee_time_rsvps for insert
  with check (
    exists (select 1 from public.tee_times t
              join public.group_members gm on gm.group_id = t.group_id
            where t.id = tee_time_rsvps.tee_time_id and gm.user_id = auth.uid() and gm.status = 'active')
    and (
      user_id = auth.uid()
      or exists (select 1 from public.tee_times t2
                   join public.group_members gm2 on gm2.group_id = t2.group_id
                 where t2.id = tee_time_rsvps.tee_time_id and gm2.user_id = auth.uid()
                   and gm2.status = 'active' and gm2.role in ('admin','owner'))
      or exists (select 1 from public.tee_times t3
                 where t3.id = tee_time_rsvps.tee_time_id and t3.created_by = auth.uid())
    ));

drop policy if exists ttr_update on public.tee_time_rsvps;
create policy ttr_update on public.tee_time_rsvps for update
  using (
    user_id = auth.uid()
    or exists (select 1 from public.tee_times t
                 join public.group_members gm on gm.group_id = t.group_id
               where t.id = tee_time_rsvps.tee_time_id and gm.user_id = auth.uid()
                 and gm.status = 'active' and gm.role in ('admin','owner'))
    or exists (select 1 from public.tee_times t3
               where t3.id = tee_time_rsvps.tee_time_id and t3.created_by = auth.uid()));

drop policy if exists ttr_delete on public.tee_time_rsvps;
create policy ttr_delete on public.tee_time_rsvps for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.tee_times t
                 join public.group_members gm on gm.group_id = t.group_id
               where t.id = tee_time_rsvps.tee_time_id and gm.user_id = auth.uid()
                 and gm.status = 'active' and gm.role in ('admin','owner'))
    or exists (select 1 from public.tee_times t3
               where t3.id = tee_time_rsvps.tee_time_id and t3.created_by = auth.uid()));

-- 3) Assign/reassign the captain. Authorized: group admin, tee-time creator, or the
--    current captain. A named captain must be signed up "in" for the round. NULL clears it.
create or replace function public.set_tee_time_captain(p_tee_time_id uuid, p_new_captain uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_group uuid; v_creator uuid; v_captain uuid;
begin
  select group_id, created_by, captain_user_id into v_group, v_creator, v_captain
  from public.tee_times where id = p_tee_time_id;
  if v_group is null then raise exception 'Tee time not found'; end if;
  if not (public.is_group_admin(v_group, v_uid) or v_creator = v_uid or v_captain = v_uid) then
    raise exception 'Not authorized to set the captain';
  end if;
  if p_new_captain is not null and not exists (
       select 1 from public.tee_time_rsvps r
       where r.tee_time_id = p_tee_time_id and r.user_id = p_new_captain and r.choice = 'in') then
    raise exception 'Captain must be signed up as In for this round';
  end if;
  update public.tee_times set captain_user_id = p_new_captain, updated_at = now()
  where id = p_tee_time_id;
end;
$$;
grant execute on function public.set_tee_time_captain(uuid, uuid) to authenticated;

-- 4) Link a created game back to its tee time. Authorized: the caller must have CREATED
--    the game, be in the same group, and be the tee time's captain (or its creator/admin).
create or replace function public.link_tee_time_game(p_tee_time_id uuid, p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_tt_group uuid; v_creator uuid; v_captain uuid;
        v_game_group uuid; v_game_creator uuid;
begin
  select group_id, created_by, captain_user_id into v_tt_group, v_creator, v_captain
  from public.tee_times where id = p_tee_time_id;
  if v_tt_group is null then raise exception 'Tee time not found'; end if;
  select group_id, created_by into v_game_group, v_game_creator
  from public.games where id = p_game_id;
  if v_game_group is null then raise exception 'Game not found'; end if;
  if v_game_creator is distinct from v_uid then raise exception 'You can only link a game you created'; end if;
  if v_game_group is distinct from v_tt_group then raise exception 'Game and tee time are in different groups'; end if;
  if not (public.is_group_admin(v_tt_group, v_uid) or v_creator = v_uid or v_captain = v_uid) then
    raise exception 'Not authorized to link this tee time';
  end if;
  update public.tee_times set game_id = p_game_id, updated_at = now()
  where id = p_tee_time_id;
end;
$$;
grant execute on function public.link_tee_time_game(uuid, uuid) to authenticated;
```

### v1.111.1 — bet-post error hardening + migration audit (no migration)
Code-only. Both bet-post paths surface the real DB error + console.error the error objects.
New ops tool: `ci/verify_migrations.sql` — run it in the Supabase SQL editor any time to confirm
which migrations are applied. It lists one sentinel object per migration file and reports
present=true/false; any `false` row means that migration hasn't been applied to that database.
(This is the check that would have caught the missing 0063 `expense_shares.sponsor_user_id` column.)

### v1.111.2 — duplicate-hole fix (migrations 0076 + 0077, run 0076 first)
Prevents a round ending up with each hole stored twice (which doubled gross/net/
Stableford + scoring buckets and rendered each hole twice). Root cause: no unique
constraint on holes(round_id,hole_number) + concurrent delete-then-insert posts.
Also a client guard (dedupeHoles in lib/golf.ts) applied in home.tsx & manage.tsx.

Run 0076 FIRST (unique index), then 0077 (functions rely on it for ON CONFLICT).

```sql
-- 0076_holes_unique.sql
create unique index if not exists holes_round_hole_uk
  on public.holes (round_id, hole_number);
```

Then 0077 (full SQL in migrations/0077_holes_upsert.sql — both posting functions
rewritten with ON CONFLICT (round_id, hole_number) DO UPDATE on the hole insert):
```sql
-- 0077_holes_upsert.sql
-- Make the per-hole writes in the round-posting functions idempotent under concurrency.
-- Both post_game_rounds and post_group_rounds do `delete from holes where round_id = rid`
-- then insert one row per played hole. Under READ COMMITTED, two concurrent posts of the
-- same (game,user) each snapshot no committed holes, so both delete-nothing and both insert
-- a full set -> the round ends up with every hole doubled (36 rows for 18), which doubles
-- gross/net/Stableford and the scoring buckets and renders each hole twice.
--
-- Fix: the hole insert now uses ON CONFLICT (round_id, hole_number) DO UPDATE, so the losing
-- racer updates the existing row in place instead of inserting a duplicate. Requires the
-- unique index from 0076 (holes_round_hole_uk) — run 0076 first.
-- Only the hole-insert clause changed; everything else matches 0044/0045.

create or replace function public.post_game_rounds(p_game uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g       record;
  pl      record;
  rid     uuid;
  hmeta   jsonb;
  n       int;
  i       int;
  sc      int;
  gross   int;
  entered int;
  rdate   date;
begin
  select * into g from games where id = p_game;
  if not found then return; end if;
  if g.created_by is distinct from auth.uid() then return; end if;

  hmeta := coalesce(g.holes_meta, '[]'::jsonb);
  n := jsonb_array_length(hmeta);
  rdate := coalesce(g.played_at, g.created_at::date, current_date);

  for pl in
    select * from game_players where game_id = p_game and user_id is not null
  loop
    gross := 0; entered := 0;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        entered := entered + 1;
        gross := gross + sc;
      end if;
    end loop;
    if entered = 0 then continue; end if;

    select id into rid from rounds where game_id = p_game and user_id = pl.user_id limit 1;
    if rid is not null then
      update rounds set
        course = g.course, tee_name = pl.tee_name, rating = pl.rating, slope = pl.slope,
        course_par = g.course_par, handicap_index = pl.handicap_index,
        course_handicap = pl.course_handicap, group_id = g.group_id,
        played_at = rdate, status = 'final', gross_score = gross
      where id = rid;
    else
      insert into rounds (
        user_id, course, tee_name, rating, slope, course_par, handicap_index,
        course_handicap, group_id, played_at, status, gross_score, game_id
      ) values (
        pl.user_id, g.course, pl.tee_name, pl.rating, pl.slope, g.course_par, pl.handicap_index,
        pl.course_handicap, g.group_id, rdate, 'final', gross, p_game
      )
      on conflict (game_id, user_id) do update set
        course = excluded.course, tee_name = excluded.tee_name, rating = excluded.rating,
        slope = excluded.slope, course_par = excluded.course_par,
        handicap_index = excluded.handicap_index, course_handicap = excluded.course_handicap,
        group_id = excluded.group_id, played_at = excluded.played_at,
        status = excluded.status, gross_score = excluded.gross_score
      returning id into rid;
    end if;

    delete from holes where round_id = rid;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        insert into holes (
          round_id, hole_number, par, stroke_index, strokes, putts, fairway, penalties, sand, yardage
        ) values (
          rid,
          (hmeta->i->>'n')::int,
          (hmeta->i->>'par')::int,
          nullif(hmeta->i->>'si','')::int,
          sc,
          nullif(pl.putts->>i, '')::int,
          nullif(pl.fairways->>i, ''),
          coalesce(nullif(pl.penalties->>i, '')::int, 0),
          coalesce((pl.sand->>i)::boolean, false),
          nullif(hmeta->i->>'yards','')::int
        )
        on conflict (round_id, hole_number) do update set
          par = excluded.par, stroke_index = excluded.stroke_index, strokes = excluded.strokes,
          putts = excluded.putts, fairway = excluded.fairway, penalties = excluded.penalties,
          sand = excluded.sand, yardage = excluded.yardage;
      end if;
    end loop;
  end loop;
end;
$$;

grant execute on function public.post_game_rounds(uuid) to authenticated;

create or replace function public.post_group_rounds(p_game uuid, p_tee_group int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g       record;
  pl      record;
  rid     uuid;
  hmeta   jsonb;
  n       int;
  i       int;
  sc      int;
  gross   int;
  entered int;
  rdate   date;
begin
  select * into g from games where id = p_game;
  if not found then return; end if;
  if not exists (
    select 1 from game_players where game_id = p_game and user_id = auth.uid()
  ) then
    return;
  end if;

  hmeta := coalesce(g.holes_meta, '[]'::jsonb);
  n := jsonb_array_length(hmeta);
  rdate := coalesce(g.played_at, g.created_at::date, current_date);

  for pl in
    select * from game_players
    where game_id = p_game and user_id is not null and tee_group = p_tee_group
  loop
    gross := 0; entered := 0;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        entered := entered + 1;
        gross := gross + sc;
      end if;
    end loop;
    if entered = 0 then continue; end if;

    select id into rid from rounds where game_id = p_game and user_id = pl.user_id limit 1;
    if rid is not null then
      update rounds set
        course = g.course, tee_name = pl.tee_name, rating = pl.rating, slope = pl.slope,
        course_par = g.course_par, handicap_index = pl.handicap_index,
        course_handicap = pl.course_handicap, group_id = g.group_id,
        played_at = rdate, status = 'final', gross_score = gross
      where id = rid;
    else
      insert into rounds (
        user_id, course, tee_name, rating, slope, course_par, handicap_index,
        course_handicap, group_id, played_at, status, gross_score, game_id
      ) values (
        pl.user_id, g.course, pl.tee_name, pl.rating, pl.slope, g.course_par, pl.handicap_index,
        pl.course_handicap, g.group_id, rdate, 'final', gross, p_game
      )
      on conflict (game_id, user_id) do update set
        course = excluded.course, tee_name = excluded.tee_name, rating = excluded.rating,
        slope = excluded.slope, course_par = excluded.course_par,
        handicap_index = excluded.handicap_index, course_handicap = excluded.course_handicap,
        group_id = excluded.group_id, played_at = excluded.played_at,
        status = excluded.status, gross_score = excluded.gross_score
      returning id into rid;
    end if;

    delete from holes where round_id = rid;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        insert into holes (
          round_id, hole_number, par, stroke_index, strokes, putts, fairway, penalties, sand, yardage
        ) values (
          rid,
          (hmeta->i->>'n')::int,
          (hmeta->i->>'par')::int,
          nullif(hmeta->i->>'si','')::int,
          sc,
          nullif(pl.putts->>i, '')::int,
          nullif(pl.fairways->>i, ''),
          coalesce(nullif(pl.penalties->>i, '')::int, 0),
          coalesce((pl.sand->>i)::boolean, false),
          nullif(hmeta->i->>'yards','')::int
        )
        on conflict (round_id, hole_number) do update set
          par = excluded.par, stroke_index = excluded.stroke_index, strokes = excluded.strokes,
          putts = excluded.putts, fairway = excluded.fairway, penalties = excluded.penalties,
          sand = excluded.sand, yardage = excluded.yardage;
      end if;
    end loop;
  end loop;
end;
$$;

grant execute on function public.post_group_rounds(uuid, int) to authenticated;
```

### v1.111.3 — push: iPhone install warning + subscription hardening (NO migration)
Client-only; deploy is unzip -> commit -> Vercel, no SQL to run.
- manage.tsx: install_ios state now shows an explicit red warning + numbered Safari-install
  steps; toggle on/off reflects real server enrollment via syncPushSubscription (not just the
  browser subscription), so it can't show a false "on".
- lib/push.ts: syncPushSubscription(userId) upserts the current browser subscription on open.
- app/page.tsx: calls syncPushSubscription on app open for a logged-in (online) user.
Reminder unrelated to this release but still pending from before: run migrations 0075, then
0076 and 0077 (0076 before 0077), plus optional 0071 and recommended 0073.

### v1.112.0 — capabilities single-source + auto-synced one-pagers + Help link (NO migration)
Client + tooling; deploy is unzip -> commit -> Vercel (the served PDFs ship in public/).
- `lib/capabilities.json`: single source of truth for app capabilities (edition-tagged).
- Help page (`manage.tsx` HelpPage) renders a live "What Birdie Num Num can do" section from
  that file (TGC members see the TGC edition + exclusives; other clubs see the club edition),
  with a "Download one-pager (PDF)" link to /BNN-onepager-tgc.pdf or /BNN-onepager-club.pdf.
- `marketing/make_onepagers.py` reads capabilities.json, writes public/BNN-onepager-{club,tgc}.pdf
  (deterministic: reportlab invariant mode) + marketing/onepager-content.txt manifest.
- Refresh sheets after editing capabilities.json:  npm run gen:onepagers
- CI `.github/workflows/robustness.yml` job `onepager-sync` installs reportlab==4.4.10, runs the
  generator, and fails if marketing/onepager-content.txt drifts (list changed but sheets not regenerated).

### v1.113.0 — admin golf-cadence engagement analytics (migration 0078)
New is_admin-gated RPC get_admin_engagement() + AdminEngagement panel (renders under the
existing admin analytics). Reads only rounds, server-side JSON (free-tier friendly).
Run 0078 in the SQL editor:
```sql
-- 0078_admin_engagement.sql
-- Golf-cadence engagement metrics for the admin analytics panel. Complements the existing
-- get_admin_analytics() (which is DAU/app-open framed). Golf is weekend-skewed and episodic,
-- so these measure the RIGHT unit (the round) on the RIGHT cycle (the week / the golf weekend):
--   * WAU/MAU on rounds (honest stickiness, not DAU/MAU)
--   * weekend reach series (distinct golfers logging Fri-Sun, per ISO week, last 12 weeks)
--   * weekend vs weekday share (validates the Fri-Sun skew)
--   * rounds per active golfer per ~month (28d)
--   * new vs returning golfers per week (based on first-ever round, not app-opens)
--   * feature split: rounds played inside a game vs solo
-- All read only `rounds` (deleted_at is null), server-side, returned as one JSON payload so the
-- client never does broad table reads (free-tier friendly). Postgres dow: Sun=0..Sat=6, so a
-- "golf weekend" is dow in (5,6,0) = Fri/Sat/Sun, all within the same ISO week (Mon-start).

create or replace function public.get_admin_engagement()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  j jsonb;
  v_wau int; v_mau int; v_active28 int; v_rounds28 int;
begin
  if not public.is_admin() then
    raise exception 'admins only';
  end if;

  select count(distinct user_id) into v_wau  from rounds where deleted_at is null and played_at > current_date - 7;
  select count(distinct user_id) into v_mau  from rounds where deleted_at is null and played_at > current_date - 30;
  select count(distinct user_id) into v_active28 from rounds where deleted_at is null and played_at > current_date - 28;
  select count(*)                into v_rounds28  from rounds where deleted_at is null and played_at > current_date - 28;

  j := jsonb_build_object(
    'wau', v_wau,
    'mau', v_mau,
    'wau_mau_pct', case when v_mau > 0 then round(100.0 * v_wau / v_mau) else 0 end,
    'active_28d', v_active28,
    'rounds_28d', v_rounds28,
    'rounds_per_active_mo', case when v_active28 > 0 then round(v_rounds28::numeric / v_active28, 1) else 0 end,
    'weekend_share_pct', coalesce((
      select round(100.0 * count(*) filter (where extract(dow from played_at) in (5,6,0)) / nullif(count(*), 0))
      from rounds where deleted_at is null and played_at > current_date - 90), 0),
    'weekend_series', coalesce((
      select jsonb_agg(jsonb_build_object('week', to_char(wk + 5, 'Mon DD'), 'golfers', g, 'rounds', r) order by wk)
      from (
        select date_trunc('week', played_at)::date wk,
               count(distinct user_id) filter (where extract(dow from played_at) in (5,6,0)) g,
               count(*)                filter (where extract(dow from played_at) in (5,6,0)) r
        from rounds
        where deleted_at is null and played_at > current_date - 7 * 12
        group by 1
      ) s), '[]'::jsonb),
    'weekly_new_returning', coalesce((
      select jsonb_agg(jsonb_build_object('week', to_char(wk, 'Mon DD'), 'new', nw, 'returning', rt) order by wk)
      from (
        select date_trunc('week', r.played_at)::date wk,
               count(distinct r.user_id) filter (where fr.first_week = date_trunc('week', r.played_at)::date) nw,
               count(distinct r.user_id) filter (where fr.first_week < date_trunc('week', r.played_at)::date) rt
        from rounds r
        join (
          select user_id, date_trunc('week', min(played_at))::date first_week
          from rounds where deleted_at is null group by user_id
        ) fr on fr.user_id = r.user_id
        where r.deleted_at is null and r.played_at > current_date - 7 * 12
        group by 1
      ) s), '[]'::jsonb),
    'feature', jsonb_build_object(
      'in_game', (select count(*) from rounds where deleted_at is null and game_id is not null and played_at > current_date - 90),
      'solo',    (select count(*) from rounds where deleted_at is null and game_id is null     and played_at > current_date - 90)
    )
  );
  return j;
end;
$function$;

grant execute on function public.get_admin_engagement() to authenticated;
```

### v1.114.0 — WHS partial-round handicap (net-par fill) — NO migration
Pure client logic + UI. Deploy is unzip -> commit -> Vercel.
- lib/golf.ts roundDifferential: rounds of 9–17 played holes now produce a differential.
  Played holes are capped at net double bogey; each unplayed hole is filled at net par.
  Net-par fill is derived from course totals (no per-hole data for unplayed holes needed):
    unplayed par     = course_par - sum(played par)
    unplayed strokes = course_handicap - sum(strokes received on played holes)
  Nine-hole floor enforced (fewer than 9 played -> no differential, unchanged for full 18).
- lib/golf.ts partialHandicapInfo(round): { played, filled, missing[] } | null for the UI.
- round-detail.tsx: "Partial round — counted for your handicap" banner (shows which holes
  were net-par-filled + the resulting differential).
- rounds-list.tsx: compact "· N net par for hcp" note on the row.
- Regression test (lib/golf.test.ts) pins the real Francis Byrne 15-hole round to differential 12.5.

### v1.115.0 — unfinished-round guard + discard-all (NO migration)
Client only. Deploy is unzip -> commit -> Vercel.
- home.tsx: ＋ New round is gated — if an in_progress round exists, it routes to the dashboard
  banner to resolve first (alert explains) instead of creating another round.
- Tracks the full in_progress list (not just the most recent); banner shows the count and a
  "Discard all N" button (soft-delete via deleted_at) alongside Finish / Mark complete / Delete.
- Background: RoundEditor.backgroundSave writes an in_progress row per session (device-loss
  redundancy); abandoned sessions previously accumulated because only the newest was surfaced.
  In_progress rounds are already excluded from stats/handicap (home.tsx finished filter).

One-time cleanup of existing orphans (safe — soft-delete, never touches finalized rounds):
  update rounds set deleted_at = now()
  where status = 'in_progress' and deleted_at is null;

### v1.115.1 — partial-round banner prominence + "thru X holes" (NO migration)
Client only. Refinements to partial-round display.
- round-detail.tsx: partial-round handicap banner restyled (Option A) — full gold border +
  gold glow, flag icon, gold "Differential N.N" chip. More prominent than the thin left rule.
- round-detail.tsx header + rounds-list.tsx row: a partial hole-by-hole round now shows
  "thru N" next to its score, so a 15-hole total never reads like a full 18.

### v1.115.2 — scorecard "thru N" + banner chip removed (NO migration)
Client only.
- ui.tsx ScoreViewCard: the OUT/IN/TOTAL summary now flags a partial round — the TOTAL box
  shows a "THRU N" sublabel and a "Through N holes — not a full 18" caption, so a 15-hole 73
  never reads as a full-18 73.
- round-detail.tsx: removed the gold "Differential N.N" chip from the partial-round banner
  (the differential already shows in the stats box directly below). Banner keeps its gold border.

### v1.116.0 — dashboard time-window toggle (NO migration)
Client only. First piece of the dashboard rework.
- dashboard.tsx: new Last 5 / Last 20 / Season / All toggle below the index hero. It windows the
  round set (`done`) that drives every stat card, average, and chart. `season` = current calendar
  year; `5`/`20` = most recent N by played_at; default `all` (preserves prior behavior).
- The WHS index (`hcp`) now computes from the FULL history (`allDone`), never the window — so the
  toggle can't distort the handicap. Empty state also keys off full history.

### v1.117.0 — index trajectory sparkline in the hero (NO migration)
Client only. Second piece of the dashboard rework.
- dashboard.tsx: idxTrail (useMemo on rounds) recomputes the running WHS index after each
  chronological round (full history); the hero now shows a gold sparkline of that trajectory
  plus "first → current ▼/▲ delta" and "index over N rounds". Higher on the chart = higher
  handicap, so improvement trends down (▼ green = index dropped, ▲ red = rose). Shown when
  there are ≥2 computed index points.

### v1.117.1 — handicap control visibility (NO migration)
Client only. The "Use as my handicap" button was unchanged by the rework, but its in-use state
was small grey text where the gold button had been, which read as "the button disappeared."
- dashboard.tsx: the in-use state is now a visible gold-bordered "✓ In use as your handicap"
  chip, so the control is clearly present whether or not the computed index is the one in use.
  (The gold "Use as my handicap" button still appears whenever the computed index differs from
  your saved handicap — unchanged.)

### v1.117.2 — clearer index-sparkline label (NO migration)
Client only. The sparkline sub-label "index over N rounds" read like a rolling average; changed
to "your index after each round". Each point is the running WHS index (best 8 of 20) as of that
round — not an average of scores. No logic change.

### v1.118.0 — shot-category synthesis + scrambling benchmark + one-line index delta (NO migration)
Client only. Third dashboard-rework piece.
- Index hero: the sparkline (v1.117.0) is replaced by a one-line delta ("▼ 2.6 since your first
  index (16.2)") — the scoring-form differential chart remains the trend view.
- lib/benchmarks.ts: added a `scramble` band (StatKey/DIR/LABEL/UNIT/DOMAIN + per-hcp bands),
  sourced from Break X up-and-down rates (0:50.0, 5:37.7, 10:31.6, 15:25.1, 20:21.7). bandFor
  now returns scramble.
- compare-stats.tsx: new ShotSynthesis component — off-tee/approach/short-game/putting on a
  band-relative 0–100 scale (50 = peer avg), verdict from the score (Strength ≥66 / On par /
  Focus ≤40), biggest-opportunity ranked by gap toward the shared Aspire goal. Scrambling held
  to a ≥15-round guard (noisy on small samples). CompareCard is now controlled (goalHcp prop,
  no internal selector) and shows the scramble track too.
- dashboard.tsx: shared `goalHcp` state lifted here (drives synthesis + CompareCard); effGoal
  defaults to the first goalOptions target. Synthesis rendered after the coach. Ball-striking
  stat row gated on `anyHoleDetail`; scores-only golfers see a one-line nudge instead. Synthesis
  and CompareCard self-hide when no stat has data.

### v1.119.0 — dashboard stat-grid regroup + synthesis readability (NO migration)
Client only. Final dashboard-rework piece.
- dashboard.tsx: 17 loose stat cards regrouped under section headers — SCORING (Rounds, Avg vs
  par, Best round, Avg differential, Stableford; always shown, works from scores) with a
  collapsible "scoring by par 3·4·5"; BALL-STRIKING (Fairways, GIR); SHORT GAME & PUTTING
  (Scrambling, Putts/hole) with a collapsible "more" (Sand saves, 3+ putts, Penalties). Par-type
  cards moved out of ball-striking into the SCORING collapse (they're scoring, not ball-striking).
  Ball-striking + short-game groups gated on anyHoleDetail; scores-only golfers see SCORING only
  plus the nudge. Collapses via moreScoring / moreShort state. Every card still taps to its trend.
- Hero: differentials-used list now hidden behind a "how?" toggle (showDiffs) to declutter the top.
- compare-stats.tsx: ShotSynthesis sub-lines + caption changed from faint grey (low contrast on
  green, and 9.5px under the 10px floor) to readable sage at 10.5px.

### v1.119.1 — compact Hole Outcomes (NO migration)
Client only. Replaced the Hole Outcomes donut + 5-row legend with a single horizontal stacked bar
(one strip = the round's composition), a compact wrapping legend (name · count · %), and a plain
cumulative takeaway "Par or better: X% · Doubles+: Y%" (clearer than the old double-negative). Same
categories/colors; ~⅓ the height. recharts PieChart/Pie imports removed (Cell still used elsewhere).

### v1.120.0 — dashboard reorder + How-you-compare restyle + hero layout (NO migration)
Client only.
- dashboard.tsx: section order is now Hero → time-window toggle → SCORING FORM chart → AI coach →
  scoring stat groups → stat drill-down → gaining/losing (synthesis) → how you compare → hole
  outcomes → recent rounds. (Toggle sits at top so it governs all windowed content incl. the
  scoring-form chart.)
- Hero: index number + Use-as-my-handicap button now float to the right; the eyebrow/WHS/delta text
  wraps around them, so the box is far more compact. "In use" chip shortened.
- compare-stats.tsx: extracted a shared CatBar row (name + verdict chip + 0–100 band-relative bar
  with peer tick + sub-line). Both ShotSynthesis and CompareCard now render through it, so "How you
  compare" matches "Where you're gaining & losing shots" — gold uppercase eyebrow, dark-green card,
  cream/sage text (dropped the serif title + light cream panels). CompareCard's sub-line is the
  detailed insight sentence; synthesis's is the goal delta. Removed the old Track/band + light-panel
  rendering.

### v1.120.1 — section-header expanders (NO migration)
Client only. dashboard.tsx: the "More/Less" collapse toggles for SCORING (par 3·4·5) and SHORT GAME &
PUTTING (sand saves · 3-putts · penalties) moved from a full-width dashed row at the bottom of each
section into a compact "＋ More / − Less" button on the right of the section-header rule — saves a row.
sectionHead now takes an optional right-side node; moreBtn helper removed, replaced by expandBtn.

### v1.120.2 — dashboard fixes + merge duplicate compare tile (NO migration)
Client only.
- Fix: AI-coach tile now has marginTop:16 so it no longer sits flush against the Scoring Form tile
  above it (the coach previously relied on the time-window toggle's bottom margin, which moved away
  in the reorder).
- Fix: several strings in compare-stats.tsx were written as literal \uXXXX escapes inside JSX *text*
  (not string literals), so they rendered as "\u2019" / "\u00b7" / "\u2014" on screen. Replaced all
  with the real characters (’ · —), so the eyebrow reads "WHERE YOU'RE GAINING & LOSING SHOTS" etc.
- Expander: the SCORING / SHORT GAME "More/Less" toggle is now a gold-bordered pill (faint gold fill
  when collapsed) so it's obviously tappable, instead of plain gold text.
- Merge: removed the "How you compare" (CompareCard) tile entirely — it duplicated the same four bars
  as "Where you're gaining & losing shots". Deleted CompareCard + its insight() helper from
  compare-stats.tsx and the import/usage from dashboard.tsx. The synthesis tile is now the single
  peer/goal card.

### v1.121.0 — tappable category explainers in the synthesis tile (NO migration)
Client only. compare-stats.tsx: each category row in "Where you're gaining & losing shots" (Off the
tee / Approach / Short game / Putting) is now tappable — an ⓘ marks it, and tapping expands a
"How it's measured / What to work on" panel beneath that row (one open at a time). Content lives in a
CAT_DESC record keyed by StatKey; the Short-game entry explains scrambling in plain English and points
to comparing with Putting + the Sand-saves stat. Added a one-line "tap a category" hint above the rows.
CatBar gained statKey/open/onToggle props; ShotSynthesis holds the openCat state (hook placed before
the null-index early return).

### v1.121.1 — fix: bottom nav detaching during pull-to-refresh (NO migration)
Client only. pull-to-refresh.tsx: the content wrapper animated the pull with `transform: translateY`.
A non-none transform makes that wrapper the containing block for `position: fixed` descendants, so
during a pull (i.e. dragging up at the top of the page) the fixed bottom <nav> in home.tsx re-anchored
to the bottom of the tall content wrapper and jumped toward the middle of the screen, snapping back on
release. Switched the pull animation to `margin-top` (visually identical, but creates no containing
block), so the nav — and every fixed modal/sheet that lives inside PullToRefresh — stays viewport-fixed
during a pull. Root cause predates the recent dashboard work; the wrapper was added with the June PWA
pull-to-refresh feature.

### v1.121.2 — belt-and-suspenders: nav moved fully outside PullToRefresh (NO migration)
Client only. Follow-up to v1.121.1. Investigation confirmed the pull-to-refresh transform was the ONLY
containing-block property anywhere on an ancestor of the fixed bottom <nav> (no persistent transform/
filter/contain/backdrop-filter exists in the shell, layout, or globals — there are no CSS files; all
styling is inline). In addition to switching the pull animation to margin-top (1.121.1), the <nav> and
the "More" sheet are now spliced OUT of the PullToRefresh subtree in home.tsx (they render as siblings
after </PullToRefresh>), so nothing inside PullToRefresh can ever re-anchor them again. The content
div's padding-bottom:96px still reserves space so content isn't hidden behind the fixed nav.
NOTE: if the nav still drifts after loading THIS build, the cause is not CSS containing-block — most
likely the installed PWA is still serving a cached older bundle (needs a hard update), or the trigger
differs from a pull gesture and needs to be characterised.

### v1.122.0 — chart tooltip restyle + TEMP nav debugger (NO migration)
Client only.
- Chart tooltip: replaced the old white `contentStyle` tooltip (background was C.card = #FFFDF6, i.e.
  near-white, with recharts' default black text) on BOTH dashboard charts with a shared <ChartTip>
  component — Option B: solid deep-green card, thin gold ring, gold label (course · player/date),
  cream values, null series filtered out. One component, both charts (scoring-form + stat drill-down).
- TEMP DIAGNOSTIC (components/nav-debug.tsx): owner-only (amitsud@gmail.com) fixed overlay reporting the
  loaded build version, live nav computed position/rect + STUCK/MOVING verdict (Δ from viewport bottom),
  and any ancestor with a containing-block property, with a Copy button. Nav tagged data-debug-nav.
  IF THE OWNER DOES NOT SEE THE GREEN PANEL, they are on a cached old build. REMOVE THIS COMPONENT +
  its import/render + the data-debug-nav attr once the nav bug is diagnosed.

### v1.122.1 — fix: bottom nav drifts on mobile (visual-viewport pin) (NO migration)
Client only. ROOT CAUSE (from the owner debug panel): on mobile window.innerHeight (layout viewport,
e.g. 956) is much larger than visualViewport.height (visible, e.g. 638) with visualViewport.offsetTop>0.
position:fixed anchors to the LAYOUT viewport, so bottom:0 sits on the taller phantom viewport and the
bar drifts out of the visible area. ancestorsCB was NONE — this was never a transform/containing-block
issue (so v1.121.1/.2 couldn't have fixed it). FIX: home.tsx pins the nav to the visual viewport — an
effect listens to visualViewport resize/scroll (+ window scroll/resize) and sets
nav.style.transform = translateY(-gap) where gap = innerHeight - (vv.height + vv.offsetTop). gap=0 on
desktop (viewports match) so it's a no-op there. nav carries a ref. Debug panel updated to self-pin
(translateY(offsetTop)) so it stays readable, and now reports gap(fix) + Δvis (rectBot vs vv.height) with
a PINNED/off verdict. NOTE: nav-debug is still shipped (owner-only) to verify the fix — REMOVE once Amit
confirms PINNED ✓ on his phone.

### v1.122.2 — real fix: bottom nav via flex layout, not position:fixed (NO migration)
Client only. Owner debug readings proved the drift was NOT a containing-block issue and NOT the visual
viewport: on the installed iOS PWA, window.innerHeight (956) is the true visible height, visualViewport
.height (638) is wrong, and content shows BELOW the nav — i.e. position:fixed itself is unreliable in an
iOS home-screen PWA (drifts during scroll). Reverted the v1.122.1 visualViewport transform. New shell:
home.tsx return is now a fixed-height flex column (height: calc(100dvh - env(safe-area-inset-top)),
display:flex, column, overflow:hidden). Content lives in an inner scroll container (scrollRef: flex:1,
minHeight:0, overflowY:auto, -webkit-overflow-scrolling:touch) wrapping InstallHint + PullToRefresh +
the page. The <nav> is now a NORMAL flex child (flexShrink:0, NOT position:fixed) so layout pins it to
the bottom and it physically cannot drift. Content padding-bottom dropped 96px->24px (no fixed nav to
clear). PullToRefresh now takes scrollEl and checks scrollEl.current.scrollTop instead of window.scrollY.
Only one scroll-API dependency existed (scrollIntoView in manage.tsx) and it works in any container.
Debugger updated (reports nav rectBot vs innerH/vvH + AT BOTTOM verdict) and kept for verification.
KNOWN FOLLOW-UP: sub-tab sticky headers (e.g. tournaments) used top:env(safe-area-inset-top) assuming
window scroll; inside the new container they may sit slightly low — verify/adjust if needed. REMOVE
nav-debug once Amit confirms the nav stays put.

### v1.122.3 — fix group-scorecard sticky header for the new scroll model (NO migration)
Client only. Follow-up to v1.122.2. The live game scorecard header (tournaments.tsx) used
position:sticky; top:env(safe-area-inset-top) to clear the notch when the WINDOW scrolled. Now that
content scrolls inside the flex-shell container (which already starts below the notch via the body's
paddingTop), that offset double-counted the safe area and pinned the header a notch-height too low.
Changed to top:0 so it pins to the scroll-area top (already notch-clear). Only sticky header that used a
safe-area top offset; the other two (auth banner, install hint) already used top:0.

### v1.122.4 — remove temporary nav debugger (NO migration)
Client only. Bottom-nav drift confirmed fixed by the flex-shell (v1.122.2) + scorecard header fix
(v1.122.3). Removed components/nav-debug.tsx and its import/render in home.tsx, and dropped the
data-debug-nav attribute from the nav. No functional change.

### v1.123.0 — achievements / badges, Phase 1 (migration 0079)
Data foundation only: `member_badges` table, `profiles.show_card` opt-out, and the
`group_badges` peer-read RPC, plus the pure evaluator in `lib/badges.ts` (35 unit tests).
Nothing is wired into the finalize flow yet, so deploying is inert until Phase 2. Run 0079:
```sql
-- 0079_achievements.sql
-- Achievements/badges: per-player earned badges + a peer-visible read path.
-- Safe to run multiple times. Run in the Supabase SQL editor.

-- 1) member_badges: one row per (user, badge_key).
--    count       = times earned (for repeatable/count badges; 1 for once/milestone)
--    best_value  = current record for "best" badges (differential, vs-par, fairways, etc.)
--    best_round_id = the round that set the current record
create table if not exists public.member_badges (
  user_id         uuid not null references auth.users(id) on delete cascade,
  badge_key       text not null,
  count           int  not null default 0,
  best_value      numeric,
  best_round_id   uuid references public.rounds(id) on delete set null,
  first_earned_at timestamptz not null default now(),
  last_earned_at  timestamptz not null default now(),
  primary key (user_id, badge_key)
);

alter table public.member_badges enable row level security;

-- Own badges: full access to your own rows.
drop policy if exists member_badges_own on public.member_badges;
create policy member_badges_own on public.member_badges
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admins can read all (oversight/analytics).
drop policy if exists member_badges_admin on public.member_badges;
create policy member_badges_admin on public.member_badges
  for select using (public.is_admin());

-- 2) profiles.show_card — per-player opt-out of the public player card (default on).
alter table public.profiles add column if not exists show_card boolean not null default true;

-- 3) Peer viewing: badges for everyone in a group the caller belongs to.
--    SECURITY DEFINER + is_group_member gate (mirrors group_roster). Honors show_card.
drop function if exists public.group_badges(uuid);
create or replace function public.group_badges(p_group uuid)
returns table (
  user_id uuid, badge_key text, count int, best_value numeric,
  best_round_id uuid, first_earned_at timestamptz, last_earned_at timestamptz
)
language sql security definer set search_path = public as $$
  select mb.user_id, mb.badge_key, mb.count, mb.best_value, mb.best_round_id,
         mb.first_earned_at, mb.last_earned_at
  from public.member_badges mb
  join public.group_members gm
    on gm.user_id = mb.user_id and gm.group_id = p_group and gm.status = 'active'
  join public.profiles pr on pr.id = mb.user_id
  where public.is_group_member(p_group, auth.uid())
    and coalesce(pr.show_card, true) = true;
$$;
grant execute on function public.group_badges(uuid) to authenticated;
```

### v1.124.0 — achievements Phase 2a: compute + backfill + wall (NO new migration)
Client only; still requires migration 0079 (above). Wires badges end-to-end:
- `lib/badges.ts` gains `computeBadgeState` (pure chronological replay -> full badge rows).
- `lib/badge-sync.ts` `syncBadges()` diffs desired vs stored and upserts/reconciles.
- home.tsx runs `syncBadges` on every finished-rounds change — this is BOTH compute-on-finish
  and the one-time history backfill (idempotent, no-op when unchanged, covers all finalize paths).
- `components/achievements.tsx` `AchievementsWall` renders under the Profile tab (own badges,
  earned vs locked, counts + records). Pre-migration it just shows all-locked (no crash).
Cumulative: deploying 1.124.0 includes the 1.123.0 foundation.

### v1.125.0 — achievements: tappable evidence + moved under Profile (NO migration)
Client only. `member_badges.best_round_id` is now the representative round for EVERY badge
(record round for 'best', latest occurrence for 'count', earning round for once/milestone) —
no schema change; existing rows backfill this on the next app open via `syncBadges`.
- `lib/badges.ts` adds `badgeEvidence(key, round)` — recomputes how a badge was earned,
  including the qualifying hole stretch for streaks (bogey-free, par train, even-par nine, etc.).
- `AchievementsWall` badges are tappable -> inline panel with the round (course + date), the
  evidence text, and a per-hole strip for stretch badges.
- The wall moved INSIDE `ProfilePanel`, directly under the profile card (above notifications and
  the admin blocks) so it isn't buried at the bottom for admins.

### v1.126.0 — self player card + wall syncs on open (NO migration)
Client only. Adds `components/player-card.tsx` `PlayerCard` at the top of the Profile tab:
photo, running index + trend (index now vs before the last 5 rounds), career bests (from
member_badges), a peek-scroll badge row (hidden scrollbar, a badge clipped at the edge), and a
last-5-differentials rolling-average form sparkline. All from the player's OWN data — no peer
read path yet. `AchievementsWall` now runs `syncBadges` on open (rounds passed in) so the earning
round is always attached before render — fixes the stale first-tap on legacy rows. `ProfilePanel`
gained a `rounds` prop (threaded from home) feeding both the card and the wall's sync.

### v1.127.0 — peer player card (migration 0080)
Adds the peer read path. `player_cards` summary + `group_cards` RPC; `lib/card.ts` (`computeCardStats`,
`rollingForm`) + `lib/card-sync.ts` (`syncPlayerCard`, diff-guarded, runs alongside syncBadges on
rounds change). `player-card.tsx` refactored to `PlayerCardView` (presentational) + `PlayerCard`
(self) + `PeerCardModal`. Players-tab roster rows are tappable (avatar+name) -> the peer's card.
Run 0080:
```sql
-- 0080_player_cards.sql
-- Peer-visible player card: a small per-player summary (running index, its recent
-- trend, rolling-form series, rounds played) that group-mates can read. Needed
-- because a peer's rounds themselves are not readable (rounds RLS is own/admin).
-- Computed client-side at sync time (lib/card-sync). Safe to run multiple times.

create table if not exists public.player_cards (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  idx        numeric,                          -- running WHS index (null if < 3 rounds)
  idx_trend  numeric,                          -- index now minus index before last 5 rounds (neg = improving)
  form       jsonb not null default '[]'::jsonb, -- last-5 rolling-average differential series
  rounds     int   not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.player_cards enable row level security;

drop policy if exists player_cards_own on public.player_cards;
create policy player_cards_own on public.player_cards
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists player_cards_admin on public.player_cards;
create policy player_cards_admin on public.player_cards
  for select using (public.is_admin());

-- Card summaries for everyone in a group the caller belongs to. SECURITY DEFINER +
-- is_group_member gate (mirrors group_roster / group_badges). Honors show_card.
drop function if exists public.group_cards(uuid);
create or replace function public.group_cards(p_group uuid)
returns table (user_id uuid, idx numeric, idx_trend numeric, form jsonb, rounds int)
language sql security definer set search_path = public as $$
  select pc.user_id, pc.idx, pc.idx_trend, pc.form, pc.rounds
  from public.player_cards pc
  join public.group_members gm
    on gm.user_id = pc.user_id and gm.group_id = p_group and gm.status = 'active'
  join public.profiles pr on pr.id = pc.user_id
  where public.is_group_member(p_group, auth.uid())
    and coalesce(pr.show_card, true) = true;
$$;
grant execute on function public.group_cards(uuid) to authenticated;
```

### v1.128.0 — card opt-out + member contact (migration 0081)
Client + one migration. `CardVisibilityToggle` (writes `profiles.show_card`) under the self-card:
hides only the performance layer from peers. Peer card gains a `ContactBar` — phone Call/Text when a
number is on file, plus an always-available PII-free nudge via `send_nudge` (shared-club gate, 6h
per-pair dedup, in-app notification type `nudge`). Roster taps pass `viewerUserId` so you don't nudge
yourself. Run 0081:
```sql
-- 0081_nudges.sql
-- Member-to-member "reach out" nudge. create_notification deliberately blocks
-- regular member->member notifications, so this dedicated SECURITY DEFINER RPC
-- gates on shared-club membership, dedupes per (sender, recipient) over 6h, and
-- drops an in-app notification (which the push webhook picks up). No PII shared —
-- the recipient just sees who reached out. Safe to run multiple times.

create table if not exists public.nudges (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  group_id     uuid,
  message      text,
  created_at   timestamptz not null default now()
);
create index if not exists nudges_pair_time on public.nudges (sender_id, recipient_id, created_at desc);

alter table public.nudges enable row level security;
-- Inserts happen only through send_nudge (SECURITY DEFINER); clients may read their own.
drop policy if exists nudges_own on public.nudges;
create policy nudges_own on public.nudges
  for select using (sender_id = auth.uid() or recipient_id = auth.uid());

-- Returns 'sent' | 'too_soon'. Raises on bad input / not-in-club.
drop function if exists public.send_nudge(uuid, uuid, text);
create or replace function public.send_nudge(p_recipient uuid, p_group uuid, p_message text default null)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_sender uuid := auth.uid();
  v_name   text;
  v_clean  text;
  v_msg    text;
begin
  if v_sender is null then raise exception 'not authenticated'; end if;
  if p_recipient is null or p_group is null then raise exception 'recipient and club are required'; end if;
  if p_recipient = v_sender then raise exception 'cannot nudge yourself'; end if;

  -- caller must belong to the club; recipient must be an active member of it
  if not public.is_group_member(p_group, v_sender) then raise exception 'not a member of this club'; end if;
  if not exists (
    select 1 from group_members
    where group_id = p_group and user_id = p_recipient and status = 'active'
  ) then raise exception 'that player is not in this club'; end if;

  -- at most one nudge per (sender, recipient) per 6h
  if exists (
    select 1 from nudges n
    where n.sender_id = v_sender and n.recipient_id = p_recipient
      and n.created_at > now() - interval '6 hours'
  ) then return 'too_soon'; end if;

  select coalesce(display_name, 'A club member') into v_name from profiles where id = v_sender;
  v_clean := nullif(btrim(coalesce(p_message, '')), '');
  v_msg := '👋 ' || v_name || ' wants to connect';
  if v_clean is not null then v_msg := v_msg || ': ' || left(v_clean, 140); end if;

  insert into nudges (sender_id, recipient_id, group_id, message)
  values (v_sender, p_recipient, p_group, left(coalesce(v_clean, ''), 140));

  insert into notifications (user_id, message, group_id, type, link)
  values (p_recipient, v_msg, p_group, 'nudge', '/?tab=players');

  return 'sent';
end $fn$;
grant execute on function public.send_nudge(uuid, uuid, text) to authenticated;
```

### v1.129.0 — dashboard achievements teaser (NO migration)
Client only. `AchievementsTeaser` (compact strip: recent-badge peek row + earned count) renders on the
dashboard right after the AI coach. Tapping it switches to the Profile tab and smooth-scrolls to the
achievements wall (`#achievements-wall`). The wall now leads with a 'Next up' milestone progress bar
(next rounds-played target from `rounds.length`; hidden once 100+ rounds). Dashboard gained an
`onViewAchievements` prop wired from home.

### v1.129.1 — player-card formatting fix + contextual form chart (NO migration)
Client only. (1) Replaced literal \uXXXX escapes with real glyphs in player-card.tsx / achievements.tsx
(they render verbatim in JSX text). Fixed a pre-existing one in tee-times.tsx:373 too. Added
`ci/check-jsx-escapes.py` — now run before every package. (2) Reworked the card's recent-form line into
a contextual `FormChart`: differential y-scale labels (best/worst in window), a gold average baseline,
a dot per round with the current value called out, and a plain-language verdict (Trending down/up/holding).

### v1.130.0 — badges on round detail + accurate peer round count (migration 0082)
(1) RoundDetail now shows a 'Badges earned this round' strip — `badgesForRound(finished, roundId)`
replays chronologically and returns exactly what that round produced (uses the `priorRounds` prop
already passed in; 'new record' tag on record-setting bests).
(2) Peer card showed 0 rounds for members who hadn't synced a summary yet. `group_cards` is
redefined to return a row for EVERY active member (LEFT JOIN player_cards) and count rounds LIVE
from the rounds table (deleted_at is null, status <> in_progress). Self-contained migration. Run 0082:
```sql
-- 0082_group_cards_live_rounds.sql
-- Robust peer card: return a row for EVERY active club member (even before they've
-- synced a summary) and compute rounds-played LIVE from rounds, so the count is always
-- accurate instead of depending on the lazy player_cards write (which was showing 0 for
-- members who hadn't opened the app yet). Self-contained: (re)creates player_cards +
-- policies idempotently, so it works whether or not 0080 was run. Safe to run repeatedly.

create table if not exists public.player_cards (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  idx        numeric,
  idx_trend  numeric,
  form       jsonb not null default '[]'::jsonb,
  rounds     int   not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.player_cards enable row level security;
drop policy if exists player_cards_own on public.player_cards;
create policy player_cards_own on public.player_cards
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists player_cards_admin on public.player_cards;
create policy player_cards_admin on public.player_cards
  for select using (public.is_admin());

drop function if exists public.group_cards(uuid);
create or replace function public.group_cards(p_group uuid)
returns table (user_id uuid, idx numeric, idx_trend numeric, form jsonb, rounds int)
language sql security definer set search_path = public as $$
  select gm.user_id,
         pc.idx,
         pc.idx_trend,
         coalesce(pc.form, '[]'::jsonb) as form,
         (select count(*)::int from rounds r
            where r.user_id = gm.user_id
              and r.deleted_at is null
              and coalesce(r.status, 'final') <> 'in_progress') as rounds
  from group_members gm
  join profiles pr on pr.id = gm.user_id
  left join player_cards pc on pc.user_id = gm.user_id
  where gm.group_id = p_group and gm.status = 'active'
    and public.is_group_member(p_group, auth.uid())
    and coalesce(pr.show_card, true) = true;
$$;
grant execute on function public.group_cards(uuid) to authenticated;
```

### v1.131.0 — stale-round auto-finish + profile-nudge funnel (migration 0083)
(A) Auto-finish: `finish_stale_rounds()` finalizes stale-but-complete in-progress rounds (18+ holes,
24h+), skips abandoned partials, self-throttled hourly, attributed 'system:auto'. Called best-effort on
app open (home.tsx); manual finishes now set finished_by=user + finished_at.
(B) Funnel: the profile-completion banner logs `profile_nudge_shown` (once/session) + `profile_nudge_clicked`.
`get_ops_metrics()` + an admin Operations panel show the funnel, incomplete profiles, and stale/auto counts.
Nudge counts accumulate from deploy forward; incomplete/stale counts are live. Run 0083:
```sql
-- 0083_ops_autofinish_and_funnel.sql
-- Two operational features:
--   (A) Auto-finish stale-but-complete in-progress rounds so a forgotten "finish" tap
--       doesn't keep a real round out of the player's handicap. Abandoned partials are
--       left alone. Every finalize (manual or auto) is now attributed.
--   (B) Admin ops metrics: profile-completion nudge funnel + stale-round + incomplete
--       profile counts.
-- Safe to run multiple times.

-- (A1) Attribution for round finalization.
alter table public.rounds add column if not exists finished_by text;       -- member uuid (as text) or 'system:auto'
alter table public.rounds add column if not exists finished_at timestamptz;

-- (A2) Throttle registry so the global sweep runs at most hourly no matter how many
--      app-opens call it. Touched only by SECURITY DEFINER functions.
create table if not exists public.system_jobs (
  job      text primary key,
  last_run timestamptz not null default now()
);
alter table public.system_jobs enable row level security;

-- (A3) Finalize stale (24h+), COMPLETE (18+ holes scored) in-progress rounds. Partial
--      abandons are skipped. Self-throttled to once/hour. Attributed 'system:auto'.
create or replace function public.finish_stale_rounds()
returns int
language plpgsql security definer set search_path = public as $fn$
declare
  v_last  timestamptz;
  v_count int := 0;
begin
  select last_run into v_last from system_jobs where job = 'finish_stale_rounds';
  if v_last is not null and v_last > now() - interval '1 hour' then
    return 0;                                   -- ran recently; skip the sweep
  end if;
  insert into system_jobs (job, last_run) values ('finish_stale_rounds', now())
    on conflict (job) do update set last_run = now();

  with eligible as (
    select r.id,
           (select sum(h.strokes) from holes h where h.round_id = r.id and h.strokes is not null) as gross,
           (select count(*)       from holes h where h.round_id = r.id and h.strokes is not null) as scored
    from rounds r
    where coalesce(r.status, 'final') = 'in_progress'
      and r.deleted_at is null
      and r.created_at < now() - interval '24 hours'
  ), done as (
    update rounds r
       set status      = 'final',
           finished_by = 'system:auto',
           finished_at = now(),
           gross_score = coalesce(r.gross_score, e.gross),
           played_at   = coalesce(r.played_at, r.created_at::date)
      from eligible e
     where r.id = e.id and e.scored >= 18
    returning r.id
  )
  select count(*) into v_count from done;
  return v_count;
end $fn$;
grant execute on function public.finish_stale_rounds() to authenticated;

-- (B) Admin ops metrics (nudge funnel + stale/ incomplete counts). is_admin-gated.
create or replace function public.get_ops_metrics()
returns jsonb
language sql security definer set search_path = public as $fn$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'nudge_shown_7d',    (select count(*) from activity_log where action = 'profile_nudge_shown'   and created_at > now() - interval '7 days'),
    'nudge_clicked_7d',  (select count(*) from activity_log where action = 'profile_nudge_clicked' and created_at > now() - interval '7 days'),
    'nudge_shown_28d',   (select count(*) from activity_log where action = 'profile_nudge_shown'   and created_at > now() - interval '28 days'),
    'nudge_clicked_28d', (select count(*) from activity_log where action = 'profile_nudge_clicked' and created_at > now() - interval '28 days'),
    'profiles_incomplete', (select count(*) from profiles
                              where coalesce(deactivated, false) = false
                                and (avatar_url is null or handicap_index is null)),
    'stale_ready',   (select count(*) from rounds r
                        where coalesce(r.status,'final') = 'in_progress' and r.deleted_at is null
                          and r.created_at < now() - interval '24 hours'
                          and (select count(*) from holes h where h.round_id = r.id and h.strokes is not null) >= 18),
    'stale_partial', (select count(*) from rounds r
                        where coalesce(r.status,'final') = 'in_progress' and r.deleted_at is null
                          and r.created_at < now() - interval '24 hours'
                          and (select count(*) from holes h where h.round_id = r.id and h.strokes is not null) < 18),
    'auto_finished_7d', (select count(*) from rounds where finished_by = 'system:auto' and finished_at > now() - interval '7 days')
  ) end;
$fn$;
grant execute on function public.get_ops_metrics() to authenticated;
```

### v1.131.1 — FIX: duplicate in-progress rounds (no migration)
Root cause (confirmed from real data — one user produced 34 in_progress rows for a single
Pinch Brook round over 2.5h): `RoundEditor.backgroundSave` inserted a NEW in_progress row
whenever its in-memory round id (`dbIdRef`) was empty. On an iOS PWA the id often didn't
survive a screen lock (it's set async after the insert, so a lock before it completed saved
the draft with an empty id → the next cold-start reload re-inserted), and the 2-3 lock-flush
events iOS fires at once raced the non-atomic `if(!rid)` guard (→ paired same-microsecond rows).
Fix: new `ensureRoundId()` — (1) serializes creation via an in-flight promise ref so racing
saves await the same insert; (2) ADOPTS an existing in_progress row for the same user+course
created in the last 12h before inserting a new one; (3) persists the id into the local draft
immediately. Net: one row per round session regardless of locks/reloads.
**Verify after deploy:** re-run the complete/partial stuck counts — new rounds should create ~1
in_progress row, not a ladder.

**One-time cleanup of existing duplicates** (soft-delete; keeps the most-scored row per
user+course+day so any real round stays resumable). PREVIEW first, then run the UPDATE:
```sql
-- PREVIEW: rows that WOULD be soft-deleted (rn>1 = duplicates, keeping the best per cluster)
with ranked as (
  select r.id, r.course, r.created_at,
         (select count(*) from holes h where h.round_id=r.id and h.strokes is not null) as scored,
         row_number() over (partition by r.user_id, r.course, r.created_at::date
           order by (select count(*) from holes h where h.round_id=r.id and h.strokes is not null) desc,
                    r.created_at desc) as rn
  from rounds r
  where coalesce(r.status,'final')='in_progress' and r.deleted_at is null)
select * from ranked where rn > 1 order by course, created_at;

-- APPLY: soft-delete the duplicates
with ranked as (
  select r.id,
         row_number() over (partition by r.user_id, r.course, r.created_at::date
           order by (select count(*) from holes h where h.round_id=r.id and h.strokes is not null) desc,
                    r.created_at desc) as rn
  from rounds r
  where coalesce(r.status,'final')='in_progress' and r.deleted_at is null)
update rounds set deleted_at = now() where id in (select id from ranked where rn > 1);
```

### v1.132.0 — built-in round-save diagnostics (verify before trusting the fix)
Adds an opt-in, per-device diagnostics panel (admin → Manage → Round-save diagnostics) so the
duplicate-in_progress bug can be REPRODUCED and the fix CONFIRMED on a real phone before we rely on it.
- `lib/debuglog.ts`: localStorage-backed event log (survives PWA reload/cold-start, which the bug
  involves) + two per-device flags. All a no-op unless logging is enabled — zero overhead for players.
- RoundEditor now logs: `mount` (what id it started with), every `ensure` decision
  (reuse / adopt / insert / await_inflight / legacy_insert), and every `flush` (which lock event fired).
- Toggle **Reproduce bug (disable dedupe)** runs the ORIGINAL blind-insert path (no adopt, no
  serialization) on that device only, so the ladder of inserts can be produced on purpose.
- The dedupe FIX (adopt existing row within 12h + in-flight insert serialization + immediate id
  persistence) from v1.131.1 is the DEFAULT path (reproduce off), so shipping this protects all users
  while letting the admin verify.
No migration. Procedure: deploy → admin Manage → Round-save diagnostics → Logging ON → Reproduce ON →
score a few holes locking the phone between each → expect multiple red `insert` lines for one round →
Reproduce OFF → rescore → expect one insert + green adopt/reuse. Then run the v1.131.1 cleanup SQL.

### v1.133.0 — consolidated Admin tab (no migration)
All admin surfaces moved out of Profile and the scattered More-menu entries into ONE Admin tab
with two tiers. Reuses every existing panel unchanged — no logic rewritten, no migration.
- New `AdminHome` (components/manage.tsx, exported): card index + inline sub-view router.
  * Tier 1 — Club admin (shown when activeGroup.role==='admin', scoped to that club): Members and
    Club settings, which JUMP to the existing Players / Clubs tabs (no duplication).
  * Tier 2 — System / Super admin (profile.is_admin only): Analytics (AdminAnalytics+AdminEngagement),
    Operations (OpsMetrics), Activity log (ActivityTab), Clubs oversight (AdminGroupsTab), Users
    (AdminUsersTab), Player admin (AdminPanel with new showAnalytics={false}), Feedback
    (AdminFeedbackTab), Diagnostics (RoundSaveDiag), System tools (test-account toggle + YardageBackfill).
- Removed the four ★ More-menu tabs (Activity/Oversight/Users/Feedback) and the admin block + test
  toggle from ProfilePanel; Profile is now player-only. Nav shows a single 'Admin ★' entry when the
  user is a club admin OR master admin.
- `AdminPanel` gained `showAnalytics` (default true) so its analytics header isn't duplicated when
  rendered as the Player-admin sub-view.
Note: Users / Player admin / Clubs oversight retain some historical overlap (kept intact to avoid a
risky governance refactor); can be rationalized later.

### v1.134.0 — attention badges on Admin tiles (migration 0084)
`get_admin_todos()` (is_admin) returns {pending_clubs, new_feedback, pending_course_edits, stale_ready}.
AdminHome fetches it once and shows a gold number badge on the tiles that have a to-do you can action
from that tile: Clubs oversight (pending_clubs), Feedback (new_feedback), Operations (stale_ready).
Player-admin badge intentionally deferred to the governance dedup (its queue has no clean home yet).
pending_course_edits is returned now for the dedup's Courses screen. Run 0084:
```sql
-- 0084_admin_todos.sql
-- Counts that drive the "needs attention" number badges on the Admin hub tiles.
-- is_admin-gated; returns {} for non-master callers. Safe to run multiple times.
-- pending_course_edits is included now so the dedup's Courses screen can badge it later.
create or replace function public.get_admin_todos()
returns jsonb
language sql security definer set search_path = public as $fn$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'pending_clubs',        (select count(*) from groups where status = 'pending'),
    'new_feedback',         (select count(*) from feedback where status = 'new'),
    'pending_course_edits', (select count(*) from course_change_requests where status = 'pending'),
    'stale_ready',          (select count(*) from rounds r
                               where coalesce(r.status,'final') = 'in_progress' and r.deleted_at is null
                                 and r.created_at < now() - interval '24 hours'
                                 and (select count(*) from holes h where h.round_id = r.id and h.strokes is not null) >= 18)
  ) end;
$fn$;
grant execute on function public.get_admin_todos() to authenticated;
```

### v1.135.0 — manual per-hole yardage entry in the course editor (no migration)
Previously the course editor's per-tee 'Yards' was display-only (sum of tees[].yardages, '—' when
unset); the only manual entry lived in the master-admin Yardage Backfill tool. So a club admin who
added a tee the API didn't know had no way to enter its yardages.
Fix: the 'Yards' cell on each tee row is now a button that expands a per-hole yardage grid for that
tee (writes tees[].yardages). Available to anyone who can edit the course (same permission as
name/rating/slope) — not admin-gated. Yardages ride along with the existing course save; the Backfill
tool stays for bulk API pulls.

### v1.135.1 — FIX: yardages are now a first-class course-diff field (no migration)
v1.135.0 added yardage entry but `lib/course-diff.ts` didn't know about yardages, so a yardage-ONLY
edit read as 'no material change' — `save()` linked the course and returned, silently dropping the
entered yardages. Option A applied: `normalizeTeesForDiff` now carries `yardages`, and
`courseChangeLines` emits a per-tee line (e.g. 'Blue tee yardages: 3 holes changed (H1 —→380, …)').
Result: yardage edits follow the SAME pattern as par/stroke-index — member edit creates the immediate
group override + a pending global change request with the yardage diff shown to the approving admin;
yardage-only edits are detected and persisted. Added-tee lines also show the tee's total yardage.

### v1.135.2 — FIX: Admin -> Users round count (migration 0085)
`admin_list_users.rounds_count` counted ALL rows in `rounds` (incl. soft-deleted + in-progress), so a
user with phantom duplicates showed an inflated count (Nihar: 38) that disagreed with the player card
(3). Now filtered to real rounds (deleted_at is null, status <> in_progress) to match the card and the
rest of the app. Pure function fix, no data change. Run 0085:
```sql
-- 0085_admin_list_users_real_rounds.sql
-- Fix: admin_list_users.rounds_count counted ALL rows in `rounds` for a user, including
-- soft-deleted (deleted_at not null) and in-progress rounds. A user with phantom/duplicate
-- in-progress rows or soft-deleted rounds therefore showed an inflated count in Admin ->
-- Users (e.g. 38) that disagreed with the player card's real-round count (e.g. 3).
-- Align the count with the app's standard real-round definition used everywhere else:
-- not deleted, and not in-progress. Pure function fix; no data changes. Safe to re-run.
create or replace function public.admin_list_users()
returns table (
  id uuid, display_name text, email text, is_admin boolean, banned boolean,
  handicap_index numeric, group_count int, rounds_count int
)
language sql security definer set search_path = public as $$
  select p.id, p.display_name, p.email, p.is_admin, coalesce(p.banned, false),
         p.handicap_index,
         (select count(*) from group_members gm where gm.user_id = p.id and gm.status = 'active')::int,
         (select count(*) from rounds r
            where r.user_id = p.id
              and r.deleted_at is null
              and coalesce(r.status, 'final') <> 'in_progress')::int
  from profiles p
  where public.is_admin()
  order by p.display_name nulls last;
$$;
grant execute on function public.admin_list_users() to authenticated;
```
KNOWN SIBLING (flagged, not yet fixed): the GROUP-level rounds_count in admin group oversight
(migrations 0027/0028/0030, `count(*) from rounds where group_id=g.id`) has the same missing filter,
so per-club round totals in Clubs oversight are similarly inflated. Fix pending owner go-ahead.

### v1.135.3 — FIX: Clubs oversight per-club round count (migration 0086)
Sibling of 0085: admin_group_overview.rounds_count counted soft-deleted + in-progress rounds, inflating
per-club totals; the last_activity round lookup did too. Both now filtered to real rounds. Run 0086:
```sql
-- 0086_admin_group_overview_real_rounds.sql
-- Fix (sibling of 0085): admin_group_overview.rounds_count counted ALL rows in `rounds`
-- for a club, including soft-deleted + in-progress, inflating per-club round totals in
-- Clubs oversight. Also filter the last_activity round lookup so a deleted/in-progress
-- round doesn't register as club activity. Real-round definition matches the rest of the
-- app: deleted_at is null AND status <> 'in_progress'. Pure function fix; no data change.
create or replace function public.admin_group_overview()
returns table (
  group_id uuid, name text, status text,
  admin_names text, member_count int, rounds_count int, games_count int,
  last_activity timestamptz, my_support boolean, is_default boolean
)
language sql security definer set search_path = public
as $$
  select
    g.id, g.name, coalesce(g.status, 'active') as status,
    (select string_agg(coalesce(p.display_name, gm2.email, 'admin'), ', ')
       from group_members gm2 left join profiles p on p.id = gm2.user_id
       where gm2.group_id = g.id and gm2.role = 'admin' and gm2.status = 'active'
         and gm2.is_support = false) as admin_names,
    (select count(*) from group_members gm where gm.group_id = g.id and gm.status = 'active' and gm.is_support = false)::int as member_count,
    (select count(*) from rounds r
       where r.group_id = g.id and r.deleted_at is null
         and coalesce(r.status, 'final') <> 'in_progress')::int as rounds_count,
    (select count(*) from games ga where ga.group_id = g.id)::int as games_count,
    greatest(
      coalesce((select max(r.played_at) from rounds r
                  where r.group_id = g.id and r.deleted_at is null
                    and coalesce(r.status, 'final') <> 'in_progress'), 'epoch'::timestamptz),
      coalesce((select max(ga.created_at) from games ga where ga.group_id = g.id), 'epoch'::timestamptz),
      coalesce(g.created_at, 'epoch'::timestamptz)
    ) as last_activity,
    exists (select 1 from group_members gm3
            where gm3.group_id = g.id and gm3.user_id = auth.uid() and gm3.is_support = true) as my_support,
    coalesce(g.is_default, false) as is_default
  from groups g
  where public.is_admin()
  order by last_activity desc;
$$;
grant execute on function public.admin_group_overview() to authenticated;
```

### v1.135.4 — engagement analytics count real rounds only (migration 0087)
Audit of round-counting after 0085/0086: get_admin_analytics (0068) was already correct (final,
non-deleted, test excluded). get_admin_engagement (0078) filtered deleted_at but NOT in-progress, so
unfinished rounds (which carry played_at) inflated WAU/MAU, weekend reach/share, new-vs-returning, and
the game/solo split. 0087 recreates it excluding in-progress everywhere. Full SQL posted in chat / here.
OBSERVATION (not changed): get_admin_engagement does not exclude test accounts (get_admin_analytics
does). Left as-is pending owner decision — flag only.

### v1.136.0 — FEATURE: Power Users analytics (migration 0088)
New super-admin Analytics section: top 25 users by composite engagement score, with every metric
shown individually and tap-to-sort on any column, an All-time / 90-day window toggle, and friction
(kept starting rounds that didn't finish) + quiet (no activity 30d+) badges — directly answering
'did engaged users try, hit breakage, and give up?'. Reuses daily_active/rounds/game_players; no new
tracking tables. New RPC get_power_users(p_days); component AdminPowerUsers in manage.tsx, rendered
under the Analytics view. Run 0088:
```sql
-- 0088_power_users.sql
-- Super-admin analytics: top users by a composite engagement score, with every underlying
-- metric exposed individually (client re-sorts) plus friction/churn signals that answer
-- "did engaged users try, hit breakage, and give up?".
--
-- Composite score = completed*4 + games*2 + active_days*1 + opens*0.1
--   completed rounds are the real unit of value; opens are noisy so weighted low.
-- Friction flag: >=3 abandoned/deleted attempts AND completion rate < 60% (kept starting
--   rounds that never finalized — the phantom-round-bug signature).
-- Churn flag: no activity in > 30 days (or never active).
--
-- All metrics honor the window param: p_days null = all-time; e.g. 90 = last 90 days.
-- Real-round definition matches the rest of the app: deleted_at is null AND status<>'in_progress'.
-- Test + deactivated accounts excluded. is_admin() gate returns zero rows to non-admins.
create or replace function public.get_power_users(p_days int default null)
returns table (
  user_id uuid,
  display_name text,
  completed_rounds int,
  unfinished_rounds int,
  deleted_rounds int,
  games_played int,
  active_days int,
  total_opens int,
  completion_pct int,
  last_active date,
  days_since_active int,
  churned boolean,
  friction boolean,
  score numeric
)
language sql security definer set search_path = public as $$
  with base as (
    select p.id, p.display_name, p.last_active
    from profiles p
    where public.is_admin()
      and coalesce(p.is_test, false) = false
      and coalesce(p.deactivated, false) = false
  ),
  rc as (
    select r.user_id,
      count(*) filter (where r.deleted_at is null and coalesce(r.status,'final') <> 'in_progress'
                        and (p_days is null or r.played_at > current_date - p_days))                         as completed,
      count(*) filter (where r.deleted_at is null and coalesce(r.status,'final') = 'in_progress'
                        and (p_days is null or r.created_at > now() - make_interval(days => p_days)))         as unfinished,
      count(*) filter (where r.deleted_at is not null
                        and (p_days is null or r.created_at > now() - make_interval(days => p_days)))         as deleted
    from rounds r
    group by r.user_id
  ),
  gp as (
    select gpl.user_id, count(*) as games
    from game_players gpl
    join games g on g.id = gpl.game_id
    where (p_days is null or g.created_at > now() - make_interval(days => p_days))
    group by gpl.user_id
  ),
  da as (
    select user_id, count(*) as active_days, coalesce(sum(opens), 0) as opens
    from daily_active
    where (p_days is null or day > current_date - p_days)
    group by user_id
  )
  select
    b.id,
    b.display_name,
    coalesce(rc.completed, 0)::int,
    coalesce(rc.unfinished, 0)::int,
    coalesce(rc.deleted, 0)::int,
    coalesce(gp.games, 0)::int,
    coalesce(da.active_days, 0)::int,
    coalesce(da.opens, 0)::int,
    case when coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0) > 0
         then round(100.0 * coalesce(rc.completed,0)
                    / (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)))::int
         else null end,
    b.last_active::date,
    case when b.last_active is null then null else (current_date - b.last_active::date) end,
    case when b.last_active is null then true else (current_date - b.last_active::date) > 30 end,
    (coalesce(rc.unfinished,0) + coalesce(rc.deleted,0) >= 3
      and (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)) > 0
      and 100.0 * coalesce(rc.completed,0)
          / (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)) < 60),
    (coalesce(rc.completed,0) * 4 + coalesce(gp.games,0) * 2 + coalesce(da.active_days,0) * 1
      + coalesce(da.opens,0) * 0.1)::numeric
  from base b
  left join rc on rc.user_id = b.id
  left join gp on gp.user_id = b.id
  left join da on da.user_id = b.id
  order by score desc nulls last
  limit 25;
$$;
grant execute on function public.get_power_users(int) to authenticated;
```

### v1.136.1 — FIX: 0088 ORDER BY alias
get_power_users failed at deploy with 'column "score" does not exist' — the composite expression
lacked an alias, so ORDER BY score couldn't resolve it in the RETURNS TABLE function. Added `as score`.
No app-code change. Corrected 0088:
```sql
-- 0088_power_users.sql
-- Super-admin analytics: top users by a composite engagement score, with every underlying
-- metric exposed individually (client re-sorts) plus friction/churn signals that answer
-- "did engaged users try, hit breakage, and give up?".
--
-- Composite score = completed*4 + games*2 + active_days*1 + opens*0.1
--   completed rounds are the real unit of value; opens are noisy so weighted low.
-- Friction flag: >=3 abandoned/deleted attempts AND completion rate < 60% (kept starting
--   rounds that never finalized — the phantom-round-bug signature).
-- Churn flag: no activity in > 30 days (or never active).
--
-- All metrics honor the window param: p_days null = all-time; e.g. 90 = last 90 days.
-- Real-round definition matches the rest of the app: deleted_at is null AND status<>'in_progress'.
-- Test + deactivated accounts excluded. is_admin() gate returns zero rows to non-admins.
create or replace function public.get_power_users(p_days int default null)
returns table (
  user_id uuid,
  display_name text,
  completed_rounds int,
  unfinished_rounds int,
  deleted_rounds int,
  games_played int,
  active_days int,
  total_opens int,
  completion_pct int,
  last_active date,
  days_since_active int,
  churned boolean,
  friction boolean,
  score numeric
)
language sql security definer set search_path = public as $$
  with base as (
    select p.id, p.display_name, p.last_active
    from profiles p
    where public.is_admin()
      and coalesce(p.is_test, false) = false
      and coalesce(p.deactivated, false) = false
  ),
  rc as (
    select r.user_id,
      count(*) filter (where r.deleted_at is null and coalesce(r.status,'final') <> 'in_progress'
                        and (p_days is null or r.played_at > current_date - p_days))                         as completed,
      count(*) filter (where r.deleted_at is null and coalesce(r.status,'final') = 'in_progress'
                        and (p_days is null or r.created_at > now() - make_interval(days => p_days)))         as unfinished,
      count(*) filter (where r.deleted_at is not null
                        and (p_days is null or r.created_at > now() - make_interval(days => p_days)))         as deleted
    from rounds r
    group by r.user_id
  ),
  gp as (
    select gpl.user_id, count(*) as games
    from game_players gpl
    join games g on g.id = gpl.game_id
    where (p_days is null or g.created_at > now() - make_interval(days => p_days))
    group by gpl.user_id
  ),
  da as (
    select user_id, count(*) as active_days, coalesce(sum(opens), 0) as opens
    from daily_active
    where (p_days is null or day > current_date - p_days)
    group by user_id
  )
  select
    b.id,
    b.display_name,
    coalesce(rc.completed, 0)::int,
    coalesce(rc.unfinished, 0)::int,
    coalesce(rc.deleted, 0)::int,
    coalesce(gp.games, 0)::int,
    coalesce(da.active_days, 0)::int,
    coalesce(da.opens, 0)::int,
    case when coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0) > 0
         then round(100.0 * coalesce(rc.completed,0)
                    / (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)))::int
         else null end,
    b.last_active::date,
    case when b.last_active is null then null else (current_date - b.last_active::date) end,
    case when b.last_active is null then true else (current_date - b.last_active::date) > 30 end,
    (coalesce(rc.unfinished,0) + coalesce(rc.deleted,0) >= 3
      and (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)) > 0
      and 100.0 * coalesce(rc.completed,0)
          / (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)) < 60),
    (coalesce(rc.completed,0) * 4 + coalesce(gp.games,0) * 2 + coalesce(da.active_days,0) * 1
      + coalesce(da.opens,0) * 0.1)::numeric as score
  from base b
  left join rc on rc.user_id = b.id
  left join gp on gp.user_id = b.id
  left join da on da.user_id = b.id
  order by score desc nulls last
  limit 25;
$$;
grant execute on function public.get_power_users(int) to authenticated;
```

### v1.136.2 — FIX: bottom nav no longer rubber-band swipes (no migration)
The prior nav fix (100dvh flex shell, no position:fixed) stopped drift but the nav sits OUTSIDE the
inner scroll container, and nothing locked the document — there was no globals.css and html/body had
no overflow/overscroll rules. So a swipe landing on the nav was handled by the document, which iOS
elastic-bounced, revealing the body background below the icons as a phantom empty row. Fix: lock the
viewport at the document level in app/layout.tsx — html { height:100%; overflow:hidden }, body
{ position:fixed; inset:0; overflow:hidden; overscroll-behavior:none }. Only the inner container
scrolls now; pull-to-refresh and the More sheet are unchanged.

### v1.136.3 — DIAGNOSTIC: viewport readout for the nav gap (no migration, no layout change)
The document bounce is fixed (1.136.2) but a persistent blank row remains below the nav. Rather than
guess at dvh/safe-area again, added a ViewportDiag overlay (home.tsx, self-gates on diagEnabled, toggle
in Admin -> Diagnostics) that measures innerHeight, docClientH, visualViewport, 100dvh/svh/lvh, both
safe-area insets, and the real rects of the shell + nav, then reports GAP_below_nav = innerHeight -
nav.bottom. Copy button dumps JSON. Once we have the numbers the fix is deterministic.

### v1.136.4 — DIAGNOSTIC: viewport panel reacts to the toggle live (no migration)
ViewportDiag read diagEnabled() once at mount; since it lives on the always-mounted Home shell,
enabling the toggle mid-session didn't surface it without a full reload. Now polls the flag every 800ms
so toggling on/off in Admin -> Diagnostics shows/hides the panel within a second. No reload needed.

### v1.136.5 — FIX: bottom-of-screen gap below the nav (no migration)
Root cause found via the viewport diag + a screenshot: the position:fixed;inset:0 body from 1.136.2
(added to kill the bounce) made iOS resolve the SMALL viewport (svh = 894 on the test device) for the
body, which stops 62px short of the real screen (lvh = 956) — that shortfall was the green gap below
the nav. GAP_below_nav read 0 because it compared against innerHeight/svh (894), not the true screen.
Fix (app/globals.css, new): html/body locked with overflow:hidden + overscroll-behavior:none; body
position:fixed sized to height:100lvh (fallback 100vh) so it fills the FULL screen; padding-top keeps
content below the black-translucent status bar. Shell height switched from calc(100dvh - safeTop) to
100% so it fills the body content box exactly. Bounce stays fixed; nav now reaches the physical bottom.
After deploy the diag should show bodyH ~956 and navBottom ~956 (GAP_below_nav will read ~-62 because
that metric still references svh/innerHeight; the negative just means the nav now extends past svh to
the real bottom — visually correct).

### v1.136.6 — FIX: nav pushed off-screen by 1.136.5 (no migration)
1.136.5 sized the shell with height:100%, but a wrapper sits between <body> and the shell without a
fixed height, so the percentage fell back to auto and the shell grew to its full content height
(diag: shellH 2913, navBottom 2975) — nav off the bottom of the screen. Also bodyH read 1018 =
100lvh + padding-top (padding was outside the height). Fix: shell now sized with a viewport unit via
the .app-shell class (100lvh, fallback 100vh) so it's independent of the parent chain; top safe-area
padding moved INTO the shell with box-sizing:border-box (no overflow); body padding-top removed.
Expected diag now: bodyH ~956, shellH ~956, navBottom ~956; GAP_below_nav ~-62 (references svh, fine).

### v1.136.7 — FIX: robust height for browser + installed; icon-clip cushion (no migration)
Made the shell height context-aware instead of one-size: the installed app (display-mode:standalone)
uses 100lvh (stable full glass, the known-good value from 1.136.6); a browser tab uses a LIVE
JS-measured height (--app-h = visualViewport.height, published by new components/viewport-sync.tsx)
that tracks Safari's toolbar so the nav stays pinned to the visible bottom instead of hiding behind it.
Also added an 8px cushion to the nav's bottom padding so the icon labels are no longer clipped at the
screen edge. Diag now reports mode (installed/browser), vvOffsetTop, the --app-h var, and
navBottom_vs_visible (should be ~0 = nav flush to the visible bottom in BOTH contexts).

### v1.137.0 — FEATURE: Analytics name-level drill-down, STAGE 1 (migrations 0089, 0090)
Additive — nothing removed from the existing Analytics tab. New shared drill engine: every stat is a
button that opens one reusable bottom-sheet (StatDrawerHost) listing the exact users behind the number,
fetched from the is_admin-gated admin_stat_users(stat,arg,date) RPC (uniform name/detail/tag rows).
STAGE 1 wires drill-down onto the existing stats: Total users, Rounds done, DAU/WAU/MAU, Lapsed, Round
completion, Abandoned, New-users, Never-joined-a-club, and the Avatars/AI feature bars. The engine
already includes branches for the stage-2/3 stats (installed/browser, notif on/off, failing subs, mutes,
sharing, guests, daily active/rounds) so those stages are client-only.
Also: install-vs-browser capture is LIVE (0089) — mark_active(p_standalone) records each user's latest
open mode into profiles.last_standalone; home.tsx now passes display-mode. Forward-only, no backfill.
Run 0089 then 0090 (full SQL posted in chat).
STAGE 2 (next): new summary tiles. STAGE 3: Daily report.

### v1.138.0 — FEATURE: Analytics stage 2 — new drillable tiles (migration 0091; 0090 corrected)
New AdminExtraStats section under Analytics: Platform (installed vs browser), Notifications (on/off,
failing/stale devices, most-muted types), Profile sharing (on/off), Guests — each tile drills to the
named users via the shared engine. Counts from get_admin_extra_stats (0091).
CORRECTION to 0090 (re-run it — create-or-replace, safe): push_prefs values are 'push'|'inapp'|'off',
not true/false, so the mute drill now matches value='off', and notifications on/off is based purely on
having an active push_subscription (no vestigial _master). Run order: 0089, 0090 (corrected), 0091.
STAGE 3 next: Daily report (date-driven active users + rounds; engine branches already present).

### v1.139.0 — FEATURE: Analytics stage 3 — Daily report (NO migration)
Client-only; reuses engine branches active_day / rounds_day from 0090. New AdminDailyReport section:
recent-day chips + a calendar date input; two drillable tiles (Active users, Rounds played) whose
counts are the length of the engine lists; an inline rounds list color-coded by status (completed /
in progress / auto-finished / deleted-issue). Tapping a tile or row opens the shared drawer for the
chosen date. Completes the analytics drill-down feature (stages 1-3). No new SQL to run.

### v1.140.0 — FEATURE: Friction review (integrity sweep agent) — migration 0092 + push route
Run migration 0092 (creates friction_items, sweep_friction, get_friction_items, get_friction_rounds,
resolve_friction, and schedules the daily pg_cron job). If 'create extension pg_cron' errors, enable
pg_cron once in Supabase > Database > Extensions (same as tee reminders). Optionally run
'select public.sweep_friction(true);' once for an immediate first pass over historical data.
Client: new AdminFrictionReview section at the top of Analytics (tabs Open/Needs action/Resolved,
Run-check-now, keeper picker + soft-delete on clear). app/api/push/route.ts now treats type
'friction' as push and titles it 'Data integrity flag' — admins get one summary push per sweep that
flags something new. Retired the old 'friction' wording (Power Users badge -> 'restarts'; abandoned
drill tag shown as 'unfinished') so 'friction' now means only the integrity ledger.

### v1.140.1 — FIX: Friction review is now its own admin card
Moved AdminFrictionReview out of the Analytics view into its own admin-home Card + view
(setView 'friction'), with a live open-count badge fed from get_friction_items('open') merged
into the todos effect. No migration. Client-only.

### v1.140.2 — FIX: removed the Power Users “restarts” badge
That badge was the old computed heuristic (>=3 abandoned/deleted AND completion <60%) — a live,
unresolvable verdict on normal behaviour, with no way to clear it. Removed the badge + legend; kept
the neutral completion_pct column and the 'quiet' churn badge. get_power_users.friction still
computes but is now unused (no migration). 'Friction' now means only the integrity ledger.

### v1.140.3 — UI: cleaner running-handicap “how?” expansion
runningHandicap() now returns recentDetail[{d,used}] (newest-first, exact best-N flags). The tile
expansion drops the duplicated 'used: X (of all Y)' line for a single newest-first list of the last
20 differentials with the counted ones in gold+bold, a 'Newest round first.' note, and a payoff line
('The 8 in gold average 12.4 — that’s your index', or with the small-sample adjustment spelled out).

### v1.140.4 — FIX: enforce 10px minimum font size
Swept all sub-10px fonts up to 10 (rule: never below 10px). 11 instances across player-card,
achievements, round-detail, manage (engagement week labels) and the shared ui sub-label. The
handicap-index label on the player card was the visible one. Client-only.

### v1.141.0 — FEATURE: Flights Stage 1a (one-off setup + data) — migration 0093
Additive columns games.flight_mode / games.flights / game_players.flight (0093). Game setup (stroke
or Stableford only) gains a Flights control next to Handicap allowance: Off / One-off flights /
Season league (disabled until Stage 2). One-off shows a 2/3/4 picker and an even auto-split of the
field by handicap index, with per-band counts; each player's band is written to game_players.flight
at create, and flight_mode/flights onto the game. Players without an index start unassigned. New
lib/flights.ts (autoSplitFlights, flightForIndex, flightRangeLabel). Setup draft persists the choice.
NOT YET: the segmented By-flight/Overall leaderboard display — that's Stage 1b (fits into the
StrokesSummary standings). So flights are captured now but not yet shown on the board.

### v1.141.1 — Flights: require handicaps for flighted events
One-off flights now enforce that every player has a handicap index (strict; no exclude). The Flights
panel surfaces a 'Handicaps needed' list of selected members missing one, with inline index entry;
Create is blocked with a clear message until all are filled (and the creator's own index is set).
Entered handicaps save to each member's profile on create (becomes their handicap going forward).
Guests already require an index, so they never appear here. Replaces Stage-1a's soft 'unassigned' note.

### v1.142.0 — FEATURE: Flights Stage 1b (segmented leaderboard) — no migration
The individual stroke/Stableford standings (game room → Play) now honor one-off flights. When a
game has flight_mode='oneoff' with bands, a By-flight / Overall toggle appears above the board.
By flight (default): one section per band (color dot + name + index range + count), each ranked
WITHIN the band (own leader, own ties) reusing the exact net/Stableford ranking — scoring math
untouched. Any flight-null players fall into an 'Unassigned' section (legacy/edge; new flighted
games can't produce one since handicaps are required). Overall: the full single list with a small
A/B/C/D color tag per row. Row rendering was extracted into one renderLeaderRow used by both views.
Six-hole segment winners + money banners are unchanged (decided overall among bettors, orthogonal
to flights). Completes Flights Stage 1 end-to-end (setup → assignment → display).

### v1.142.1 — Fix: handicap entry needs an explicit Set (was vanishing mid-type)
The flighted 'Handicaps needed' fields committed on every keystroke, so the row left the list the
instant a value parsed — the field disappeared before you could finish/confirm. Now each row keeps a
local draft and only commits when you tap Set (or press Enter), validated to a 0–54 index. Includes
everything in v1.142.0 (Flights Stage 1b segmented leaderboard). One deploy; migration 0093 still needed.

### v1.142.2 — Readability: raise the minimum font to 11px (was 10) + CI guard
Every shipped font under 11px was bumped to 11: 160 spots that were at 10px and 19 that were at
10.5px, plus the Avatar initials dynamic floor (Math.max(10→11)). The dashboard 'Newest round
first.' note (and its siblings) were among the 10s. Verified the tight layouts first — group-scorecard
corner point-chips (fixed 15px boxes, single-digit content), the round-detail hole grid (scrolls
horizontally) and the share-card scorecard grid (already 11 on base cells) — none break at 11; the
only effects are cosmetic (multi-player name headers truncate ~1 char sooner). Added
ci/check-min-fontsize.py, which fails the build on any literal font < 11px; run it as part of
delivery going forward. No migration.

### v1.143.0 — FEATURE: iOS-style back bar from Admin into reused pages — no migration
Tapping Members or Club settings inside the admin home now records the origin (returnTab) and the
reused page shows a back bar: a gold '‹ Admin' control on the left (labels the origin, per Apple's
pattern of naming the screen you return TO) with the current page title centered. Tapping it returns
to the admin home and clears the origin. The bar renders ONLY when arrived from Admin (returnTab set
AND on players/groups AND not mid-flow); opening those pages directly from the More sheet or bottom
nav shows no bar, and any bottom-nav / More navigation clears the origin. Shell-only change in
components/home.tsx (returnTab state + tabTitle helper + bar render + clears).

### v1.144.0 — FEATURE: Desktop Organizer console (Phase 1: Flights) — no migration
New authenticated, desktop-only route /organize/<gameId> (components/organizer.tsx). Shares the app
Supabase session, so you can create a game on the phone and organize it on a laptop. Wide-viewport
gated (≥900px; narrow shows an 'open on a larger screen' note). Layout: top game-context bar, step
tabs (Details · Field · Flights · Matchups), a persistent left field rail, and a canvas. PHASE 1 ships
the Flights step fully working: enable flights / pick 2-3-4 bands / rebalance evenly / turn off, and
CLICK-TO-ASSIGN (click a chip's A/B/C to move a player between bands) with optimistic writes to
game_players.flight and games.flight_mode/flights. Missing indexes are filled inline from the field
rail (writes game_players + the member's profile) and block enabling until resolved — same rule as the
phone. Details = read-only summary; Field & Matchups = labeled next-phase placeholders. Reuses
lib/flights + the 0093 columns; the phone flow is unchanged. Entry: a desktop-only link in the game
room (organizer only, ≥900px) to /organize/<id>. NEXT: Matchups step, then full create-in-console + drag.

### v1.144.1 — Notifications panel UI fixes — migration 0094 (optional but recommended)
Rebuilt the bell panel as a bottom sheet consistent with the app's other popups (scrim + viewport-
anchored panel, left:0/right:0/maxWidth 440/margin auto) — this also fixes the old absolute dropdown
that ran off the left edge on phones. Added a header with an × close button and 'Clear all', and each
notification now shows relative + absolute date/time ('3h ago · Jul 13, 3:42 PM'). Dark greenMid sheet
with cream/sage text to match. 'Clear all' calls new RPC clear_my_notifications() (0094; SECURITY
DEFINER scoped to auth.uid()) with a client-side delete fallback, so it works even before the
migration is run. No behavior change to how notifications are created or marked read.

### v1.144.2 — Notifications: dismiss (mark read) + bold unread, replacing hard-delete
Reworked per the dismiss model: opening the bell no longer auto-marks everything read, so unread
notifications now show BOLD with a gold dot and read ones are muted/normal weight. 'Clear all'
(hard delete) is replaced by 'Mark all read' (shown only when there are unread); tapping a single
unread notification acknowledges just that one. Nothing is deleted — rows persist; the panel still
shows the 30 most recent. Retention unchanged: older-than-30 stay in the DB (no expiry, no history
screen). Migration 0094 (clear_my_notifications) is now UNUSED — harmless if already applied; can be
ignored or dropped. No new migration.

### v1.145.0 — FEATURE: full Notifications screen (history) — no migration
New NotificationsScreen (a 'notifications' tab) showing a user's COMPLETE notification history,
paginated (30 at a time, 'Load older'), so nothing sent to a user is out of reach beyond the bell's
recent-30 peek. Same dismiss model: unread bold + gold dot, tap one to acknowledge, 'Mark all read'.
Reachable from the More menu ('Notifications') and a new 'See all notifications →' footer in the bell
panel (onSeeAll prop). Shared notifWhen() timestamp helper. Note: the known-safe initials-regex
escape false-positive moved from manage.tsx:1226 to :1231.

### v1.145.1 — 90-day notification retention — migration 0095 (DB-only)
purge_old_notifications() deletes notifications older than 90 days (read or unread); scheduled via
pg_cron daily at 04:23 UTC ('purge-old-notifications'), same idempotent unschedule-then-schedule
pattern as tee-reminders/friction-sweep. No client change — the bell and Notifications screen simply
won't surface anything older than 90 days because it's gone. Run 0095 in the SQL editor.

### v1.145.2 — Surface the 90-day retention to users
Notifications screen now shows a footer line: 'Notifications are kept for 90 days, then removed
automatically.' so the purge (0095) isn't a surprise. Client-only, no migration.

### v1.146.0 — FEATURE: tappable 'live' notifications — no migration
Notifications that carry a link (the event types: game_added, game_finished, money_owed/paid,
bet_posted, tee_new, tee_reminder, group_member — stored by the 0069–0074 triggers as /?tab=… or
/?tt=<id>) are now tappable in BOTH the bell panel and the Notifications screen, routing in-app with
no reload. home.navigateFromNotif() parses the link: ?tt=<id> → tee-times deep link, ?tab=<name> →
that tab. Tapping also marks the item read. A › chevron + pointer cursor mark the clickable ones;
link-less informational notifications (admin messages, handicap changes) stay tap-to-acknowledge only.
Passed via new onNavigate prop on NotificationBell + NotificationsScreen.

### v1.147.0 — FEATURE: adaptive dense dashboard charts + standard × on tile popups — no migration
Both dashboard trend charts (SCORING FORM · DIFFERENTIAL and the tap-a-stat detail drawer) now
switch presentation by how many rounds are actually in view. Threshold: >30 rounds.
• ≤30 rounds: unchanged — per-round coloured bars + rolling line(s), round-number x-axis.
• >30 rounds (dense): new AdaptiveTrend view — raw rounds fade to faint dots, a SINGLE 5-round
  rolling-average line becomes the hero, gradient-coloured green where it beats your average and
  red where it doesn't (direction respects lower-is-better vs higher-is-better per stat), a dashed
  gold average reference line, and a DATE x-axis (preserveStartEnd, thinned) instead of round number.
  The 10-round line is intentionally dropped in dense view to keep it to one line (recent form).
Gradient is keyed to the rolling line's own min/max vs avg (objectBoundingBox), so it stays correct
regardless of y-domain padding, and collapses to a single colour when the line never crosses avg.
Captions swap to match the active view. AdaptiveTrend is a shared helper in dashboard.tsx.
Also: tile detail popup close is now a standard corner × icon button (was a 'Close ✕' text button) —
the pattern to reuse on any future popup.

### v1.148.0 — FEATURE: curated profile/peer card badges + times-earned counts — no migration
The player card (both your own profile card and the peer card opened from the roster) is now a
selective summary rather than a dump of every badge. The full history stays on the Achievements wall.
Card curation (components/player-card.tsx):
• Personal single-value records removed from the card: best vs par, best differential, best greens,
  best fairways, fewest putts (the old 'bests' row is gone) — they mean nothing to a peer.
• Redundant 'first birdie / first eagle / first round' badges dropped (subsumed by counts/milestones).
• Gross-score chain collapses to the BEST cleared (Broke 85 implies 90/100); rounds chain to the
  HIGHEST milestone reached. Only the top rung shows.
• Every repeatable badge shows its ×count (Scramble master ×7, No blow-ups ×4, Birdie ×7, …).
  Birdie + eagle are pinned so their counts always surface. Shelf capped at 8, ordered elite→rare→common.
• Bogey-free streaks pulled into their own 'Consistency' funnel (3+ / 5+ / a full nine / whole round)
  with per-length round counts — shows steadiness at each scale instead of one collapsed badge.
Badge engine (lib/badges.ts): the broke_100/90/85/80/broke_par badges changed from 'once' to 'count',
so their stored count is now the NUMBER OF ROUNDS that cleared the threshold (was: first time only).
syncBadges is diff-based and recomputes from each player's rounds on load, so these counts backfill
automatically the next time each user's card syncs — no manual migration/backfill needed.
Peer card now passes group_badges.count through (the RPC already returned it; the client was dropping it).

### v1.148.1 — FIX: count pill moved to top-right — no migration
The ×count badge on the profile/peer card and the Achievements wall was anchored bottom-right and
overlapped the badge label directly below it. Moved to top-right (right:-4, top:-4) on both surfaces.

### v1.148.2 — REFINE: bogey-free streaks are normal shelf badges — no migration
Dropped the separate 'Consistency' block. The four bogey-free streak badges (3+/5+/nine/round) are
now ordinary chips in the badge shelf, each with its ×count, sorted with everything else by tier so
Bogey-free round (elite) leads and 3+ (common) sits back. Within a tier they read hardest-first via a
bogeyTie comparator (nine before 5+) instead of by count. Consequence: as normal badges they compete
for the 8-chip cap, so 3+ can be pushed off on players with many common badges. buildConsistency and
the ConsistItem type removed.

### v1.148.3 — CHANGE: bogey-free streaks are now NET — no migration
The bogey-free family (3+/5+/nine/round) is measured on NET score instead of gross. A hole counts
toward the streak when the player is at net par or better — gross-to-par minus the handicap strokes
their course handicap allocates to that hole (via allocateStrokes, the same allocator used across the
app; course_handicap falls back to a computed one from index+rating+slope+par). This levels high vs
low handicappers: playing to your handicap earns the streak. Badges relabelled 'Net bogey-free 3+/5+/
nine/round' with updated descriptions. Par-train, bounce-back, blow-ups, even-par-nine stay GROSS
(absolute scoring feats) — only bogey-free changed. Keys unchanged; syncBadges recomputes counts from
each player's rounds on next load, so counts re-derive on net automatically (no backfill).

### v1.148.4 — REFINE: 'Clean card' → 'Penalty-free round', off the summary card — no migration
no_penalties relabelled 'Penalty-free round' (Clean card was misleading — read as no-bogeys). Evidence
text updated. Added to the card's CARD_EXCLUDE so it no longer appears on the profile/peer card; it
still lives on the full Achievements wall. Key unchanged.

### v1.149.0 — FIX: analytics day anchored to US Eastern — MIGRATION 0096 (RUN IT)
Resolves the discrepancy where the DAU tile (server UTC day) and the Daily report (browser-local day)
counted different 24-hour windows. Now a new analytics day starts at MIDNIGHT US EASTERN for everyone,
regardless of device timezone. Implemented by setting `timezone = America/New_York` ON the functions
(ALTER FUNCTION ... SET timezone), so every current_date / calendar-day comparison inside them evaluates
in ET without rewriting the bodies. Functions altered: mark_active (stamps daily_active.day in ET now),
get_admin_analytics (DAU/WAU/MAU/views/sparkline/churn), admin_stat_users (drill-downs incl active_day),
get_admin_engagement (rounds-cadence windows). Rolling `now() - interval` windows are absolute instants
and unchanged. Client: the Daily report builds its Today/Yesterday buttons in ET (Intl en-CA / America/
New_York) so they match the tiles; captions note 'Days run midnight–midnight US Eastern'.
FORWARD-ONLY: daily_active stores a date (not a timestamp), so opens already stamped in UTC can't be
perfectly reclassified — only opens from this migration forward are ET-exact; history is within ~1 day.
DEPLOY: run migration 0096.

### v1.149.1 — FIX: last UTC calendar-day touchpoints → Eastern — MIGRATION 0097 (RUN IT)
Follow-up to 0096. Anchored the remaining live functions that decided a calendar day in UTC:
get_power_users (activity window + days-since-active/churn flags) and the round-recording RPCs
post_game_rounds / post_group_rounds (only their played_at FALLBACK used UTC; primary is the game's
match date, unchanged). All via ALTER FUNCTION ... SET timezone. After this no live function uses a
UTC calendar day (only a cosmetic 2-digit-year fallback in the 0060 tee-code trigger remains).
DB-only. DEPLOY: run migration 0097.

### v1.149.2 — TOOLING: migrations run-ledger
Added MIGRATIONS.md (checklist of every migration; tick when run) + ci/gen-migrations-checklist.py
to regenerate it (adds new files, preserves ticks). Manual-run workflow has no tracking table, so
this is the record for catching un-run migrations. Currently flagged to verify-applied: 0082, 0092,
0093, 0095, 0096, 0097 (0094 is optional/unused).

### v1.150.0 — FEATURE: profile sharing gates showcase only (Option B) — MIGRATION 0098 (RUN IT)
show_card (profile sharing) now hides only the SHOWCASE — badges + the form sparkline. Name, handicap
index, and round count stay visible to club-mates (roster basics), so a private member's card reads
'N rounds' instead of a broken '0'. group_cards (0098, supersedes 0082) returns a row for every active
member incl. opted-out, always populates idx/idx_trend/live-rounds, blanks form when sharing off, and
returns show_card. group_badges unchanged (still hides badges for opted-out = correct). Client peer card
surfaces show_card, keeps rounds/index, and shows a clear '<name> has profile sharing off — badges and
form are hidden' note instead of the old misleading 'No card details'. Fixes Karan Sarin showing 0 rounds.
DEPLOY: run migration 0098.

### v1.151.0 — FEATURE: card index default = entered; Sandbaggers admin tab — MIGRATION 0099 (RUN IT)
1) Profile card now shows the player-ENTERED (GHIN) index by default, falling back to the app's
   scoring-computed index only when none is entered. (Was: computed first.) Both self + peer cards.
2) New System-admin tab 'Sandbaggers' (🚩): flags players whose entered index differs from the app's
   scoring-computed index (player_cards.idx) by >=20% RELATIVE, but ONLY once they have >=18 posted
   rounds (a thinner record skews the computed index, so GHIN is trusted as-is below that). Shows
   entered vs scoring, rounds, %, and direction (index looks high = classic sandbag / low). RPC
   admin_sandbaggers() (0099), is_admin-gated, security definer. DEPLOY: run migration 0099.

### v1.151.1 — CHANGE: Sandbaggers is now a CLUB-admin tab, club-scoped — MIGRATION 0100 (RUN IT)
Moved the Sandbaggers card from System (master-only) to the Club-admin tier, and made it club-scoped.
admin_sandbaggers(p_group) (0100, supersedes 0099) returns flagged members of THAT club and is callable
by an admin of the group (is_group_admin) OR a master admin. Same rule: >=18 posted rounds, >=20%
relative gap. AdminHome now receives activeGroupId and passes it through. DEPLOY: run migration 0100
(if 0099 was never run, 0100 is all you need; if it was, 0100 replaces it).

### v1.151.2 — ROLLBACK + RENAME: Sandbaggers system-only again; 'Super admin' → 'System Admin' — MIGRATION 0101 (RUN IT)
Reverted 0100's club-scoping: Sandbaggers is a System-admin (master) tool again — app-wide, master-gated,
card back in the System tier. admin_sandbaggers() (0101, no-arg, is_admin-gated) supersedes 0099 + 0100 —
run 0101 and ignore those. Removed the now-unused activeGroupId plumbing from AdminHome.
Renamed the admin tier badge 'SUPER ADMIN' → 'SYSTEM ADMIN' (desc: 'System admins only').
BACKLOG: logged 'Multiple System Admins (owner model)' — allow >1 system admin with an owner (Amit) who
alone can revoke/demote; owner cannot be demoted; audit every change.
DEPLOY: run migration 0101.

### v1.152.0 — FEATURE: owner model / multiple System Admins — MIGRATION 0102 (RUN IT)
profiles.is_owner marker above is_admin. Only the OWNER can add or remove system admins (promote AND
demote owner-only); owner cannot be demoted; you can't change your own admin status; every change is
audit-logged server-side. New RPCs: is_owner(), admin_set_system_admin(p_user,p_make) (owner-gated).
admin_list_users() now returns is_owner (owner sorted first). Users tab: role badge ('★ owner' /
'★ system admin') + owner-only 'Make admin' / 'Remove admin' buttons (hidden for everyone but the owner,
never shown on the owner row or your own).
SEED: 0102 auto-sets is_owner on the sole existing admin. If you had >1 admin already it no-ops — then
run the manual seed line in the migration with your email. After deploy, confirm you show '★ owner'.
DEPLOY: run migration 0102.
