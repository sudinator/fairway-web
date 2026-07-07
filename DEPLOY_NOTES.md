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
