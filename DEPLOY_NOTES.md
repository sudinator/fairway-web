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
