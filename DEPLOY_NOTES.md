# Birdie Num Num — Deploy \& Migration Notes

## Convention 

* Every database migration's full SQL is pasted **inline in the chat** at delivery
time (not just shipped in the bundle), so it can be run without opening files.
* Migrations are run **manually** in the Supabase SQL editor, in numeric order.
Run each new migration once; `create or replace` / `add column if not exists`
make re-runs safe.
* App code is cumulative: deploying the latest bundle ships all prior code. Only
the **migrations** must be applied by hand.

## Versioning (changed after v1.165.0)

Through `v1.165.0` the version was semver `1.MINOR.PATCH` — the leading `1` never
moved (this app never goes to a "v2"). From the next release the scheme is
**`FEATURE.EDIT.YYMMDD`** (e.g. `165.1.260714`): **FEATURE** bumps on a new feature;
**EDIT** counts refinements within that feature and resets to 0 on a FEATURE bump;
**YYMMDD** is the release date in **US/Eastern**. Bump EDIT on every ship (even two
on the same day) so no two builds share a string. Still valid semver, so npm and
`scripts/write-version.mjs` are unchanged. So the changelog below reads
`… v1.164.3 → v1.165.0 → 165.1.260714 → …`.

## Migration order (run in this sequence)

Baseline (supabase/migrations/): 0001 → 0013. These are the original schema and
core RPCs (groups, members, games, scoring, markers, finish\_game, delete\_game).

App-authored (migrations/): run after the baseline, in order:

* 0014 round\_clock
* 0015 multiuse\_group\_invites
* 0016 trifecta
* 0017 notifications\_lockdown
* 0018 live\_scorecard
* 0019 avatars
* 0020 analytics
* 0021 live\_teams\_stats
* 0022 scorecard\_ownership
* 0023 reset\_game\_scores
* 0024 trifecta\_scoring
* 0025 group\_roster
* 0026 post\_game\_rounds
* 0027 admin\_group\_oversight      (master-admin: all-groups overview + archive/unarchive)
* 0028 admin\_support\_session      (master-admin: logged enter/exit a group)
* 0029 admin\_delete\_group         (master-admin: hard-delete a group, preserves rounds)
* 0030 default\_group              (designate a default group; stranded users land there)
* 0031 admin\_game\_repair          (master-admin: force end/reopen/reset/delete/reassign any game)
* 0032 admin\_merge\_users\_groups   (merge groups; ban; revoke invites; list/wipe/merge users)
* 0033 lock\_privileged\_profile\_columns  (CRITICAL: block self-grant of is\_admin/banned)
* 0034 enforce\_ban\_in\_access      (fold "not banned" into is\_admin/is\_group\_member/is\_group\_admin)
* 0035 stroke\_basis               (Stroke play: gross vs net total basis)
* 0036 skins\_mode                 (individual Skins: carryover vs split)  \[REQUIRED for split skins]
* 0037 feedback                   (in-app bug/feature/question table + RLS)  \[REQUIRED for the Feedback feature]
* 0038 auth\_blocklist             (banned\_emails + born-banned profile trigger; ban/wipe sync; default-group refuse; admin\_unblock\_email)
* 0039 support\_session\_expiry     (group\_members.support\_started\_at + expire\_support\_sessions reaper; admin\_enter\_group stamps + reaps)
* 0040 score\_validation           (defense-in-depth value check trigger on game\_players)  \[OPTIONAL - app UI can't produce bad values; guards only the raw API]
* 0041 live\_stroke\_trifecta       (live RPC get\_live\_scorecard now returns trifecta\_scoring + stroke\_basis)  \[REQUIRED for correct live Stroke play / match-scored Trifecta]

### Recent migrations (0035-0041) - notes

* REQUIRED before the matching feature works: 0036 (split skins), 0037 (feedback),
0041 (live Stroke/Trifecta). Code is safe to deploy ahead of them - it falls back
to sensible defaults - but the feature is wrong/broken until the migration runs.
* 0038/0039 are operational hardening (keep banned/wiped users out; auto-clear
forgotten support sessions). Run both. 0038 creates the `banned\_emails` table and
a BEFORE INSERT trigger on `profiles`; 0039 adds a column + reaper and re-creates
`admin\_enter\_group`.
* 0040 is optional. RLS already scopes WHO can write a row; this trigger only adds a
VALUE sanity-check (catches malformed arrays from a hand-crafted API call, not the
app UI). Test it against a real score write before relying on it.

### Security floor (run + verify)

* 0033 is the critical one: without it any user could `update profiles set is\_admin=true`
on their own row and unlock every admin RPC. Run it first if nothing else.
* 0034 edits the three core access helpers (is\_admin, is\_group\_member, is\_group\_admin),
which previously lived ONLY in the live DB — they are now captured here. High blast
radius: test a suspended account is locked out AND a normal account still works.
* activity\_log RLS is correct (admin-only read; insert gated to actor\_id=auth.uid()).
Just confirm row-level security is ENABLED on the table (and on profiles).

### Master-admin oversight set (0027–0030) — notes

* All functions are SECURITY DEFINER and gated by `is\_admin()`; they assume the
live DB already has the `is\_admin()` helper (it predates these migrations).
* 0028 adds `group\_members.is\_support`; 0030 adds `groups.is\_default` with a
partial unique index so only one group can be the default.
* 0028 and 0030 each REPLACE `admin\_group\_overview()` with a wider return type,
so they `drop function if exists public.admin\_group\_overview();` first.
Always run them in order — running 0030 without 0028 still works (it drops and
recreates), but the column adds must have happened.
* If `admin\_set\_group\_status` is missing, 0027 wasn't run. If `admin\_enter\_group`
is missing, 0028 wasn't run. Etc.

\---

# Birdie Num Num — v1.22.0

Full offline/lock resilience for GROUP scoring + penalties/sand in the backup.
NO migration. Built on the restored v1.5.2 core (offline/lock recovery unchanged
in spirit, now extended).

## Gap 1 fixed: penalties \& sand are backed up

The local backup now stores penalties and sand alongside scores/putts/fairways,
and the recovery merge restores them. Previously an offline/lock entry could
recover the strokes but lose the penalty/sand metadata.

## Gap 2 fixed: in group scoring, ALL players' scores are backed up \& synced

* The scoring device (marker) now writes a local backup for EVERY player it
scores, not just its own row. So if the marker enters the group's scores with
no signal or the screen locks, every player's entry is held safely on the
device.
* Recovery now reconciles EVERY backed-up row, not just "my" row. On reopen, the
marker's device pushes any holes the DB is missing (offline entries) back up for
all players.
* New: when the device comes back ONLINE, it reloads and syncs automatically — no
need to reopen the game.
* Pushing another player's recovered row uses the marker's server-side rights; a
push that isn't permitted is harmless (the backup is kept, nothing is lost).

## Preserved guarantees

* A backup is NEVER discarded by load(); it only fills holes the DB is missing.
Real scores always win; nothing is removed by recovery.
* The master reset now clears EVERY local backup for the game on the resetting
device (including marker-held rows), so a pre-game test wipe leaves nothing to
resurface. Other devices are untouched — their real scores stay protected.

## How preservation now holds, end to end

* Screen lock mid-entry: synchronous disk backup lands before the network write;
recovered on reopen. (any player, group or solo)
* No signal: entries held on disk; synced on the next online event or reopen.
(any player, group or solo)
* App killed: disk backup survives; recovered on relaunch. (any player)

## Verified locally

* tsc --noEmit: clean
* next build: passes
* Unit tests: 130/130 pass (incl. mergeBackupRow recovery + the marker-clobber
guard reproduction)

## Smoke-test (two devices, the group case this fixes)

1. Device A is the marker. Put A in airplane mode. Enter scores for all players.
2. Kill/relaunch A (still offline) -> scores still shown (from backup).
3. Turn signal back on -> scores sync to the server automatically; Device B sees
them. Nothing lost.

## v1.54.0 — Yardage backfill (admin tool)

* No migration. No new env var (uses existing GOLF\_API\_KEY already set for course search).
* After deploy: open the **Courses** tab as an admin -> the "YARDAGE BACKFILL - ADMIN" panel -> **Preview** (no writes) -> review -> **Apply**.
* Writes only favorite\_courses.data.tees\[].yardages (missing cells only). Nothing else is touched.
* Re-runnable safely (already-filled tees report "nothing to fill").

## v1.54.1 — Yardage editor (admin)

* No migration, no new env var.
* Courses tab -> YARDAGE BACKFILL panel -> section 2 "Fix one course": Load courses -> pick a course.

  * Re-look-up: search golfcourseapi, pick the correct course, "Fill all matching tees" (or map each tee), Save.
  * Manual: type yardages per tee/hole, Save.
* Saving writes only favorite\_courses.data.tees\[].yardages. external\_id is NOT changed.

## v1.59.0 — Group finish posts everyone + mid-round skins switch

* **Migration REQUIRED: `migrations/0045\_post\_group\_rounds.sql`** — run it in the Supabase SQL editor before/at deploy.

  * Adds `post\_group\_rounds(p\_game uuid, p\_tee\_group int)` (SECURITY DEFINER). Finishing a tee group now posts a round for EVERY player in that group (group scoring: one keeper holds everyone's scores), not just the keeper. Mirrors `post\_game\_rounds` but scoped to one tee group and callable by any game member. Idempotent.
* No new env var.
* Behavior: "Finish group" now writes all group members' rounds immediately. "End game" still posts everyone via `post\_game\_rounds`. Both are idempotent (one round per game+user, updated in place).
* Also: skins games can now switch **When a hole ties (Carry over / Halved)** mid-round from the in-game Settings panel; team best-ball skins can also switch **Team score (Best ball / Aggregate)** there. No migration needed for that part (uses existing `skins\_mode` / `team\_score\_mode` columns).
* Retro-fix for the affected Francis Byrne round: re-open the game (organizer) and tap **End game** again — `post\_game\_rounds` will then post the partners' rounds from the scores already stored on their player rows.

## v1.59.2 — post\_group\_rounds aligned to the 0044 fix + client date fix

* **Migration renumbered to `migrations/0045\_post\_group\_rounds.sql`** (the earlier 0043 name collided with the existing 0043/0044 already in Supabase). Run it AFTER 0043/0044 — it relies on the unique index on rounds(game\_id, user\_id) from 0043 for its ON CONFLICT upsert.
* post\_group\_rounds now mirrors the fixed post\_game\_rounds (0044): stamps the game's MATCH date (games.played\_at), and uses ON CONFLICT (game\_id, user\_id) DO UPDATE so concurrent group finishes can't abort the post with a unique violation.
* Client fix: recordMyGameRound now stamps the match date (game.played\_at) instead of the creation timestamp — restores the v1.53.1 behavior that an earlier working copy had reverted, and keeps the client consistent with both RPCs.
* Repo hygiene: 0044\_post\_game\_rounds\_fix.sql re-added to the repo so bundles carry it. (0043 is still only in your live DB + local repo; paste it anytime and I'll fold it in.)

## v1.60.0 — Change game structure mid-round (setup tab)

* No migration, no new env var.
* The Game setup tab (organizer) now exposes the structural choices that were previously only available at New game:

  * Skins: a "Skins style" selector — Individual / 1:1 Teams / 2v2 Best-ball. Switching is score-preserving; Individual clears teams/foursomes/pairings (with a confirm when scores exist), the team styles hand off to the Teams/Matchups steps to assign sides.
  * Match: a "Players" selector — Individual / Team (4 v 4).
* All changes write live to the game and standings recompute; no scores are touched.
* NOTE: this is the setup-tab half. The New-game picker still uses its own controls; converging both onto one shared component (so they can't drift again) is the planned next step.

## v1.60.2 — Preserve-and-hide for structure switches

* **Migration REQUIRED: `migrations/0046\_structure\_stash.sql`** — adds games.structure\_stash (jsonb). Run before/at deploy.
* Switching a skins game between Individual / 1:1 Teams / 2v2 Best-ball, and a match between Individual / Team, now STASHES the team structure (teams/foursomes/pairings) instead of discarding it. Switching back restores it intact — matchups reappear filled in. Player team assignments live on game\_players and were never touched, so they survive too.
* Plain game\_type switches already preserved structure (setFormat never clears); this brings the skins/match sub-toggles in line.
* No behavior change for legacy games (stash starts null; first switch populates it).

## v1.62.0 — game-shape module + tests

* No migration. Pure refactor: shapeOf/dotStrokes/chBasis/pkey moved to lib/game-shape.ts; tournaments.tsx imports them.
* New: `npm test` runs lib/game-shape.test.ts (no extra deps; uses tsc + node). Run it before shipping format/scoring changes.

## v1.66.1 — Offline Phase 3 hardening (no migration)

No schema change; deploy is code-only.

* **Drain-before-finish:** Finishing a tee group (finishMyGroup) and ending a game (endGame) now `await drainOutbox()` and re-check `countPending()` AFTER the requireOnline guard. If any holes still haven't uploaded, the action is blocked with a prompt to Sync now and retry — so a round is never recorded from pre-sync server state (which would drop late offline holes).
* **Reset/wipe coherence:** the load() reset branch now also clears the row's synced watermark (clearSyncedWatermark) when it discards a pre-reset backup, so a stale “already synced” marker can't suppress re-pushing fresh post-reset scores. deleteGame now calls clearAllGameScores(gameId) + clearActiveGame() so a deleted game leaves no snapshot/backups/watermarks/active-pointer behind. (resetGame already wiped local via clearAllGameScores.)

## v1.69.0 — Avatars everywhere (migration 0047)

**Run migration 0047\_live\_avatar.sql** in the Supabase SQL editor before/at deploy. It recreates get\_live\_scorecard (from 0041) with one added field, 'avatar\_url' (from the existing denormalized game\_players.avatar\_url column — no new columns). Without it the public live page falls back to initials for everyone.
App changes (no data): profile photos (or initials) now also render on the game leaderboard was already present; added to the skins leaderboards, singles match header, match result cards, team strips, and the public live leaderboard. Native <select> pickers and dense per-hole scorecard columns intentionally left text-only.



## Backfill — app-only releases (no migration unless noted)

These shipped between the migration/structural entries above and were not individually noted here; recorded now to keep DEPLOY\_NOTES in sync with BACKLOG.

* v1.66.0 group share-to-chat card; v1.66.2 horizontal individual share card.
* v1.67.0 dashboard "How you compare" card; v1.67.1 compare-card readability.
* v1.68.0 avatars in groups + directory.
* v1.69.1 tee reminder (later moved); v1.69.2 course-library per-tee yardage.
* v1.70.0 team/match Group results segment summary; v1.70.1 tee moved under group-scorecard profile.
* v1.71.0 dashboard click-a-stat TREND chart (bars + rolling averages).
* v1.71.1 fixes: Stableford trend estimates instead of plotting 0 for gross-only rounds; de-duplicated Group-results columns on <18-hole games; avatars added to Group-results rows; removed dead dashboard perRound helper; this backfill.
Migrations remain: 0045 post\_group\_rounds, 0046 structure\_stash, 0047 live\_avatar (documented above) — run in order in the Supabase SQL editor.



## v1.72.0 — Money foundation (migration 0048)

**Run migration 0048\_money.sql** in the Supabase SQL editor (idempotent; safe to run now even though the Money UI lands in the next release). Creates group\_guests, expenses, expense\_shares, settlements, and adds venmo\_handle/paypal\_handle/phone to profiles, all RLS-gated by active group membership. No app screens use these yet — this release ships the tested money logic (lib/money.ts) and the schema; the Money tab follows. Outstanding migrations to run in order: 0045, 0046, 0047, 0048.

## v1.75.0 — Multiple payers (migration 0049)

**Run migration 0049\_expense\_payers.sql** in the Supabase SQL editor (idempotent; run after 0048). Adds the expense\_payers table (who paid, how much) + RLS. Existing single-payer expenses keep working via the payer\_user\_id fallback. Outstanding migrations in order: 0045, 0046, 0047, 0048, 0049.

## v1.76.0 — Phase 2 (migration 0050)

**Run migration 0050\_expense\_audit.sql** (idempotent; after 0049). Adds expense\_audit for per-expense edit history + RLS. Category summary needs no migration. Outstanding migrations in order: 0045, 0046, 0047, 0048, 0049, 0050.

## v1.77.0 — Group activity log (migration 0051)

**Run migration 0051\_group\_activity.sql** (idempotent; after 0050). Immutable, group-wide money log visible to all members (the 'Log' tab in Money). Logs expense create/edit/delete, settlements, and guest adds. expense\_audit (0050) is now unused for logging (per-expense history reads from group\_activity); the 0050 table can stay in place harmlessly. Outstanding migrations in order: 0045, 0046, 0047, 0048, 0049, 0050, 0051.

## v1.77.1 — Fix: Money member visibility (migration 0052)

**Run migration 0052\_group\_pay\_roster.sql** (idempotent; after 0051). profiles RLS was hiding other members from non-admins, so the Money split/payer lists collapsed to just yourself. Adds a SECURITY DEFINER group\_pay\_roster() returning every active member's id/name/avatar + venmo/paypal/phone (guarded by is\_group\_member). The app falls back to the old direct query if 0052 isn't run, but the full roster only appears once it is. Run order: 0045..0052.

## v1.79.0 — Group results: legs \& team points

Run migration **0053\_leg\_config.sql** in Supabase SQL editor (adds `games.leg\_config jsonb`, idempotent). Run order is now 0045 → 0053. No other steps; existing games default to leaderboard-only until an organizer assigns leg points in setup.

## v1.80.0 - Money: simplify toggle

Run migration **0054\_money\_simplify.sql** (adds groups.money\_simplify boolean default true, idempotent). Run order now 0045 -> 0054. Existing groups default to fewest-payments (current behavior).

## v1.81.0 - Money: Zelle

Run migration **0055\_zelle.sql** (adds profiles.zelle\_handle, redefines group\_pay\_roster to return it; idempotent). Run order now 0045 -> 0055.

* Run migration 0056\_expense\_source.sql (adds expenses.source\_game\_id + source\_kind + one-bet-per-game index) before the Betting→Money post button is used.
* Run migration 0057\_tee\_times.sql (creates tee\_times + tee\_time\_rsvps + RLS) before the Tee Times UI ships.
* Tee Times UI (v1.86.0) is live in the More menu for the TGC group only. Migration 0057 MUST be run first or the tab will error on load.
* Run migration 0058\_rounds\_soft\_delete.sql (adds rounds.deleted\_at) so deleting a game round sticks instead of being re-posted.
* IMPORTANT: run 0058\_rounds\_soft\_delete.sql. Without it the rounds list still loads (v1.87.3 falls back to unfiltered), but soft-deleted rounds won't be hidden until the column exists.

## v1.89.0 — Tee Times P3 (notifications/reminders + activity log)

* **NO migration.** Reuses the existing `group\_activity` table (0051) for the audit trail and adds no schema. Nothing to run in Supabase for this release.
* Deadline reminder is a **WhatsApp export with a deep link** (organizer taps "Copy reminder for WhatsApp" on the tee-time detail → pastes to the group). The link is `https://birdienumnum.vercel.app/?tt=<tee\_time\_id>` and opens the app straight on that tee time's RSVP window. Deep-link plumbing added in `app/page.tsx` (stashes `?tt=` to localStorage before auth, cleans the URL) and `components/home.tsx` (reads it once, switches to the Tee Times tab, passes `initialTeeId`).
* **Activity logging** to `group\_activity` with `tt\_`-prefixed actions: `tt\_posted`, `tt\_cancelled`, `tt\_rsvp` (self), `tt\_rsvp\_org` (organizer set on someone's behalf, records target), `tt\_promote`, `tt\_captain`. Each carries `meta.{tee\_time\_id, seq, ...}`. New **Activity** sub-tab on the tee-time detail shows that tee time's history (resolves "but I signed up" disputes). `components/money.tsx` now excludes `tt%` actions from the Money log (`.not("action","like","tt%")`) so they don't bleed into it.
* UI: the shared `Eyebrow` (components/ui.tsx) gained an optional `style` prop (backward-compatible); Tee Times uses it to space the gold section labels (list "All upcoming/Past/Cancelled" and Signups "In/Maybe/Out/Not responded"), which were flush against the cards.
* Verified locally: `tsc --noEmit` clean, 174 tests pass, `next build` compiles successfully (prerender needs the Supabase env vars, as always).

## v1.90.0 — Tee Times P4 (round → game handoff) + tee/format defaults

* **NO migration.** Uses `tee\_times.game\_id` (already exists, migration 0057) and `group\_activity` (0051). Nothing to run.
* **Handoff:** the tee-time detail (organizer) shows **"Create game from this tee time"** when no game is linked and the IN list is non-empty; once linked it shows **"Open linked game"** (never double-creates). "Create" hands a seed up through `home.tsx` (new one-shot `gameSeed`/`openGameId`, cleared on leaving the Games tab — mirrors `moneyInitialTab`) → `Tournaments` opens Create Game prefilled with the course (+ default tee), the play date, and the IN-list members preselected. The organizer picks format/tee/allowance and creates as normal; on create the game id is written to `tee\_times.game\_id` and a `tt\_game\_linked` row is logged. **Group/tee-group assignment stays manual** (done in game setup) and **guests are added manually** in review (no per-guest handicap edit UI, so they're not seeded).
* **Tee default (TGC only):** picking a course now defaults the tee to a "member" tee by name, else the tee whose total yardage is closest to 6400, else the first tee (`defaultTeeIdx` in tournaments.tsx; gated on `TGC\_GROUP\_ID`). Format already defaults to Stableford / 100% app-wide, so a TGC handoff opens with that.
* **Activity log** now shows the **year** in each timestamp (e.g. "Jul 3, 2026, 9:14 PM"), visible to all members on the tee-time Activity sub-tab.
* Verified locally: `tsc --noEmit` clean, 174 tests pass, `next build` compiles successfully.

## v1.91.0 — Tee Times: guest carry-forward + drop-a-guest (waitlist)

* **NO migration.** Uses existing tables only.
* **Guest carry-forward (corrects v1.90.0):** the P4 handoff now carries the tee time's IN-list guests into Create Game as guest players. Guests with no handicap on file come in flagged "NEEDS HCP" with an inline index field; the organizer can fill it or leave it (they're still created and play off scratch). `GameSeed.guestNames` now populated from `ins\[].guest\_names`; guest `course\_handicap` is null-guarded.
* **Drop a guest for the waitlist:** on the Signups tab, an organizer sees each IN member's guests as removable chips; removing one frees exactly one spot and the next waitlisted member moves into the field automatically (field/waitlist recomputes by signup order). Logged as `tt\_guest\_removed`; the host member gets a notification that their guest was removed.
* Verified locally: `tsc --noEmit` clean, 174 tests pass, `next build` compiles successfully.

## v1.92.0 — Betting: include/exclude a player (amateur-in-a-pro-event)

* **RUN migration 0059\_game\_players\_bets.sql** (adds `game\_players.bets boolean not null default true` + the `set\_player\_bets` organizer-gated RPC). Run after 0058. Full SQL is printed in chat.
* New games: **TGC members default IN**, **guests default OUT** (guest rows insert `bets=false`). Existing rows default `true` (past games unchanged).
* The game's Betting panel "Who's betting" toggles now **persist** to `game\_players.bets` (organizer/admin only; buttons disabled for others) via `set\_player\_bets`. Realtime on `game\_players` refreshes the room so the banners stay in sync.
* Excluded players **still play and appear on the leaderboard** (tagged "no bet", $0). The pot and all payouts are computed over bettors only, so an excluded player who posts the low score simply hands 1st to the next betting player. The clean-sweep watch / achieved banners now **follow the money** (bettors only) via `segWinnersBet`/`segTotalsBet`; the standings still show everyone's scores. The Money post already reflects bettors only.
* Verified locally: tsc clean, tests pass (incl. new bettor-only cases), build clean.

## v1.93.0 — Betting→Money Phase 2 (re-post corrected winnings)

* **NO migration.** Uses existing tables/RPCs.
* When scores change after winnings were posted, the game now detects that the posted bet expense no longer matches the current scores. The Betting panel (organizer) shows **"Scores changed since posting → Review \& re-post"** with a per-bettor old→new preview; the play view shows a room-level **"Posted bet winnings are out of date"** banner (visible right after an edit), and the organizer is notified (group\_activity `bet\_stale` + best-effort push).
* **Re-post = net-balance model (no payment reversal):** it deletes the old linked bet expense and posts the corrected one. Settlements are group-level, so they're untouched and `computeBalances` reconciles automatically — anyone who overpaid the old amount now shows as **owed back** in Money; the residual settles through the normal Settle flow. Logged as `bet\_reposted` with old→new.
* **Bug fix (from v1.92.0):** the "keep bettor list in sync" effect was re-adding new players unconditionally, which pulled guests (bets=false) back into the bet. It now only auto-includes players whose `bets !== false`, so guests stay out by default.
* Verified locally: tsc clean, all tests pass, build clean.

## v1.93.1 — Bug-fix sweep (code-only, NO migration)

Five fixes from a fresh code review:

* **#1 Re-post rollback:** if the corrected splits fail to save during a re-post, the new expense is now deleted so you end up cleanly *un-posted* rather than with a half-written entry that would compute wrong balances. (Matches the original post's rollback.)
* **#2 Organizer mark-out clears guests:** when the organizer marks a member Out/Maybe, their guests are cleared (matching a member's own RSVP), so guests don't linger on the row or reappear if the member is later marked back In.
* **#5 One source of truth for "who's betting":** the payout panel now derives the bettor list from the persisted `bets` flag — the same source the clean-sweep banners use — so they can never disagree. Toggling optimistically updates the shared player list and persists via `set\_player\_bets`. (Removed the separate in-memory list + its sync effect.)
* **#7 Fresh stale-notify per episode:** the "organizer notified winnings are stale" guard now resets once winnings are corrected, so a *second* stale episode on the same game re-notifies (still never spamming within one episode).
* **Round-delete warning:** deleting a round that came from a game now shows a confirm clarifying it only removes it from personal history/handicap and does NOT change the game result or posted winnings.
* Left as-is by decision: #3 (captains already control their own game's money), #4 (poster/creator + group admin own money entries), #6 (guarded a non-scenario — the bet field is set before posting).
* Verified: tsc clean, all tests pass, build clean.

## v1.93.2 — Tee-time reliability sweep (RUN migration 0060)

* **RUN migration 0060\_tee\_seq.sql** (unique index on (group\_id, seq) + `assign\_tee\_seq` BEFORE INSERT trigger). Full SQL printed in chat. Run after 0059.

  * Heads-up: the unique index will fail to create if a group already has two tee times sharing a number (from a past browser-numbering collision). If it errors, resolve the duplicate seq first, then re-run.
* **#1 Organizer actions now surface errors:** RSVP, organizer mark-in/out, cancel, captain assign, waitlist promote, and remove-guest now capture the Supabase error. On failure they show a message (dismissible banner in the detail view; alert for a member's own RSVP) and **skip the success activity-log entry and any navigation** — no more silent "looks like it worked."
* **#2 Collision-safe numbering:** the tee-time number is now assigned by the database atomically (per-group advisory lock, max()+1) instead of computed in the browser, so two organizers posting at once can't get the same number. The form still shows a best-guess preview; the DB number is authoritative and used in the activity log.
* **#3 Max-spots validation:** blank now means the 60-player max (not "unlimited"); the field accepts a whole number 1–60 only (input has min/max/step, and `post()` rejects 0/negatives/non-integers with a clear message). Fixes the old `parseInt || null` footgun where 0 became "no limit" and negatives broke capacity.
* **Waitlist wording:** the "you'll join the waitlist" copy now explains you're still signed up and will move into the field automatically. Waitlisted members show **"Waitlist #N"** (position), and your own response line shows **"In the field"** or **"Waitlist #N"**. Model unchanged (position stays computed from signup order — that's what makes auto-promotion clean).
* Verified: tsc clean, all tests pass, build clean.

## v1.94.0 — Randomize groups (keeps guests with their sponsor) — RUN migration 0061

* **RUN migration 0061\_guest\_sponsor\_groups.sql** (adds `game\_players.guest\_of` + the `set\_tee\_groups` batch RPC). Full SQL printed in chat. Run after 0060. Idempotent.
* **Guests now carry a sponsor.** A new `guest\_of` column records which member invited each guest, populated on every guest-add path: (1) creating a game from a tee time attributes each guest to the member whose RSVP listed them; (2) the create-flow and (3) the in-game "Add guest" both have a **"Guest of…"** picker (defaults to the person adding) and a **"Add a past guest…"** quick-pick sourced from the group's shared guest list (`group\_guests`), which also stays in sync when a brand-new guest is added. In-game guests are now correctly inserted with `bets = false` (a latent bug — previously they defaulted into the money game).
* **🎲 Randomize groups** (Stableford/stroke setup, in the Groups step): shuffles the field into balanced foursomes and writes every tee group in one transaction via `set\_tee\_groups`. A member and the guests they sponsored stay in the same foursome. Sizes come out balanced (5 → \[3,2], 10 → \[4,3,3]; never a lone single when avoidable) and no group ever exceeds four.
* **Overflow rule:** a sponsor keeps a full foursome (themselves + up to 3 guests). If a member brought 4+ guests, the extra guests are left **unassigned** with a banner naming them, for the organizer to place by hand. A group can never exceed four.
* **Pre-round only:** the button is disabled once any score is entered or a group is locked (you can't reshuffle a round that's underway).
* Pure algorithm in `lib/grouping.ts` with 281 unit tests. Verified: tsc clean, all tests pass, build clean.

## v1.94.1 — WhatsApp export gets the tap-to-open link (no migration)

* The main **"Copy for WhatsApp"** tee-time message now ends with a clickable deep link (`👉 Open in the app to RSVP or view: …/?tt=<id>`), matching the reminder message. Tapping it opens the app straight on that tee time (the link survives the Google sign-in redirect via the existing `?tt=` capture in page.tsx → home.tsx). The reminder message already had this; only the full-field export was missing it.
* Code-only. Verified: tsc clean, tests pass, build clean.

## v1.94.2 — WhatsApp deep link auto-switches to the tee time's group (no migration)

* A tee-time deep link (`/?tt=<id>`) now works even when the recipient is viewing a different group. home.tsx resolves the tee time's group\_id and switches the active group to it (persisting to profiles.active\_group\_id + boot cache) BEFORE handing the id to the Tee Times screen — so the tee time is in the loaded list when it opens.
* Robustness: the id is only passed to Tee Times once the target group is active (a new `deepReady` gate), which fixes the prior race where Tee Times would "consume" the deep link against the wrong group and silently give up. If the tee time is unknown or the user isn't a member (RLS hides it), it falls back gracefully to the current group with no error.
* Code-only. Verified: tsc clean, tests pass, build clean.

## v1.94.3 — Fix: game\_players.bets NOT-NULL violation on game setup (no migration required)

* Cause: member player rows (create-game roster, self-join, add-member) omitted `bets` and relied on the column's DB default. If the live `game\_players.bets` column ended up NOT NULL without a working default (0059's `add column if not exists ... default true` silently skips setting the default when the column already existed from an earlier state), those inserts sent NULL and failed with "null value in column bets ... violates not-null constraint."
* Fix (code): all four game\_players insert paths now set `bets` explicitly — members `true` (in the TGC money game), guests `false` — so inserts never depend on the DB default. No migration needed.
* OPTIONAL root-cause cleanup (safe, idempotent) to restore the column default so future/manual inserts also behave:
alter table public.game\_players alter column bets set default true;
* Verified: tsc clean, tests pass, build clean.

## v1.95.0 — Robustness hardening (defensive writes + default repair + error surfacing) — RUN migration 0062

* **RUN migration 0062\_repair\_column\_defaults.sql** (re-asserts DB defaults on the \~18 columns added via `add column if not exists ... default`, which silently skips the default if the column already existed). Read-only-safe on existing data; idempotent. Full SQL printed in chat. Run after 0061.
* **Defensive writes (Item 1):** every `game\_players` INSERT now sets all NOT-NULL state columns explicitly via a shared `GP\_STATE\_DEFAULTS` ({penalties:\[], sand:\[], is\_marker:false, group\_locked:false}) plus is\_guest/bets — so inserts never depend on a DB default again (the `bets` incident could also have hit penalties/sand/is\_marker/group\_locked, which blankCard() previously omitted). New standing rule: never rely on a DB default for a NOT-NULL column; always set it in the insert.
* **Error surfacing (Item 4):** added a tiny global toast (components/toast.tsx, mounted once in home). Key user-facing game-setup writes that previously swallowed errors now surface a message on failure: add member, add guest, tee-group assignment, betting toggle, and Randomize. Best-effort logging/notification catches remain intentional.
* **SMOKE\_TEST.sql** added to the repo: run it in the Supabase SQL editor after any migration to catch a missing-default drift before members do (Check 1 is read-only; Check 2 attempts the app's inserts and rolls back). See the walkthrough.
* Verified: tsc clean, all tests pass, build clean.

## v1.96.0 — Resume an interrupted game setup (no migration)

* Leaving the Create Game screen mid-setup no longer loses your picks. The in-progress setup (name, date, course+tee, format \& options, selected members, guests with sponsors, teams) is saved to a device-local draft as you go — no game row is created until you finish, so there's still nothing to clean up.
* Returning to Create Game shows a **"Resume your setup?"** banner (Resume / Start fresh). Resume restores everything (course re-matched by name once favorites load); Start fresh clears the draft and uses the tee-time defaults. The draft is cleared automatically when the game is created.
* Keyed by group + originating tee time (bnn\_setup\_draft:<group>:<teeTime>), so drafts never bleed across tee times or groups. New lib/setup-draft.ts. Note: an explicit Cancel keeps the draft (so you can resume later); use "Start fresh" on the banner to discard.
* Verified: tsc clean, all tests pass, build clean.

## v1.96.1 — Automated robustness check on every deploy (CI; app unchanged)

* Added .github/workflows/robustness.yml. On every push/PR (and daily + on-demand) it runs two jobs:

  1. **Types, tests, build** — `tsc --noEmit`, `npm test` (349 pure-logic tests), `next build`. Catches code/logic/type regressions before deploy.
  2. **Database schema guard (read-only)** — runs ci/schema-check.sh against the database in the `SUPABASE\_DB\_URL` repo secret: lists NOT-NULL columns without a default (informational) and HARD-FAILS if any "state" column the app relies on a default for is missing one (ci/assert-defaults.sql). This is the automated version of SMOKE\_TEST.sql and directly guards against the `bets` drift class. 100% read-only — safe to point at production. Skips (doesn't fail) until the secret is set.
* To enable the DB guard: GitHub repo → Settings → Secrets and variables → Actions → New repository secret → name `SUPABASE\_DB\_URL`, value = the Supabase "Session pooler" connection URI (Supabase → Project Settings → Database → Connection string → URI, Session pooler). Read-only use.
* App behavior is unchanged from v1.96.0 (this release adds CI + ci/ scripts only; no app code, no migration). We validated the guard against a real Postgres: it passes when defaults exist and fails (naming the column) when one is dropped.

## v1.97.0 — Resume drafts for course creation and tee-time creation (no migration)

* Factored the draft logic into one shared helper (lib/form-draft.ts: loadFormDraft/saveFormDraft/clearFormDraft/draftAgeLabel). Game setup (lib/setup-draft.ts) now delegates to it; Courses and Tee Times use it directly.
* **Courses:** starting a NEW course and leaving mid-entry no longer loses your work (name, tees, per-hole par/SI/yardages, ratings). "Add a course" shows a "Resume your course?" banner (Resume / Start fresh); the draft clears on save. Editing an EXISTING course is not drafted (its data is already saved). Picking a searched course or "Enter manually" counts as starting fresh.
* **Tee Times:** creating a NEW tee time and leaving no longer loses it (type, title, date, tee-off times, course, spots, deadline, notes). "New Tee Time" shows a "Resume your tee time?" banner; draft clears on post. Editing an existing tee time is not drafted. The auto-fill-deadline effect is guarded so a resumed deadline isn't overwritten.
* Consistent with game setup: Cancel keeps the draft (resume later); use "Start fresh" to discard. Device-local only, keyed per group.
* Verified: tsc clean, all tests pass, build clean.

## v1.97.1 — Game guests are per-game only (no permanent guest list) — no migration

* Fixed a workflow mismatch: game guests were being written into the persistent group\_guests table and surfaced as a "past guests" quick-pick on new game setups. Game guests are temporary to a game, so:

  * Removed the group\_guests writes from both guest-add paths (create-flow and in-game). Game guests now live only as per-game game\_players rows.
  * Removed the "Add a past guest…" quick-pick from the create-game and in-game add-guest screens.
* Kept the per-game "playing with…" (sponsor) picker, which writes game\_players.guest\_of — this is what lets the randomizer keep a guest in their host's foursome. It's chosen per game (defaults to whoever's adding), so the same guest can be invited by a different member next time with no permanent tie.
* Tee-time handoff unchanged: guests assigned via RSVPs still flow into game setup (seed.guests -> guestPlayers, attributed to their sponsoring member).
* Money's own guest feature (group\_guests, for splitting expenses) is untouched — that remains the one place a guest is deliberately persisted, and betting settle-up was already member-only (posts by user\_id), so nothing there depended on the game-guest writes.
* Verified: tsc clean, all tests pass, build clean.

## v1.98.0 — Per-expense guest sponsor + retire-guest (Money)

* RUN migration 0063\_guest\_per\_expense\_sponsor.sql (full SQL below / in the file). Adds expense\_shares.sponsor\_user\_id (nullable), makes group\_guests.sponsor\_user\_id nullable, and adds group\_guests.archived (default false) + group\_guests.became\_member\_id (nullable). Idempotent; validated on a real Postgres.
* The member responsible for a guest is now chosen PER EXPENSE (stored on the share), not fixed on the guest. In Add Expense, each included guest shows a required "Sponsored by" picker that starts blank; Save is blocked until every guest has one. Creating a guest now asks for a NAME ONLY.
* Settle-up math (lib/money.ts resolveMember) uses the per-expense sponsor, falling back to the guest's old fixed sponsor for any pre-0063 shares — so existing balances do NOT move. Covered by new unit tests (per-expense split, legacy fallback, guestCoverageBySponsor).
* Balances "incl. <guests>" line now attributes each guest's portion to whoever sponsored it on each expense (a guest can roll to different members).
* Retire a guest: Balances screen → Guests section → Retire (optionally mark "now a member"). Retiring hides the guest from the add-a-guest picker on new expenses; past expenses are untouched and no balances move. Un-retire restores them. Guest inserts set archived=false explicitly.
* ci/assert-defaults.sql now also guards group\_guests.archived.
* Verified: tsc clean, tests pass (money 51 / legs 23 / grouping 281), build clean, migration idempotent on real Postgres.

### 0063\_guest\_per\_expense\_sponsor.sql

```sql
alter table public.expense\_shares
  add column if not exists sponsor\_user\_id uuid references auth.users(id) on delete set null;
alter table public.group\_guests
  alter column sponsor\_user\_id drop not null;
alter table public.group\_guests
  add column if not exists archived boolean not null default false;
alter table public.group\_guests
  add column if not exists became\_member\_id uuid references auth.users(id) on delete set null;
```

## v1.99.0 — Guests in a posted bet, booked to their sponsor (symmetric win/lose)

* RUN migration 0065\_bet\_guest\_payers.sql (full SQL below). Extends expense\_payers with guest\_id + sponsor\_user\_id, makes user\_id nullable, swaps the member-only unique constraint for a party-based unique index, and adds a one-party check — mirroring what 0063 did for expense\_shares. Idempotent; validated on real Postgres.
* Posting a bet that includes a guest no longer blocks. Each guest bettor is booked as their OWN line (win or lose), attributed to the member sponsoring them for that game (game\_players.guest\_of). Winning guests credit the sponsor (guest payer); losing guests are owed by the sponsor (guest share). Both roll into the sponsor's balance and settle through them.
* To carry a betting guest onto the ledger, the app finds-or-creates a lightweight Money guest record by name at post time (only because the bet posts to Money — consistent with "persist a guest only when money's involved"). That guest then appears in the Money guest list and can be retired. Re-posting the same bet reuses the record (dedup by name), so no duplicates.
* Settle-up engine (lib/money.ts): computeBalances + pairwiseDebts now resolve the PAYER side guest->sponsor (previously only shares); betResultToPost carries guest\_id + sponsor\_user\_id onto posted rows; guestCoverageBySponsor also covers payers so the Balances "incl. <guest>" line shows for wins and losses. New unit tests cover winning-guest crediting, betResultToPost guest passthrough, and coverage.
* Still blocked (by design): a guest with no sponsor assigned, or a real non-member account in the pot — clear message either way.
* Confirm card + expense detail show the guest's own line ("· guest of X"); Balances shows "incl. <guest>".
* Verified: tsc clean, tests pass (money 56 / legs 23 / grouping 281), build clean, migration idempotent on real Postgres; end-to-end scenario check (guest of P5, -$25) yields P5 +$95 incl. Sam and settle-up P2->P5 $75, P4->P5 $20, P4->P3 $25.

### 0065\_bet\_guest\_payers.sql

```sql
alter table public.expense\_payers
  add column if not exists guest\_id uuid references public.group\_guests(id) on delete cascade;
alter table public.expense\_payers
  add column if not exists sponsor\_user\_id uuid references auth.users(id) on delete set null;
alter table public.expense\_payers
  alter column user\_id drop not null;
alter table public.expense\_payers drop constraint if exists expense\_payers\_uk;
create unique index if not exists expense\_payers\_party\_uk
  on public.expense\_payers(expense\_id, coalesce(user\_id::text, ''), coalesce(guest\_id::text, ''));
alter table public.expense\_payers drop constraint if exists expense\_payers\_one\_party;
alter table public.expense\_payers
  add constraint expense\_payers\_one\_party check ((user\_id is not null) <> (guest\_id is not null));
```

## v1.99.1 — Bet-generated guests are per-game throwaways, separated from Money guests

* RUN migration 0066\_bet\_guest\_source\_game.sql (SQL below). Adds group\_guests.source\_game\_id (nullable, references games).
* A guest auto-created for a posted bet is now tagged with its game (source\_game\_id) and keyed per game: re-posting the same game reuses the record; the same name in a different game is a separate record (guest + game = sponsor + date context). Two different people named "Sam" in two games are simply two records — correctness is unaffected since the sponsor is always per-transaction.
* These bet-generated guests are hidden from the deliberate add-a-guest picker (Add Expense) and from the Retire list (Balances → Guests), so they never clutter the reusable Money-guest workflow. They still resolve by name on the expense detail and the "incl. <guest>" balance line.
* Deliberate Money guests (added in the Money tab) keep source\_game\_id null and are unchanged.
* Group-agnostic: all keyed off game.group\_id + game.id, so this ports to any group if betting opens beyond TGC.
* Verified: tsc clean, tests pass (money 56 / legs 23 / grouping 281), build clean, migration idempotent on real Postgres.

### 0066\_bet\_guest\_source\_game.sql

```sql
alter table public.group\_guests
  add column if not exists source\_game\_id uuid references public.games(id) on delete set null;
```

## v1.99.2 — Default 4-or-fewer-player games to a single tee group (no migration)

* At game creation, if the roster is 4 players or fewer, everyone is defaulted into Group 1 (they tee off together). The organizer can still split them manually in the Groups step. Bigger rosters continue to start ungrouped for assignment.
* Applies to all formats (a 2-player match, a 2v2 foursome, etc. all default to one group when the total is <=4).
* Forward-only (affects newly created games); no schema change.

## v1.99.3 — Betting payouts consistent: no payout until scores are in (no migration)

* Overall 1st/2nd now follows the same rule as the sixes: it stays "not all scores in — no payout yet" until every bettor has completed all 18 holes, instead of showing/assigning money to whoever was leading mid-round. The leaderboard remains the place to see who's currently ahead.
* Tightened the sixes to match their own wording too: a six settles only once EVERY bettor has all six of its holes in (previously it could settle as soon as one bettor finished the six). Sixes still pay progressively as each is completed.
* Clean sweep is gated on all 18 being in.
* No change to any FINAL posted result — posting already requires the game to be ended (all holes in), so settled amounts are identical; this only fixes the mid-round display/assignment. Applies to the payout panel and the WhatsApp/share export.
* Verified: tsc clean, tests pass (added a mid-round test: overall unpaid, a completed six still pays), build clean.

## v1.99.4 — Six-hole segment leader ranks by under-par pace (no migration)

* While a six is IN PROGRESS, the "leading"/"tied" player on the six-hole segment card is now whoever is most under par for the holes they've actually played — the same pace metric the main leaderboard uses (2·holes − points for Stableford; net vs par-of-holes-played for stroke). Previously it ranked by raw cumulative points, which disagreed with the leaderboard: a player 15 pts thru 6 (3 under) was shown ahead of one 12 pts thru 4 (4 under). Now the 4-under player leads, and the lead flip-flops correctly as holes come in.
* Display is unchanged in format: still shows raw points/net · thru the LEADER's own holes (e.g. "Bob · 12 pts · thru hole 4 · leading"), so the over/under is easy to read off.
* Once every bettor has all six holes in, everyone is on the same par pace, so this collapses to exactly who won the six — no change to completed sixes, and no change to any payout (payouts still settle only when all scores are in, per v1.99.3). Clean-sweep watch now tracks the pace leader of the last six.
* Verified: tsc clean, tests pass (computeBetting 29 / money 56 / legs 23 / grouping 281), build clean.

## v1.100.0 — Players keep their own stats in group scoring (score stays the scorer's)

* RUN migration 0067\_save\_hole\_stats.sql (full SQL below). Adds a save\_hole\_stats(p\_player, p\_putts, p\_fairways, p\_penalties, p\_sand) SECURITY DEFINER chokepoint: a signed-in player may update ONLY their OWN row's peripheral stats, and it never touches scores/clock. Mirrors the 0022 save\_hole\_scores ownership pattern. Idempotent; validated on real Postgres (owner writes stats with score intact; a non-owner is rejected).
* GROUP SCORING ONLY. Individual scoring is unchanged — you enter your own score and stats as before.
* In a group where someone else keeps score: open the group card and tap your OWN row on any hole. The gross score is greyed out ("kept by <marker>", view-only) and putts / fairway / sand / penalties are editable in the same hole pop-up the marker uses. The marker still owns the number; the scorer MAY also enter stats.
* Conflict rule: LAST-WRITE-WINS per stat column. The scorer overrides simply by entering a stat (their save becomes the latest). Peripheral stats do not affect the gross/net/Stableford score, so the number is never at risk.
* Sync safety: every writer now pushes ONLY the columns it changed vs the confirmed-synced watermark (new lib/sync-cols.ts, unit-tested), so the marker's background flush never clobbers a stat it didn't touch and a non-marker's device never writes a score it doesn't own (a hard mask drops `scores`, and stats route through the chokepoint). Watermark advances per written column. No change to the reconcile/merge model.
* NOTE: multi-device realtime behavior can't be integration-tested in CI — smoke-test on two phones (marker + player) before relying on it: marker enters scores, player taps own row and edits putts, confirm both land and neither clobbers the other; then toggle offline/online and confirm it reconciles.
* Verified: tsc clean, tests pass (game-shape 85 / computeBetting 29 / money 56 / legs 23 / grouping 281 / sync-cols 6), build clean, migration idempotent on real Postgres.

### 0067\_save\_hole\_stats.sql

```sql
create or replace function public.save\_hole\_stats(
  p\_player    uuid,
  p\_putts     jsonb default null,
  p\_fairways  jsonb default null,
  p\_penalties jsonb default null,
  p\_sand      jsonb default null
) returns void language plpgsql security definer set search\_path = public as $$
declare uid uuid := auth.uid(); owner uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select user\_id into owner from public.game\_players where id = p\_player;
  if owner is null then raise exception 'no such player, or that row has no owner to keep its own stats'; end if;
  if owner <> uid then raise exception 'you can only edit your own stats'; end if;
  update public.game\_players set
      putts     = coalesce(p\_putts,     putts),
      fairways  = coalesce(p\_fairways,  fairways),
      penalties = coalesce(p\_penalties, penalties),
      sand      = coalesce(p\_sand,      sand)
   where id = p\_player;
end $$;
```

## v1.100.1 — The group scorer sees their own card in Results (no migration)

* Previously the individual "Enter your scores" card in the Results tab was hidden whenever ANY marker existed — including when the marker was YOU. So the group scorer couldn't see their own card mid-round (only after the game ended).
* Now it's hidden only when someone ELSE keeps your score (a non-marker mid-game, who uses the group card's per-row stats pop-up instead). The group scorer and self-scorers see their own card in Results as expected. The "someone is keeping score" notice likewise no longer shows to the scorer themselves.
* Gate changed from "a marker exists" to markerOwnsMyRow (a marker other than me). No schema/logic change beyond the visibility gate; the scorer owns their own row, so editing it here is the same single-writer path as the group card.
* Verified: tsc clean, tests pass, build clean.

## v1.101.0 — Everyone sees their own card in group scoring + a join-and-RSVP link for new players (no migration)

### Own card for everyone in group mode

* In group scoring, the Results tab now shows EVERY player their own individual card — not just the scorer. For a player whose score is kept by someone else, the gross score is view-only (🔒 "kept by X") while putts / fairway / sand / penalties stay editable, saving instantly through the save\_hole\_stats chokepoint (0067). The group scorer and self-scorers get a fully-editable card as before.
* Replaces the old "your card is hidden — tap the group card" redirect. (The group card's per-row stats pop-up from v1.100.0 still works too; this just makes the individual card the natural place.) Header reads YOUR CARD (locked) / ENTER YOUR SCORES / YOUR FINAL SCORES appropriately. HoleScoreModal + ScoreEntryCard gained a scoreLocked mode.

### Join-and-RSVP link for brand-new players

* Tee-time detail (admins only) gains "Copy sign-up link (new players)". It mints a multi-use group invite code (create\_group\_invite\_multi, 14-day, unlimited uses) and builds `/join/<code>?tt=<teeTimeId>`.
* A brand-new person who taps it: Continue with Google (creates their account) → the group invite is redeemed (joins the group) → they land straight on the tee time to RSVP. An existing member who taps it skips the join (no-op) and just opens the tee time. The /join page now carries ?tt through the OAuth round-trip and forwards to it on success.
* Security model unchanged: minting a join link is admin-only (same as the group invite link); the code just also points at a tee time. The regular "Copy for WhatsApp" (members) link is untouched.
* Verified: tsc clean, tests pass (game-shape/golf/money/legs/grouping/sync-cols), build clean. No migration (reuses existing create\_group\_invite\_multi + redeem RPCs and the save\_hole\_stats chokepoint from 0067).

## v1.102.0 — Analytics accuracy + test mode + incomplete-round nudge + profile nudge + name caps

* RUN migration 0068\_analytics\_v2.sql (full SQL below). Adds daily\_active.opens (raw open counter) and profiles.is\_test; rewrites mark\_active (counts opens), adds admin\_set\_test(user,bool), and rewrites get\_admin\_analytics.
* ROUNDS now count COMPLETED only (status='final') and NEVER deleted (deleted\_at is null). Started-but-not-finished rounds are tracked separately (rounds\_started); a partial round is legitimate once marked complete (9/15 holes fine). The Rounds tile shows done + "N started".
* INCOMPLETE-ROUND NUDGE (home): when you have an unfinished round, a banner offers Finish scoring / Mark complete (sets status='final' so it counts) / Delete (soft-delete). "Mark complete" stores gross = sum of entered strokes.
* ABANDONED % now spans BOTH games and rounds (stale >3d, non-deleted): abandoned = (stale active games with no round) + (stale started rounds) over (games + rounds).
* OPENS: Today / This week / This month each show UNIQUE users (big) + TOTAL views (small). Stickiness stays on unique (DAU/MAU). Labels now say "· unique" and a footnote clarifies unique vs views.
* TEST MODE: profiles.is\_test excludes an account from EVERY metric while leaving it fully functional. Toggle in Profile (admin only) via admin\_set\_test. Use it for feature testing so stats stay clean.
* NEW STATS (all excluding test accounts): rounds/active-user, churn (lapsed 30–60d), round-completion %, and an Engagement section (tee times created, RSVPs, bets posted all-time/30d, money settled, invite links created, joins via invite, % of games using a group scorer).
* WEEKLY PROFILE NUDGE (home): if a profile is missing a photo or handicap index, a dismissible banner (re-appears after 7 days) links to the Profile tab.
* NAME CAPITALISATION: profile names are title-cased on save (home NameGate + Profile panel) — "amit sud" -> "Amit Sud", preserving O'Brien / McDonald.
* Deferred (needs new client instrumentation; no push feature exists yet): PWA-install rate and notification opt-in stats.
* Verified: tsc clean, tests pass (game-shape/golf/money/legs/grouping/sync-cols), build clean; get\_admin\_analytics validated on real Postgres (unique vs total opens, completed-only + deleted-excluded rounds, test-user exclusion, abandoned incl. games+rounds). Idempotent.

### 0068\_analytics\_v2.sql

```sql
-- 0068\_analytics\_v2.sql
-- Analytics accuracy pass:
--   \* daily\_active.opens — raw open counter so we can show TOTAL views alongside UNIQUE users.
--   \* profiles.is\_test — test/QA accounts are fully functional but excluded from every metric
--     (so feature testing doesn't pollute stats). Admin-set via admin\_set\_test().
--   \* get\_admin\_analytics rewritten: Rounds count COMPLETED rounds only (status='final'),
--     never deleted (deleted\_at is null); a separate started/abandoned figure is exposed.
--     Abandoned% now spans BOTH games and rounds. Total + unique opens for today/7d/30d.
--     Test users excluded throughout. Plus new engagement stats.

alter table public.daily\_active add column if not exists opens int not null default 1;
alter table public.profiles     add column if not exists is\_test boolean not null default false;

-- Ping on app open now also counts the open (for total views).
create or replace function public.mark\_active()
returns void language plpgsql security definer set search\_path = public as $function$
begin
  if auth.uid() is null then return; end if;
  insert into daily\_active(user\_id, day, opens) values (auth.uid(), current\_date, 1)
  on conflict (user\_id, day) do update set opens = daily\_active.opens + 1;
end;
$function$;
grant execute on function public.mark\_active() to authenticated;

-- Admin: flag/unflag a user as a test account (excluded from analytics).
create or replace function public.admin\_set\_test(p\_user uuid, p\_is\_test boolean)
returns void language plpgsql security definer set search\_path = public as $function$
begin
  if not public.is\_admin() then raise exception 'admins only'; end if;
  update public.profiles set is\_test = coalesce(p\_is\_test, false) where id = p\_user;
end;
$function$;
grant execute on function public.admin\_set\_test(uuid, boolean) to authenticated;

create or replace function public.get\_admin\_analytics()
returns jsonb language plpgsql security definer set search\_path = public as $function$
declare
  j jsonb;
  v\_dau int; v\_wau int; v\_mau int; v\_a7 numeric; v\_a30 numeric;
  v\_views\_today int; v\_views\_7d int; v\_views\_30d int;
  v\_created int; v\_ended int;
  v\_rdone int; v\_rstarted int; v\_rdone30 int;
  v\_churn int;
  v\_games\_total int; v\_rounds\_total int; v\_abandoned int;
begin
  if not public.is\_admin() then raise exception 'admins only'; end if;

  -- Active users (UNIQUE) + opens (TOTAL), test accounts excluded.
  select count(distinct da.user\_id) filter (where da.day = current\_date),
         count(distinct da.user\_id) filter (where da.day > current\_date - 7),
         count(distinct da.user\_id) filter (where da.day > current\_date - 30),
         coalesce(sum(da.opens) filter (where da.day = current\_date), 0),
         coalesce(sum(da.opens) filter (where da.day > current\_date - 7), 0),
         coalesce(sum(da.opens) filter (where da.day > current\_date - 30), 0)
    into v\_dau, v\_wau, v\_mau, v\_views\_today, v\_views\_7d, v\_views\_30d
  from daily\_active da join profiles p on p.id = da.user\_id
  where coalesce(p.is\_test, false) = false;

  select coalesce(count(\*)::numeric,0) / 7  into v\_a7
    from daily\_active da join profiles p on p.id = da.user\_id
    where da.day > current\_date - 7 and coalesce(p.is\_test,false) = false;
  select coalesce(count(\*)::numeric,0) / 30 into v\_a30
    from daily\_active da join profiles p on p.id = da.user\_id
    where da.day > current\_date - 30 and coalesce(p.is\_test,false) = false;

  -- Churn: active 30–60 days ago but NOT in the last 30 days.
  select count(\*) into v\_churn from (
    select da.user\_id
    from daily\_active da join profiles p on p.id = da.user\_id
    where coalesce(p.is\_test,false) = false
    group by da.user\_id
    having max(da.day) between current\_date - 60 and current\_date - 31
  ) t;

  -- Games (test creators excluded).
  select count(\*), count(\*) filter (where g.status = 'ended')
    into v\_created, v\_ended
  from games g left join profiles p on p.id = g.created\_by
  where coalesce(p.is\_test,false) = false;

  -- Rounds: completed only, never deleted; started (non-deleted, not final) tracked apart.
  select count(\*) filter (where r.status = 'final'),
         count(\*) filter (where r.status <> 'final'),
         count(\*) filter (where r.status = 'final' and r.created\_at > now() - interval '30 days')
    into v\_rdone, v\_rstarted, v\_rdone30
  from rounds r join profiles p on p.id = r.user\_id
  where r.deleted\_at is null and coalesce(p.is\_test,false) = false;

  -- Abandoned spans games AND rounds: stale (>3d) games with no round + stale started rounds.
  v\_games\_total := v\_created;
  v\_rounds\_total := v\_rdone + v\_rstarted;
  v\_abandoned :=
      (select count(\*) from games g left join profiles p on p.id = g.created\_by
        where coalesce(p.is\_test,false)=false and g.status='active'
          and g.created\_at < now() - interval '3 days'
          and not exists (select 1 from rounds r where r.game\_id = g.id and r.deleted\_at is null))
    + (select count(\*) from rounds r join profiles p on p.id = r.user\_id
        where coalesce(p.is\_test,false)=false and r.deleted\_at is null
          and r.status <> 'final' and r.created\_at < now() - interval '3 days');

  j := jsonb\_build\_object(
    'totals', jsonb\_build\_object(
      'users',         (select count(\*) from profiles where coalesce(deactivated,false)=false and coalesce(is\_test,false)=false),
      'users\_new\_30d', (select count(\*) from profiles where created\_at > now() - interval '30 days' and coalesce(is\_test,false)=false),
      'active\_groups', (select count(distinct g.group\_id) from games g left join profiles p on p.id=g.created\_by where g.created\_at > now() - interval '30 days' and g.group\_id is not null and coalesce(p.is\_test,false)=false),
      'games',         v\_created,
      'games\_30d',     (select count(\*) from games g left join profiles p on p.id=g.created\_by where g.created\_at > now() - interval '30 days' and coalesce(p.is\_test,false)=false),
      'rounds',        v\_rdone,          -- completed only, excludes deleted
      'rounds\_30d',    v\_rdone30,
      'rounds\_started', v\_rstarted,      -- started but not completed (non-deleted)
      'rounds\_per\_active\_user', case when v\_mau > 0 then round(v\_rdone30::numeric / v\_mau, 1) else 0 end
    ),
    'active', jsonb\_build\_object(
      'dau', v\_dau, 'wau', v\_wau, 'mau', v\_mau,
      'views\_today', v\_views\_today, 'views\_7d', v\_views\_7d, 'views\_30d', v\_views\_30d,
      'avg7',  round(coalesce(v\_a7, 0), 1),
      'avg30', round(coalesce(v\_a30, 0), 1),
      'stickiness\_pct', case when v\_mau > 0 then round(100.0 \* v\_dau / v\_mau) else 0 end,
      'churn\_30d', v\_churn,
      'series', coalesce((
        select jsonb\_agg(jsonb\_build\_object('day', d::text, 'n', coalesce(c.n, 0)) order by d)
        from generate\_series(current\_date - 29, current\_date, interval '1 day') g(d)
        left join (
          select da.day, count(distinct da.user\_id) n from daily\_active da
          join profiles p on p.id = da.user\_id where coalesce(p.is\_test,false)=false
          group by da.day
        ) c on c.day = g.d::date
      ), '\[]'::jsonb)
    ),
    'formats', (
      select coalesce(jsonb\_object\_agg(game\_type, n), '{}'::jsonb)
      from (select g.game\_type, count(\*) n from games g left join profiles p on p.id=g.created\_by
            where coalesce(p.is\_test,false)=false group by g.game\_type) t
    ),
    'engagement', jsonb\_build\_object(
      'tee\_times\_30d',    (select count(\*) from tee\_times where created\_at > now() - interval '30 days'),
      'tee\_rsvps\_30d',    (select count(\*) from tee\_time\_rsvps rr join tee\_times tt on tt.id=rr.tee\_time\_id where tt.created\_at > now() - interval '30 days'),
      'bets\_posted',      (select count(\*) from expenses where source\_kind = 'tgc\_bet'),
      'bets\_30d',         (select count(\*) from expenses where source\_kind = 'tgc\_bet' and created\_at > now() - interval '30 days'),
      'settled\_cents',    (select coalesce(sum(amount\_cents),0) from settlements),
      'invites\_created\_30d', (select count(\*) from group\_invites where created\_at > now() - interval '30 days'),
      'joins\_via\_invite',    (select coalesce(sum(use\_count),0) from group\_invites),
      'group\_scoring\_pct', case when v\_created > 0 then round(100.0 \* (
          select count(\*) from games g left join profiles p on p.id=g.created\_by
          where coalesce(p.is\_test,false)=false
            and (g.marker\_user\_id is not null or exists (select 1 from game\_players gp where gp.game\_id=g.id and gp.is\_marker))
        ) / v\_created) else 0 end
    ),
    'features', jsonb\_build\_object(
      'avatars\_set',      (select count(\*) from profiles where avatar\_url is not null and coalesce(is\_test,false)=false),
      'ai\_summaries',     (select count(\*) from profiles where dashboard\_ai is not null and coalesce(is\_test,false)=false),
      'live\_shared',      (select count(\*) from games where share\_token is not null),
      'courses\_added\_30d',(select count(\*) from favorite\_courses where created\_at > now() - interval '30 days' and coalesce(deleted,false)=false)
    ),
    'health', jsonb\_build\_object(
      'completion\_pct', case when v\_created > 0 then round(100.0 \* v\_ended / v\_created) else 0 end,
      'round\_completion\_pct', case when (v\_rdone + v\_rstarted) > 0 then round(100.0 \* v\_rdone / (v\_rdone + v\_rstarted)) else 0 end,
      'abandoned\_pct', case when (v\_games\_total + v\_rounds\_total) > 0 then round(100.0 \* v\_abandoned / (v\_games\_total + v\_rounds\_total)) else 0 end,
      'avg\_holes', coalesce((
        select round(avg(c), 1) from (
          select (select count(\*) from jsonb\_array\_elements(gp.scores) e where e <> 'null'::jsonb) c
          from game\_players gp where jsonb\_typeof(gp.scores) = 'array'
        ) t where c > 0
      ), 0),
      'never\_joined\_group\_pct', case when (select count(\*) from profiles where coalesce(is\_test,false)=false) > 0 then round(100.0 \* (
          select count(\*) from profiles p where coalesce(p.is\_test,false)=false
            and not exists (select 1 from group\_members m where m.user\_id = p.id and m.status = 'active')
        ) / (select count(\*) from profiles where coalesce(is\_test,false)=false)) else 0 end,
      'activated\_7d\_pct', coalesce((
        select round(100.0 \* count(\*) filter (where exists (
                 select 1 from rounds r where r.user\_id = p.id and r.deleted\_at is null
                   and r.status='final' and r.created\_at <= p.created\_at + interval '7 days'
               )) / nullif(count(\*), 0))
        from profiles p where p.created\_at > now() - interval '90 days' and coalesce(p.is\_test,false)=false
      ), 0),
      'retention\_w1\_pct', coalesce((
        select round(100.0 \* count(\*) filter (where exists (
                 select 1 from daily\_active d2 where d2.user\_id = f.user\_id
                   and d2.day between f.first\_day + 1 and f.first\_day + 7)) / nullif(count(\*), 0))
        from (select da.user\_id, min(da.day) first\_day from daily\_active da join profiles p on p.id=da.user\_id where coalesce(p.is\_test,false)=false group by da.user\_id) f
        where f.first\_day between current\_date - 37 and current\_date - 7
      ), 0),
      'retention\_w4\_pct', coalesce((
        select round(100.0 \* count(\*) filter (where exists (
                 select 1 from daily\_active d2 where d2.user\_id = f.user\_id
                   and d2.day between f.first\_day + 22 and f.first\_day + 28)) / nullif(count(\*), 0))
        from (select da.user\_id, min(da.day) first\_day from daily\_active da join profiles p on p.id=da.user\_id where coalesce(p.is\_test,false)=false group by da.user\_id) f
        where f.first\_day between current\_date - 58 and current\_date - 28
      ), 0)
    )
  );
  return j;
end;
$function$;
grant execute on function public.get\_admin\_analytics() to authenticated;
```

## v1.103.0 — Admin per-user test-account toggle (no migration)

* The admin Users list now has a per-user "Test account" toggle (expand a user's row -> ANALYTICS section). It calls the existing admin\_set\_test RPC (from 0068), so an admin can flag ANY account as test, not just their own. A test account is excluded from every analytics figure but works normally.
* Intended workflow: flag a SECOND account you control (your own second Google login, or a burner) as test, sign in as it on another device/incognito, and use it to see what a regular member sees in response to your admin actions — without polluting analytics. NOTE: this is not impersonation; you must actually sign in as that account. Acting-as-another-member from your own session is a separate, security-sensitive feature not included here.
* No migration (reuses profiles.is\_test + admin\_set\_test from 0068). Verified: tsc clean, tests pass, build clean.

## v1.104.0 — Push notifications, phase 1: subscription plumbing (RUN migration 0069)

This phase gets a device REGISTERED for push and lets the service worker DISPLAY a push. It does NOT send pushes yet — the Vercel sender + Supabase webhook + event wiring come in phase 2. So after this deploy, the Notifications toggle should subscribe a device without error (a row appears in push\_subscriptions), but nothing will actually buzz until phase 2.

SETUP (one-time):

1. RUN migration 0069 (full SQL below).
2. In Vercel → Project → Settings → Environment Variables, add (Production + Preview):

   * NEXT\_PUBLIC\_VAPID\_PUBLIC\_KEY = BPosOVuEyjpY3zfcnhq\_LP\_\_z1IEs2\_sgNPg9JNYG38\_n54R5wpGgRx4cyq-lr5w9\_UIdMC0Fn2bIocDJj9H0fc
   * VAPID\_PRIVATE\_KEY = <the private key from the chat message — DO NOT commit it to the repo>   (server-only; used by the phase-2 sender)
The public key is also embedded in public/sw.js for re-subscribe; keep the two in sync if you ever rotate keys.
3. Redeploy so the env vars are picked up.

WHAT SHIPPED:

* push\_subscriptions table (one row per device endpoint) with RLS (users manage only their own; the phase-2 sender reads via the service role). profiles.push\_prefs jsonb for per-type prefs (absent key = on; used in phase 2). notifications gains type + link so a push can deep-link; create\_notification extended with optional p\_type/p\_link (existing 2/3-arg calls unaffected — validated).
* Service worker: push / notificationclick / pushsubscriptionchange handlers (cache/offline logic untouched). Clicking a notification focuses an open tab and routes it, or opens a new one at the deep link.
* Profile → Notifications: capability-based opt-in. iPhone-not-installed shows explicit "Add to Home Screen from Safari" steps (and warns that a Chrome-added icon won't push); Android/desktop/installed-iOS get a Turn-on button that requests permission, subscribes, and stores the subscription.
* Verified: tsc clean, tests pass, build clean; 0069 idempotent on real Postgres.

TEST (phase 1): On Android/desktop Chrome, Profile → Notifications → Turn on → allow → confirm a row appears in push\_subscriptions. On iPhone: install via Safari (Share → Add to Home Screen), open from the icon, then Turn on. (No push is sent yet — that's phase 2.)

### 0069\_push\_subscriptions.sql

```sql
-- 0069\_push\_subscriptions.sql
-- Web Push plumbing (phase 1): store each device's push subscription, add per-type push
-- preferences, and give notifications a type + deep-link so a push can open the right
-- screen. The sender (Vercel route) + webhook come in phase 2; nothing here sends a push.

-- One row per browser/device push endpoint. A user may have several (phone, desktop…).
create table if not exists public.push\_subscriptions (
  id          uuid primary key default gen\_random\_uuid(),
  user\_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  platform    text,
  user\_agent  text,
  disabled    boolean not null default false,  -- flipped true by the sender after repeated failures
  fail\_count  int not null default 0,
  created\_at  timestamptz not null default now(),
  last\_seen   timestamptz not null default now()
);
create index if not exists push\_subscriptions\_user\_idx on public.push\_subscriptions(user\_id) where disabled = false;

alter table public.push\_subscriptions enable row level security;
-- Users manage ONLY their own subscriptions. The sender reads via the service role,
-- which bypasses RLS, so no broad read policy is needed here.
drop policy if exists push\_sub\_select on public.push\_subscriptions;
drop policy if exists push\_sub\_insert on public.push\_subscriptions;
drop policy if exists push\_sub\_update on public.push\_subscriptions;
drop policy if exists push\_sub\_delete on public.push\_subscriptions;
create policy push\_sub\_select on public.push\_subscriptions for select using (user\_id = auth.uid());
create policy push\_sub\_insert on public.push\_subscriptions for insert with check (user\_id = auth.uid());
create policy push\_sub\_update on public.push\_subscriptions for update using (user\_id = auth.uid()) with check (user\_id = auth.uid());
create policy push\_sub\_delete on public.push\_subscriptions for delete using (user\_id = auth.uid());

-- Per-type push preferences (absent key = ON). A "\_master" key of false mutes everything.
alter table public.profiles add column if not exists push\_prefs jsonb not null default '{}'::jsonb;

-- Let a notification carry a type + deep link so the push (and the in-app bell) can route.
alter table public.notifications add column if not exists type text;
alter table public.notifications add column if not exists link text;

-- Extend create\_notification with optional type + link, preserving existing 2/3-arg calls.
-- Drop the old signatures first so there's a single unambiguous overload.
drop function if exists public.create\_notification(uuid, text);
drop function if exists public.create\_notification(uuid, text, uuid);
create or replace function public.create\_notification(
  p\_recipient uuid,
  p\_message   text,
  p\_group\_id  uuid default null,
  p\_type      text default null,
  p\_link      text default null
)
returns void
language plpgsql
security definer
set search\_path = public
as $function$
declare
  v\_sender uuid := auth.uid();
begin
  if v\_sender is null then
    raise exception 'not authenticated';
  end if;
  if p\_recipient is null or p\_message is null then
    raise exception 'recipient and message are required';
  end if;

  if not (
    p\_recipient = v\_sender
    or is\_admin()
    or exists (select 1 from profiles p where p.id = p\_recipient and p.is\_admin = true)
    or exists (
      select 1 from games g
      join game\_players gp on gp.game\_id = g.id
      where g.created\_by = v\_sender and gp.user\_id = p\_recipient
    )
    or exists (
      select 1 from group\_members ga
      join group\_members gm on gm.group\_id = ga.group\_id
      where ga.user\_id = v\_sender and ga.role = 'admin' and ga.status = 'active'
        and gm.user\_id = p\_recipient and gm.status = 'active'
    )
  ) then
    raise exception 'not allowed to notify this user';
  end if;

  insert into notifications (user\_id, message, group\_id, type, link)
  values (p\_recipient, p\_message, p\_group\_id, p\_type, p\_link);
end;
$function$;
grant execute on function public.create\_notification(uuid, text, uuid, text, text) to authenticated;
```

## v1.105.0 — Push notifications, phase 2: sender + webhook + event triggers + prefs (RUN migration 0070)

Now notifications actually PUSH. A Supabase webhook on `notifications` INSERT calls a Vercel route that pushes to the recipient's devices IF their preference for that type is "push". Three events are wired: added to a game, you owe money, you got paid.

SETUP (one-time, after Phase 1's VAPID vars are already set):

1. RUN migration 0070 (full SQL below) — event triggers that create the notification rows.
2. Add TWO more Vercel env vars (Production + Preview; mark sensitive; untick Development for the sensitive ones):

   * SUPABASE\_SERVICE\_ROLE\_KEY = <Supabase dashboard → Project Settings → API → service\_role secret>
   * PUSH\_WEBHOOK\_SECRET = <the secret from the chat message>
Redeploy after adding.
3. Create the Supabase Database Webhook (Supabase dashboard → Database → Webhooks → Create):

   * Table: public.notifications
   * Events: Insert
   * Type: HTTP Request; Method: POST
   * URL: https://birdienumnum.vercel.app/api/push
   * HTTP Headers: add  x-webhook-secret : <same PUSH\_WEBHOOK\_SECRET value>
Save.

WHAT SHIPPED:

* app/api/push/route.ts (Node runtime): verifies the x-webhook-secret header, reads the recipient's push\_prefs + push\_subscriptions via the service role, and web-pushes only if that type resolves to "push". Dead subscriptions (404/410) are deleted; repeated failures disable a subscription. Added web-push dependency.
* Migration 0070: SECURITY DEFINER triggers create notification rows for game\_added (game\_players insert; organizer not self-notified; guests skipped), money\_owed (expense\_shares insert; payer skipped; de-duped to one per user+group per 6h so bet re-posts don't spam), money\_paid (settlements insert → payee).
* Profile → Notifications: a per-type menu (Push / In-app / Off) writing to profiles.push\_prefs. Defaults: game\_added/money\_owed/money\_paid = Push; the rest In-app. Types beyond the three wired ones are shown as "· soon".
* Notification deep links now open the right tab: /?tab=money, /?tab=games (home.tsx handles ?tab=).
* Delivery resolution (route + client) share the same DEFAULT\_DELIVERY map; "in-app only" and "off" simply don't push (the bell still shows the row for non-off types).
* Verified: tsc clean, tests pass, build clean; 0070 idempotent + logic validated on real Postgres (creator/payer skipped, repost de-duped, payee notified).

TEST (end-to-end, needs the webhook + env vars live): On a device with notifications turned on, have someone add you to a game / post a bet you owe on / settle up with you, and confirm the phone notification arrives and tapping it opens the right tab. In-app-only types show only in the bell. iPhone must be installed via Safari with notifications on.

### 0070\_push\_events.sql

```sql
-- 0070\_push\_events.sql
-- Create notification rows for the key events, so the phase-2 webhook can push them.
-- These run as triggers (SECURITY DEFINER, owner privileges) so they insert regardless
-- of who performed the action and without the create\_notification relationship checks.
-- The webhook + each user's per-type preference decide whether a row is actually pushed.

-- 1) Added to a game — fires once per player row at game creation / when added later.
create or replace function public.notify\_game\_added() returns trigger
language plpgsql security definer set search\_path = public as $fn$
declare creator uuid; grp uuid;
begin
  if new.user\_id is null then return new; end if;                -- guests have no account
  select created\_by, group\_id into creator, grp from games where id = new.game\_id;
  if creator is not null and new.user\_id = creator then return new; end if;  -- don't ping the organizer about themselves
  insert into notifications (user\_id, message, group\_id, type, link)
  values (new.user\_id, 'You''ve been added to a new game.', grp, 'game\_added', '/?tab=games');
  return new;
end $fn$;
drop trigger if exists trg\_notify\_game\_added on public.game\_players;
create trigger trg\_notify\_game\_added after insert on public.game\_players
  for each row execute function public.notify\_game\_added();

-- 2) You owe money — fires when an expense share lands against a real user who isn't the
--    payer. De-duped to at most one per user+group per 6h so bet re-posts don't spam.
create or replace function public.notify\_money\_owed() returns trigger
language plpgsql security definer set search\_path = public as $fn$
declare payer uuid; grp uuid;
begin
  if new.user\_id is null then return new; end if;               -- guest share
  if new.share\_cents <= 0 then return new; end if;
  select payer\_user\_id, group\_id into payer, grp from expenses where id = new.expense\_id;
  if payer is not null and new.user\_id = payer then return new; end if;   -- the payer isn't owing themselves
  if exists (
    select 1 from notifications n
    where n.user\_id = new.user\_id and n.type = 'money\_owed'
      and n.group\_id is not distinct from grp
      and n.created\_at > now() - interval '6 hours'
  ) then return new; end if;                                     -- already told them recently
  insert into notifications (user\_id, message, group\_id, type, link)
  values (new.user\_id,
          'New charge: you owe $' || to\_char(new.share\_cents / 100.0, 'FM999990.00') || '. Tap to open Money.',
          grp, 'money\_owed', '/?tab=money');
  return new;
end $fn$;
drop trigger if exists trg\_notify\_money\_owed on public.expense\_shares;
create trigger trg\_notify\_money\_owed after insert on public.expense\_shares
  for each row execute function public.notify\_money\_owed();

-- 3) You got paid — fires when a settlement is recorded; notifies the payee.
create or replace function public.notify\_money\_paid() returns trigger
language plpgsql security definer set search\_path = public as $fn$
begin
  if new.to\_user\_id is null then return new; end if;
  insert into notifications (user\_id, message, group\_id, type, link)
  values (new.to\_user\_id,
          'You''ve been paid $' || to\_char(new.amount\_cents / 100.0, 'FM999990.00') || '.',
          new.group\_id, 'money\_paid', '/?tab=money');
  return new;
end $fn$;
drop trigger if exists trg\_notify\_money\_paid on public.settlements;
create trigger trg\_notify\_money\_paid after insert on public.settlements
  for each row execute function public.notify\_money\_paid();
```

## v1.106.0 — Every member can reach the Groups (Club) tab (no migration)

* The Groups tab was hidden for a non-admin member who belonged to a single group, so they had no way to switch groups or reach the "Request a new group" form. It's now visible to everyone (showGroupsTab = true). The request form and the active-group switcher already rendered for all members inside that tab and weren't admin-gated; only the tab's visibility was blocking them. Creation remains request-and-approve for now.
* No migration. Verified: tsc clean, tests pass, build clean.
* (Terminology rename Group -> Club is planned as a separate pass pending the final name.)

## v1.107.0 — Rename "Group" -> "Club" across the UI (no migration)

The top-level community concept is now called a **Club** everywhere users see it. Roles stay **members** and **admins**.

* Renamed ONLY user-facing text (tab label "Clubs", the Clubs panel, request-a-club, active-club switcher, invites, club course library, admin club requests/oversight, Users list, money ledger copy, join-link page, help/FAQ, activity-log summaries, notification labels). The header selector, empty states, and confirm dialogs now say Club.
* Deliberately LEFT the in-game "Group" concept unchanged: tee groups, group scoring, group scorecard, group scorer, "keep score for this group", playing groups, the game-setup Groups tab. Those are a different thing and still read "Group".
* Database and code internals are UNCHANGED — tables (groups, group\_members, group\_invites, group\_guests), columns (group\_id), functions (create\_group\_invite\_multi, is\_group\_admin, join\_default\_group), tab keys ("groups"), deep-link ?tab=groups, action enums (group\_requested/approved), and props (isGroupAdmin) all still use "group". This keeps the rename zero-risk; users never see those names.
* NO migration. Verified: tsc clean, tests pass, build clean. Creation is still request-and-approve (v1.106.0 made the Clubs tab visible to everyone so any member can request one).

## v1.108.0 — Show names not emails in member-facing lists + one-time name title-case backfill (RUN migration 0071)

* Club member list (Clubs tab): now ordered alphabetically by name; the redundant email line under each name is gone. Names show for everyone who has one (which is everyone who's signed in — the app gates all use behind the name screen). Email only appears as the identifier for a PENDING invite (someone added by email who hasn't signed in yet). Remove-confirm now uses the name.
* Players · Current Club tab: the email on the right is now shown ONLY when a player has no name yet (pending invite); named members without a phone show nothing there instead of their email.
* Admin Users panel: unchanged — still shows email, since it's your account-management view and abandoned signups may have no name.
* Migration 0071 (data backfill, full SQL below): title-cases existing profile names to match the app's on-save titleCaseName exactly — capitalises the first letter of each word (after start / space / apostrophe / hyphen) only when lowercase; leaves ALL-CAPS and intentional mid-caps like McDonald/DeVito untouched. Verified char-for-char against the JS function on real Postgres. Safe to re-run.
* Verified: tsc clean, tests pass, build clean.

### 0071\_title\_case\_names.sql

```sql
-- 0071\_title\_case\_names.sql
-- One-time backfill: title-case existing profile names the same way the app now does
-- on save (lib/golf.ts titleCaseName). It uppercases the first letter of each word
-- (start of string, or after a space, apostrophe, or hyphen) ONLY when that letter is
-- lowercase. It deliberately does NOT lowercase anything, so intentional mid-word caps
-- (McDonald, DeVito) and ALL-CAPS names are left untouched — exactly matching the app.
-- Safe to re-run: rows already correct are skipped.
create or replace function public.bnn\_title\_case(s text) returns text
language plpgsql immutable as $fn$
declare result text := ''; i int; ch text; prev text := '';
begin
  if s is null then return null; end if;
  for i in 1..length(s) loop
    ch := substr(s, i, 1);
    if (i = 1 or prev \~ '\[\\s''\\-]') and ch \~ '\[a-z]' then
      result := result || upper(ch);
    else
      result := result || ch;
    end if;
    prev := ch;
  end loop;
  return result;
end $fn$;

update public.profiles
set display\_name = public.bnn\_title\_case(display\_name)
where display\_name is not null
  and display\_name <> public.bnn\_title\_case(display\_name);

drop function public.bnn\_title\_case(text);
```

## v1.108.1 — Members can read their club-mates' names/avatars (RLS fix, RUN migration 0072)

* Root cause: the profiles SELECT policy was `id = auth.uid() OR is\_admin()`, so a non-admin member could read only their own profile row. Everywhere the app reads other members' profiles (Club member list, Players tab, Money tab + payment handles, game-setup roster, tee-group shuffle, notify-admins-on-request), RLS silently returned nothing for co-members, so they showed as emails + letter avatars. App admins never saw it (is\_admin() reads all). Names were always in the DB.
* Fix (migration 0072, full SQL below): a SECURITY DEFINER helper `shares\_active\_club(other)` checks whether the caller shares an ACTIVE club (group) with a given user, and the profiles SELECT policy is widened to `id = auth.uid() OR is\_admin() OR shares\_active\_club(id)`. The helper is SECURITY DEFINER so the policy's subquery isn't itself filtered by group\_members RLS (avoids recursive-RLS).
* No app code changes — this fixes all six read sites at once. Tradeoff accepted: co-members can read each other's row (incl. email) at the API level; the UI still shows names, not emails.
* Validated on real Postgres with RLS enforced under a non-owner role: pre-fix a member saw only themselves; post-fix a member sees self + co-members only (not strangers), a stranger sees only their own club, an app admin sees all; idempotent on re-run.

### 0072\_profiles\_readable\_by\_comembers.sql

```sql
-- 0072\_profiles\_readable\_by\_comembers.sql
-- Members could only read their OWN profile row (SELECT policy was
-- `id = auth.uid() OR is\_admin()`), so non-admin members saw emails + letter avatars
-- instead of their club-mates' names/photos everywhere (Club member list, Players tab,
-- Money tab, game-setup roster, tee-group shuffle). App admins never saw the bug because
-- is\_admin() let them read all rows. This lets a member also read the profile of anyone
-- they share an ACTIVE club (group) with. A SECURITY DEFINER helper does the co-membership
-- check so the policy's own subquery isn't itself filtered by group\_members' RLS.
create or replace function public.shares\_active\_club(other uuid)
returns boolean
language sql stable security definer set search\_path = public as $$
  select exists (
    select 1
    from group\_members me
    join group\_members them on them.group\_id = me.group\_id
    where me.user\_id = auth.uid() and me.status = 'active'
      and them.user\_id = other  and them.status = 'active'
  );
$$;

drop policy if exists "read own or admin all" on public.profiles;
drop policy if exists "read own, co-members, or admin" on public.profiles;
create policy "read own, co-members, or admin" on public.profiles
for select using (
  id = auth.uid()
  or public.is\_admin()
  or public.shares\_active\_club(id)
);
```

## v1.109.0 — Wire four more event notifications (RUN migration 0073)

Adds SECURITY DEFINER triggers (fan-out, same pattern as 0070) for the four event-driven types that were showing "· soon", and flips them to live in the Profile → Notifications menu. All four default to In-app (they only push if a user opts that type up to Push). tee\_reminder stays "· soon" — it's time-based and needs a scheduler (pg\_cron), a separate build.

* tee\_new: on tee\_times INSERT -> notifies all active club members except the creator; link /?tt=<id>.
* bet\_posted: on expenses INSERT where source\_kind='tgc\_bet' -> notifies the game's players except the poster; de-duped per user+club per 6h so bet re-posts (delete+reinsert) don't spam; link /?tab=money.
* game\_finished: on games UPDATE when status flips to 'ended' (guarded so it fires once) -> notifies the game's players; link /?tab=games.
* group\_member: on group\_members INSERT/UPDATE when a row becomes active (join, or invited->active) -> notifies the OTHER active members ("<Name> joined <Club>."); the club's first member (creator) pings no one; link /?tab=groups.
* No route change (DEFAULT\_DELIVERY already had these types). No client wiring needed — triggers fire regardless of code path.
* Validated on real Postgres: correct recipients, creator/poster excluded, game-finished fires once, bet re-post deduped, idempotent.

### 0073\_push\_events\_more.sql

```sql
-- 0073\_push\_events\_more.sql
-- Four more event notifications (fan-out via SECURITY DEFINER triggers, like 0070).
-- Defaults (client + route DEFAULT\_DELIVERY) are in-app for all four, so they only
-- buzz a phone if the user opts that type up to Push.

-- 1) New tee time posted -> notify all active club members except the creator.
create or replace function public.notify\_tee\_new() returns trigger
language plpgsql security definer set search\_path = public as $fn$
begin
  insert into notifications (user\_id, message, group\_id, type, link)
  select gm.user\_id, 'New tee time posted — tap to RSVP.', new.group\_id, 'tee\_new', '/?tt=' || new.id::text
  from group\_members gm
  where gm.group\_id = new.group\_id and gm.status = 'active' and gm.user\_id is not null
    and gm.user\_id is distinct from new.created\_by;
  return new;
end $fn$;
drop trigger if exists trg\_notify\_tee\_new on public.tee\_times;
create trigger trg\_notify\_tee\_new after insert on public.tee\_times
  for each row execute function public.notify\_tee\_new();

-- 2) A bet was posted -> notify the game's players (not the poster). De-duped per
--    user+club per 6h so bet re-posts (delete+reinsert) don't spam.
create or replace function public.notify\_bet\_posted() returns trigger
language plpgsql security definer set search\_path = public as $fn$
begin
  if new.source\_kind is distinct from 'tgc\_bet' or new.source\_game\_id is null then return new; end if;
  insert into notifications (user\_id, message, group\_id, type, link)
  select gp.user\_id, 'A bet was posted in your game — see the Money tab.', new.group\_id, 'bet\_posted', '/?tab=money'
  from game\_players gp
  where gp.game\_id = new.source\_game\_id and gp.user\_id is not null
    and gp.user\_id is distinct from new.created\_by
    and not exists (
      select 1 from notifications n
      where n.user\_id = gp.user\_id and n.type = 'bet\_posted'
        and n.group\_id is not distinct from new.group\_id
        and n.created\_at > now() - interval '6 hours'
    );
  return new;
end $fn$;
drop trigger if exists trg\_notify\_bet\_posted on public.expenses;
create trigger trg\_notify\_bet\_posted after insert on public.expenses
  for each row execute function public.notify\_bet\_posted();

-- 3) Game finished -> notify the game's players when status flips to 'ended'.
create or replace function public.notify\_game\_finished() returns trigger
language plpgsql security definer set search\_path = public as $fn$
begin
  if new.status is distinct from 'ended' or old.status is not distinct from 'ended' then return new; end if;
  insert into notifications (user\_id, message, group\_id, type, link)
  select gp.user\_id, 'Your game is final — see the results.', new.group\_id, 'game\_finished', '/?tab=games'
  from game\_players gp
  where gp.game\_id = new.id and gp.user\_id is not null;
  return new;
end $fn$;
drop trigger if exists trg\_notify\_game\_finished on public.games;
create trigger trg\_notify\_game\_finished after update on public.games
  for each row execute function public.notify\_game\_finished();

-- 4) New member joins a club -> notify the OTHER active members. Fires when a row
--    becomes active (insert active, or invited->active), not on the club's first member.
create or replace function public.notify\_group\_member() returns trigger
language plpgsql security definer set search\_path = public as $fn$
declare nm text; cn text;
begin
  if new.user\_id is null or new.status is distinct from 'active' then return new; end if;
  if tg\_op = 'UPDATE' and old.status is not distinct from 'active' then return new; end if;
  select coalesce(nullif(display\_name, ''), 'A new golfer') into nm from profiles where id = new.user\_id;
  select name into cn from groups where id = new.group\_id;
  insert into notifications (user\_id, message, group\_id, type, link)
  select gm.user\_id, coalesce(nm, 'A new golfer') || ' joined ' || coalesce(cn, 'your club') || '.', new.group\_id, 'group\_member', '/?tab=groups'
  from group\_members gm
  where gm.group\_id = new.group\_id and gm.status = 'active' and gm.user\_id is not null
    and gm.user\_id is distinct from new.user\_id;
  return new;
end $fn$;
drop trigger if exists trg\_notify\_group\_member on public.group\_members;
create trigger trg\_notify\_group\_member after insert or update on public.group\_members
  for each row execute function public.notify\_group\_member();
```

### Migration 0074 — tee-time reminders (pg\_cron)

Enables pg\_cron + schedules send\_tee\_reminders() every 15 min. Inserts tee\_reminder
notifications only (webhook/push handles delivery). If the SQL editor errors on the
`create extension` line, enable pg\_cron first via Dashboard -> Database -> Extensions,
then re-run. Verify with: select \* from cron.job where jobname='tee-reminders';
Push still requires the webhook + Vercel env vars to be live to reach phones.

```sql
-- 0074\_tee\_reminders.sql
-- Time-based tee-time reminders, delivered through the existing
-- notifications -> Database Webhook -> /api/push pipeline (type 'tee\_reminder', def push).
-- The scheduler only INSERTS notification rows; no pg\_net / Edge Function needed.
--
-- Two reminders, both de-duplicated per (user, tee time, reminder-kind) via the link marker:
--   A) Deadline nudge  : 24h before signup\_deadline, to ACTIVE club members who have NOT responded.
--   B) Morning-of      : 06:00-11:59 America/New\_York on play\_date, to players who chose 'in'.
--
-- pg\_cron runs in UTC; that is fine because the windows are computed against stored
-- timestamps (signup\_deadline is timestamptz; play\_date is compared in America/New\_York).

create extension if not exists pg\_cron;

create or replace function public.send\_tee\_reminders()
returns void
language plpgsql
security definer
set search\_path = public
as $$
begin
  -- A) Deadline nudge: within 24h of the signup deadline, members with no RSVP row yet.
  insert into notifications (user\_id, message, group\_id, type, link)
  select gm.user\_id,
         'RSVP closes soon for the ' || to\_char(t.play\_date, 'Dy, Mon FMDD')
           || ' tee time — let your club know if you''re in.',
         t.group\_id,
         'tee\_reminder',
         '/?tt=' || t.id::text || '\&r=deadline'
  from public.tee\_times t
  join public.group\_members gm
    on gm.group\_id = t.group\_id
   and gm.status = 'active'
   and gm.user\_id is not null
  where t.status = 'upcoming'
    and t.signup\_deadline is not null
    and now() >= t.signup\_deadline - interval '24 hours'
    and now() <  t.signup\_deadline
    and not exists (
      select 1 from public.tee\_time\_rsvps r
      where r.tee\_time\_id = t.id and r.user\_id = gm.user\_id
    )
    and not exists (
      select 1 from public.notifications n
      where n.user\_id = gm.user\_id
        and n.type = 'tee\_reminder'
        and n.link = '/?tt=' || t.id::text || '\&r=deadline'
    );

  -- B) Morning-of: on the play date (06:00-11:59 Eastern), to players who said 'in'.
  insert into notifications (user\_id, message, group\_id, type, link)
  select r.user\_id,
         'Tee time today — ' || to\_char(t.play\_date, 'Dy, Mon FMDD') || '. See you out there.',
         t.group\_id,
         'tee\_reminder',
         '/?tt=' || t.id::text || '\&r=day'
  from public.tee\_times t
  join public.tee\_time\_rsvps r
    on r.tee\_time\_id = t.id
   and r.choice = 'in'
   and r.user\_id is not null
  where t.status = 'upcoming'
    and (now() at time zone 'America/New\_York')::date = t.play\_date
    and extract(hour from (now() at time zone 'America/New\_York')) >= 6
    and extract(hour from (now() at time zone 'America/New\_York')) < 12
    and not exists (
      select 1 from public.notifications n
      where n.user\_id = r.user\_id
        and n.type = 'tee\_reminder'
        and n.link = '/?tt=' || t.id::text || '\&r=day'
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

select cron.schedule('tee-reminders', '\*/15 \* \* \* \*', $$ select public.send\_tee\_reminders(); $$);
```

### Migration 0075 — tee-time roles (members create, creator organizes, captain runs game)

Opens tee-time creation to any active member, lets the creator manage signups, and adds
two SECURITY DEFINER RPCs (set\_tee\_time\_captain, link\_tee\_time\_game). No new tables.
Validated on Postgres with a 15-case authorization matrix (non-owner role).

```sql
-- 0075\_tee\_time\_roles.sql
-- Looser tee-time roles:
--   \* ANY active group member can create a tee time (was admin/owner only).
--   \* The tee-time CREATOR can manage everyone's RSVPs for that tee time
--     (mark in/out, promote from waitlist, remove guests) — "acts as admin" for it.
--   \* Captain assignment/reassignment (admin, creator, or current captain) and
--     game linking (the captain who created the game) go through SECURITY DEFINER
--     RPCs so neither grants blanket edit rights over the tee time.
-- Creating/editing/cancelling the tee time itself is unchanged (creator or admin).

-- 1) Any active member can create a tee time (created\_by must be the caller, no spoofing).
drop policy if exists tt\_insert on public.tee\_times;
create policy tt\_insert on public.tee\_times for insert
  with check (
    created\_by = auth.uid()
    and exists (select 1 from public.group\_members gm
                where gm.group\_id = tee\_times.group\_id and gm.user\_id = auth.uid()
                  and gm.status = 'active'));

-- 2) RSVP writes: the tee-time CREATOR joins admins/owners as an "organizer" who can
--    write anyone's RSVP (members can still write only their own).
drop policy if exists ttr\_insert on public.tee\_time\_rsvps;
create policy ttr\_insert on public.tee\_time\_rsvps for insert
  with check (
    exists (select 1 from public.tee\_times t
              join public.group\_members gm on gm.group\_id = t.group\_id
            where t.id = tee\_time\_rsvps.tee\_time\_id and gm.user\_id = auth.uid() and gm.status = 'active')
    and (
      user\_id = auth.uid()
      or exists (select 1 from public.tee\_times t2
                   join public.group\_members gm2 on gm2.group\_id = t2.group\_id
                 where t2.id = tee\_time\_rsvps.tee\_time\_id and gm2.user\_id = auth.uid()
                   and gm2.status = 'active' and gm2.role in ('admin','owner'))
      or exists (select 1 from public.tee\_times t3
                 where t3.id = tee\_time\_rsvps.tee\_time\_id and t3.created\_by = auth.uid())
    ));

drop policy if exists ttr\_update on public.tee\_time\_rsvps;
create policy ttr\_update on public.tee\_time\_rsvps for update
  using (
    user\_id = auth.uid()
    or exists (select 1 from public.tee\_times t
                 join public.group\_members gm on gm.group\_id = t.group\_id
               where t.id = tee\_time\_rsvps.tee\_time\_id and gm.user\_id = auth.uid()
                 and gm.status = 'active' and gm.role in ('admin','owner'))
    or exists (select 1 from public.tee\_times t3
               where t3.id = tee\_time\_rsvps.tee\_time\_id and t3.created\_by = auth.uid()));

drop policy if exists ttr\_delete on public.tee\_time\_rsvps;
create policy ttr\_delete on public.tee\_time\_rsvps for delete
  using (
    user\_id = auth.uid()
    or exists (select 1 from public.tee\_times t
                 join public.group\_members gm on gm.group\_id = t.group\_id
               where t.id = tee\_time\_rsvps.tee\_time\_id and gm.user\_id = auth.uid()
                 and gm.status = 'active' and gm.role in ('admin','owner'))
    or exists (select 1 from public.tee\_times t3
               where t3.id = tee\_time\_rsvps.tee\_time\_id and t3.created\_by = auth.uid()));

-- 3) Assign/reassign the captain. Authorized: group admin, tee-time creator, or the
--    current captain. A named captain must be signed up "in" for the round. NULL clears it.
create or replace function public.set\_tee\_time\_captain(p\_tee\_time\_id uuid, p\_new\_captain uuid)
returns void
language plpgsql
security definer
set search\_path = public
as $$
declare v\_uid uuid := auth.uid(); v\_group uuid; v\_creator uuid; v\_captain uuid;
begin
  select group\_id, created\_by, captain\_user\_id into v\_group, v\_creator, v\_captain
  from public.tee\_times where id = p\_tee\_time\_id;
  if v\_group is null then raise exception 'Tee time not found'; end if;
  if not (public.is\_group\_admin(v\_group, v\_uid) or v\_creator = v\_uid or v\_captain = v\_uid) then
    raise exception 'Not authorized to set the captain';
  end if;
  if p\_new\_captain is not null and not exists (
       select 1 from public.tee\_time\_rsvps r
       where r.tee\_time\_id = p\_tee\_time\_id and r.user\_id = p\_new\_captain and r.choice = 'in') then
    raise exception 'Captain must be signed up as In for this round';
  end if;
  update public.tee\_times set captain\_user\_id = p\_new\_captain, updated\_at = now()
  where id = p\_tee\_time\_id;
end;
$$;
grant execute on function public.set\_tee\_time\_captain(uuid, uuid) to authenticated;

-- 4) Link a created game back to its tee time. Authorized: the caller must have CREATED
--    the game, be in the same group, and be the tee time's captain (or its creator/admin).
create or replace function public.link\_tee\_time\_game(p\_tee\_time\_id uuid, p\_game\_id uuid)
returns void
language plpgsql
security definer
set search\_path = public
as $$
declare v\_uid uuid := auth.uid(); v\_tt\_group uuid; v\_creator uuid; v\_captain uuid;
        v\_game\_group uuid; v\_game\_creator uuid;
begin
  select group\_id, created\_by, captain\_user\_id into v\_tt\_group, v\_creator, v\_captain
  from public.tee\_times where id = p\_tee\_time\_id;
  if v\_tt\_group is null then raise exception 'Tee time not found'; end if;
  select group\_id, created\_by into v\_game\_group, v\_game\_creator
  from public.games where id = p\_game\_id;
  if v\_game\_group is null then raise exception 'Game not found'; end if;
  if v\_game\_creator is distinct from v\_uid then raise exception 'You can only link a game you created'; end if;
  if v\_game\_group is distinct from v\_tt\_group then raise exception 'Game and tee time are in different groups'; end if;
  if not (public.is\_group\_admin(v\_tt\_group, v\_uid) or v\_creator = v\_uid or v\_captain = v\_uid) then
    raise exception 'Not authorized to link this tee time';
  end if;
  update public.tee\_times set game\_id = p\_game\_id, updated\_at = now()
  where id = p\_tee\_time\_id;
end;
$$;
grant execute on function public.link\_tee\_time\_game(uuid, uuid) to authenticated;
```

### v1.111.1 — bet-post error hardening + migration audit (no migration)

Code-only. Both bet-post paths surface the real DB error + console.error the error objects.
New ops tool: `ci/verify\_migrations.sql` — run it in the Supabase SQL editor any time to confirm
which migrations are applied. It lists one sentinel object per migration file and reports
present=true/false; any `false` row means that migration hasn't been applied to that database.
(This is the check that would have caught the missing 0063 `expense\_shares.sponsor\_user\_id` column.)

### v1.111.2 — duplicate-hole fix (migrations 0076 + 0077, run 0076 first)

Prevents a round ending up with each hole stored twice (which doubled gross/net/
Stableford + scoring buckets and rendered each hole twice). Root cause: no unique
constraint on holes(round\_id,hole\_number) + concurrent delete-then-insert posts.
Also a client guard (dedupeHoles in lib/golf.ts) applied in home.tsx \& manage.tsx.

Run 0076 FIRST (unique index), then 0077 (functions rely on it for ON CONFLICT).

```sql
-- 0076\_holes\_unique.sql
create unique index if not exists holes\_round\_hole\_uk
  on public.holes (round\_id, hole\_number);
```

Then 0077 (full SQL in migrations/0077\_holes\_upsert.sql — both posting functions
rewritten with ON CONFLICT (round\_id, hole\_number) DO UPDATE on the hole insert):

```sql
-- 0077\_holes\_upsert.sql
-- Make the per-hole writes in the round-posting functions idempotent under concurrency.
-- Both post\_game\_rounds and post\_group\_rounds do `delete from holes where round\_id = rid`
-- then insert one row per played hole. Under READ COMMITTED, two concurrent posts of the
-- same (game,user) each snapshot no committed holes, so both delete-nothing and both insert
-- a full set -> the round ends up with every hole doubled (36 rows for 18), which doubles
-- gross/net/Stableford and the scoring buckets and renders each hole twice.
--
-- Fix: the hole insert now uses ON CONFLICT (round\_id, hole\_number) DO UPDATE, so the losing
-- racer updates the existing row in place instead of inserting a duplicate. Requires the
-- unique index from 0076 (holes\_round\_hole\_uk) — run 0076 first.
-- Only the hole-insert clause changed; everything else matches 0044/0045.

create or replace function public.post\_game\_rounds(p\_game uuid)
returns void
language plpgsql
security definer
set search\_path = public
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
  select \* into g from games where id = p\_game;
  if not found then return; end if;
  if g.created\_by is distinct from auth.uid() then return; end if;

  hmeta := coalesce(g.holes\_meta, '\[]'::jsonb);
  n := jsonb\_array\_length(hmeta);
  rdate := coalesce(g.played\_at, g.created\_at::date, current\_date);

  for pl in
    select \* from game\_players where game\_id = p\_game and user\_id is not null
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

    select id into rid from rounds where game\_id = p\_game and user\_id = pl.user\_id limit 1;
    if rid is not null then
      update rounds set
        course = g.course, tee\_name = pl.tee\_name, rating = pl.rating, slope = pl.slope,
        course\_par = g.course\_par, handicap\_index = pl.handicap\_index,
        course\_handicap = pl.course\_handicap, group\_id = g.group\_id,
        played\_at = rdate, status = 'final', gross\_score = gross
      where id = rid;
    else
      insert into rounds (
        user\_id, course, tee\_name, rating, slope, course\_par, handicap\_index,
        course\_handicap, group\_id, played\_at, status, gross\_score, game\_id
      ) values (
        pl.user\_id, g.course, pl.tee\_name, pl.rating, pl.slope, g.course\_par, pl.handicap\_index,
        pl.course\_handicap, g.group\_id, rdate, 'final', gross, p\_game
      )
      on conflict (game\_id, user\_id) do update set
        course = excluded.course, tee\_name = excluded.tee\_name, rating = excluded.rating,
        slope = excluded.slope, course\_par = excluded.course\_par,
        handicap\_index = excluded.handicap\_index, course\_handicap = excluded.course\_handicap,
        group\_id = excluded.group\_id, played\_at = excluded.played\_at,
        status = excluded.status, gross\_score = excluded.gross\_score
      returning id into rid;
    end if;

    delete from holes where round\_id = rid;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        insert into holes (
          round\_id, hole\_number, par, stroke\_index, strokes, putts, fairway, penalties, sand, yardage
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
        on conflict (round\_id, hole\_number) do update set
          par = excluded.par, stroke\_index = excluded.stroke\_index, strokes = excluded.strokes,
          putts = excluded.putts, fairway = excluded.fairway, penalties = excluded.penalties,
          sand = excluded.sand, yardage = excluded.yardage;
      end if;
    end loop;
  end loop;
end;
$$;

grant execute on function public.post\_game\_rounds(uuid) to authenticated;

create or replace function public.post\_group\_rounds(p\_game uuid, p\_tee\_group int)
returns void
language plpgsql
security definer
set search\_path = public
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
  select \* into g from games where id = p\_game;
  if not found then return; end if;
  if not exists (
    select 1 from game\_players where game\_id = p\_game and user\_id = auth.uid()
  ) then
    return;
  end if;

  hmeta := coalesce(g.holes\_meta, '\[]'::jsonb);
  n := jsonb\_array\_length(hmeta);
  rdate := coalesce(g.played\_at, g.created\_at::date, current\_date);

  for pl in
    select \* from game\_players
    where game\_id = p\_game and user\_id is not null and tee\_group = p\_tee\_group
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

    select id into rid from rounds where game\_id = p\_game and user\_id = pl.user\_id limit 1;
    if rid is not null then
      update rounds set
        course = g.course, tee\_name = pl.tee\_name, rating = pl.rating, slope = pl.slope,
        course\_par = g.course\_par, handicap\_index = pl.handicap\_index,
        course\_handicap = pl.course\_handicap, group\_id = g.group\_id,
        played\_at = rdate, status = 'final', gross\_score = gross
      where id = rid;
    else
      insert into rounds (
        user\_id, course, tee\_name, rating, slope, course\_par, handicap\_index,
        course\_handicap, group\_id, played\_at, status, gross\_score, game\_id
      ) values (
        pl.user\_id, g.course, pl.tee\_name, pl.rating, pl.slope, g.course\_par, pl.handicap\_index,
        pl.course\_handicap, g.group\_id, rdate, 'final', gross, p\_game
      )
      on conflict (game\_id, user\_id) do update set
        course = excluded.course, tee\_name = excluded.tee\_name, rating = excluded.rating,
        slope = excluded.slope, course\_par = excluded.course\_par,
        handicap\_index = excluded.handicap\_index, course\_handicap = excluded.course\_handicap,
        group\_id = excluded.group\_id, played\_at = excluded.played\_at,
        status = excluded.status, gross\_score = excluded.gross\_score
      returning id into rid;
    end if;

    delete from holes where round\_id = rid;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        insert into holes (
          round\_id, hole\_number, par, stroke\_index, strokes, putts, fairway, penalties, sand, yardage
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
        on conflict (round\_id, hole\_number) do update set
          par = excluded.par, stroke\_index = excluded.stroke\_index, strokes = excluded.strokes,
          putts = excluded.putts, fairway = excluded.fairway, penalties = excluded.penalties,
          sand = excluded.sand, yardage = excluded.yardage;
      end if;
    end loop;
  end loop;
end;
$$;

grant execute on function public.post\_group\_rounds(uuid, int) to authenticated;
```

### v1.111.3 — push: iPhone install warning + subscription hardening (NO migration)

Client-only; deploy is unzip -> commit -> Vercel, no SQL to run.

* manage.tsx: install\_ios state now shows an explicit red warning + numbered Safari-install
steps; toggle on/off reflects real server enrollment via syncPushSubscription (not just the
browser subscription), so it can't show a false "on".
* lib/push.ts: syncPushSubscription(userId) upserts the current browser subscription on open.
* app/page.tsx: calls syncPushSubscription on app open for a logged-in (online) user.
Reminder unrelated to this release but still pending from before: run migrations 0075, then
0076 and 0077 (0076 before 0077), plus optional 0071 and recommended 0073.

### v1.112.0 — capabilities single-source + auto-synced one-pagers + Help link (NO migration)

Client + tooling; deploy is unzip -> commit -> Vercel (the served PDFs ship in public/).

* `lib/capabilities.json`: single source of truth for app capabilities (edition-tagged).
* Help page (`manage.tsx` HelpPage) renders a live "What Birdie Num Num can do" section from
that file (TGC members see the TGC edition + exclusives; other clubs see the club edition),
with a "Download one-pager (PDF)" link to /BNN-onepager-tgc.pdf or /BNN-onepager-club.pdf.
* `marketing/make\_onepagers.py` reads capabilities.json, writes public/BNN-onepager-{club,tgc}.pdf
(deterministic: reportlab invariant mode) + marketing/onepager-content.txt manifest.
* Refresh sheets after editing capabilities.json:  npm run gen:onepagers
* CI `.github/workflows/robustness.yml` job `onepager-sync` installs reportlab==4.4.10, runs the
generator, and fails if marketing/onepager-content.txt drifts (list changed but sheets not regenerated).

### v1.113.0 — admin golf-cadence engagement analytics (migration 0078)

New is\_admin-gated RPC get\_admin\_engagement() + AdminEngagement panel (renders under the
existing admin analytics). Reads only rounds, server-side JSON (free-tier friendly).
Run 0078 in the SQL editor:

```sql
-- 0078\_admin\_engagement.sql
-- Golf-cadence engagement metrics for the admin analytics panel. Complements the existing
-- get\_admin\_analytics() (which is DAU/app-open framed). Golf is weekend-skewed and episodic,
-- so these measure the RIGHT unit (the round) on the RIGHT cycle (the week / the golf weekend):
--   \* WAU/MAU on rounds (honest stickiness, not DAU/MAU)
--   \* weekend reach series (distinct golfers logging Fri-Sun, per ISO week, last 12 weeks)
--   \* weekend vs weekday share (validates the Fri-Sun skew)
--   \* rounds per active golfer per \~month (28d)
--   \* new vs returning golfers per week (based on first-ever round, not app-opens)
--   \* feature split: rounds played inside a game vs solo
-- All read only `rounds` (deleted\_at is null), server-side, returned as one JSON payload so the
-- client never does broad table reads (free-tier friendly). Postgres dow: Sun=0..Sat=6, so a
-- "golf weekend" is dow in (5,6,0) = Fri/Sat/Sun, all within the same ISO week (Mon-start).

create or replace function public.get\_admin\_engagement()
returns jsonb
language plpgsql
security definer
set search\_path = public
as $function$
declare
  j jsonb;
  v\_wau int; v\_mau int; v\_active28 int; v\_rounds28 int;
begin
  if not public.is\_admin() then
    raise exception 'admins only';
  end if;

  select count(distinct user\_id) into v\_wau  from rounds where deleted\_at is null and played\_at > current\_date - 7;
  select count(distinct user\_id) into v\_mau  from rounds where deleted\_at is null and played\_at > current\_date - 30;
  select count(distinct user\_id) into v\_active28 from rounds where deleted\_at is null and played\_at > current\_date - 28;
  select count(\*)                into v\_rounds28  from rounds where deleted\_at is null and played\_at > current\_date - 28;

  j := jsonb\_build\_object(
    'wau', v\_wau,
    'mau', v\_mau,
    'wau\_mau\_pct', case when v\_mau > 0 then round(100.0 \* v\_wau / v\_mau) else 0 end,
    'active\_28d', v\_active28,
    'rounds\_28d', v\_rounds28,
    'rounds\_per\_active\_mo', case when v\_active28 > 0 then round(v\_rounds28::numeric / v\_active28, 1) else 0 end,
    'weekend\_share\_pct', coalesce((
      select round(100.0 \* count(\*) filter (where extract(dow from played\_at) in (5,6,0)) / nullif(count(\*), 0))
      from rounds where deleted\_at is null and played\_at > current\_date - 90), 0),
    'weekend\_series', coalesce((
      select jsonb\_agg(jsonb\_build\_object('week', to\_char(wk + 5, 'Mon DD'), 'golfers', g, 'rounds', r) order by wk)
      from (
        select date\_trunc('week', played\_at)::date wk,
               count(distinct user\_id) filter (where extract(dow from played\_at) in (5,6,0)) g,
               count(\*)                filter (where extract(dow from played\_at) in (5,6,0)) r
        from rounds
        where deleted\_at is null and played\_at > current\_date - 7 \* 12
        group by 1
      ) s), '\[]'::jsonb),
    'weekly\_new\_returning', coalesce((
      select jsonb\_agg(jsonb\_build\_object('week', to\_char(wk, 'Mon DD'), 'new', nw, 'returning', rt) order by wk)
      from (
        select date\_trunc('week', r.played\_at)::date wk,
               count(distinct r.user\_id) filter (where fr.first\_week = date\_trunc('week', r.played\_at)::date) nw,
               count(distinct r.user\_id) filter (where fr.first\_week < date\_trunc('week', r.played\_at)::date) rt
        from rounds r
        join (
          select user\_id, date\_trunc('week', min(played\_at))::date first\_week
          from rounds where deleted\_at is null group by user\_id
        ) fr on fr.user\_id = r.user\_id
        where r.deleted\_at is null and r.played\_at > current\_date - 7 \* 12
        group by 1
      ) s), '\[]'::jsonb),
    'feature', jsonb\_build\_object(
      'in\_game', (select count(\*) from rounds where deleted\_at is null and game\_id is not null and played\_at > current\_date - 90),
      'solo',    (select count(\*) from rounds where deleted\_at is null and game\_id is null     and played\_at > current\_date - 90)
    )
  );
  return j;
end;
$function$;

grant execute on function public.get\_admin\_engagement() to authenticated;
```

### v1.114.0 — WHS partial-round handicap (net-par fill) — NO migration

Pure client logic + UI. Deploy is unzip -> commit -> Vercel.

* lib/golf.ts roundDifferential: rounds of 9–17 played holes now produce a differential.
Played holes are capped at net double bogey; each unplayed hole is filled at net par.
Net-par fill is derived from course totals (no per-hole data for unplayed holes needed):
unplayed par     = course\_par - sum(played par)
unplayed strokes = course\_handicap - sum(strokes received on played holes)
Nine-hole floor enforced (fewer than 9 played -> no differential, unchanged for full 18).
* lib/golf.ts partialHandicapInfo(round): { played, filled, missing\[] } | null for the UI.
* round-detail.tsx: "Partial round — counted for your handicap" banner (shows which holes
were net-par-filled + the resulting differential).
* rounds-list.tsx: compact "· N net par for hcp" note on the row.
* Regression test (lib/golf.test.ts) pins the real Francis Byrne 15-hole round to differential 12.5.

### v1.115.0 — unfinished-round guard + discard-all (NO migration)

Client only. Deploy is unzip -> commit -> Vercel.

* home.tsx: ＋ New round is gated — if an in\_progress round exists, it routes to the dashboard
banner to resolve first (alert explains) instead of creating another round.
* Tracks the full in\_progress list (not just the most recent); banner shows the count and a
"Discard all N" button (soft-delete via deleted\_at) alongside Finish / Mark complete / Delete.
* Background: RoundEditor.backgroundSave writes an in\_progress row per session (device-loss
redundancy); abandoned sessions previously accumulated because only the newest was surfaced.
In\_progress rounds are already excluded from stats/handicap (home.tsx finished filter).

One-time cleanup of existing orphans (safe — soft-delete, never touches finalized rounds):
update rounds set deleted\_at = now()
where status = 'in\_progress' and deleted\_at is null;

### v1.115.1 — partial-round banner prominence + "thru X holes" (NO migration)

Client only. Refinements to partial-round display.

* round-detail.tsx: partial-round handicap banner restyled (Option A) — full gold border +
gold glow, flag icon, gold "Differential N.N" chip. More prominent than the thin left rule.
* round-detail.tsx header + rounds-list.tsx row: a partial hole-by-hole round now shows
"thru N" next to its score, so a 15-hole total never reads like a full 18.

### v1.115.2 — scorecard "thru N" + banner chip removed (NO migration)

Client only.

* ui.tsx ScoreViewCard: the OUT/IN/TOTAL summary now flags a partial round — the TOTAL box
shows a "THRU N" sublabel and a "Through N holes — not a full 18" caption, so a 15-hole 73
never reads as a full-18 73.
* round-detail.tsx: removed the gold "Differential N.N" chip from the partial-round banner
(the differential already shows in the stats box directly below). Banner keeps its gold border.

### v1.116.0 — dashboard time-window toggle (NO migration)

Client only. First piece of the dashboard rework.

* dashboard.tsx: new Last 5 / Last 20 / Season / All toggle below the index hero. It windows the
round set (`done`) that drives every stat card, average, and chart. `season` = current calendar
year; `5`/`20` = most recent N by played\_at; default `all` (preserves prior behavior).
* The WHS index (`hcp`) now computes from the FULL history (`allDone`), never the window — so the
toggle can't distort the handicap. Empty state also keys off full history.

### v1.117.0 — index trajectory sparkline in the hero (NO migration)

Client only. Second piece of the dashboard rework.

* dashboard.tsx: idxTrail (useMemo on rounds) recomputes the running WHS index after each
chronological round (full history); the hero now shows a gold sparkline of that trajectory
plus "first → current ▼/▲ delta" and "index over N rounds". Higher on the chart = higher
handicap, so improvement trends down (▼ green = index dropped, ▲ red = rose). Shown when
there are ≥2 computed index points.

### v1.117.1 — handicap control visibility (NO migration)

Client only. The "Use as my handicap" button was unchanged by the rework, but its in-use state
was small grey text where the gold button had been, which read as "the button disappeared."

* dashboard.tsx: the in-use state is now a visible gold-bordered "✓ In use as your handicap"
chip, so the control is clearly present whether or not the computed index is the one in use.
(The gold "Use as my handicap" button still appears whenever the computed index differs from
your saved handicap — unchanged.)

### v1.117.2 — clearer index-sparkline label (NO migration)

Client only. The sparkline sub-label "index over N rounds" read like a rolling average; changed
to "your index after each round". Each point is the running WHS index (best 8 of 20) as of that
round — not an average of scores. No logic change.

### v1.118.0 — shot-category synthesis + scrambling benchmark + one-line index delta (NO migration)

Client only. Third dashboard-rework piece.

* Index hero: the sparkline (v1.117.0) is replaced by a one-line delta ("▼ 2.6 since your first
index (16.2)") — the scoring-form differential chart remains the trend view.
* lib/benchmarks.ts: added a `scramble` band (StatKey/DIR/LABEL/UNIT/DOMAIN + per-hcp bands),
sourced from Break X up-and-down rates (0:50.0, 5:37.7, 10:31.6, 15:25.1, 20:21.7). bandFor
now returns scramble.
* compare-stats.tsx: new ShotSynthesis component — off-tee/approach/short-game/putting on a
band-relative 0–100 scale (50 = peer avg), verdict from the score (Strength ≥66 / On par /
Focus ≤40), biggest-opportunity ranked by gap toward the shared Aspire goal. Scrambling held
to a ≥15-round guard (noisy on small samples). CompareCard is now controlled (goalHcp prop,
no internal selector) and shows the scramble track too.
* dashboard.tsx: shared `goalHcp` state lifted here (drives synthesis + CompareCard); effGoal
defaults to the first goalOptions target. Synthesis rendered after the coach. Ball-striking
stat row gated on `anyHoleDetail`; scores-only golfers see a one-line nudge instead. Synthesis
and CompareCard self-hide when no stat has data.

### v1.119.0 — dashboard stat-grid regroup + synthesis readability (NO migration)

Client only. Final dashboard-rework piece.

* dashboard.tsx: 17 loose stat cards regrouped under section headers — SCORING (Rounds, Avg vs
par, Best round, Avg differential, Stableford; always shown, works from scores) with a
collapsible "scoring by par 3·4·5"; BALL-STRIKING (Fairways, GIR); SHORT GAME \& PUTTING
(Scrambling, Putts/hole) with a collapsible "more" (Sand saves, 3+ putts, Penalties). Par-type
cards moved out of ball-striking into the SCORING collapse (they're scoring, not ball-striking).
Ball-striking + short-game groups gated on anyHoleDetail; scores-only golfers see SCORING only
plus the nudge. Collapses via moreScoring / moreShort state. Every card still taps to its trend.
* Hero: differentials-used list now hidden behind a "how?" toggle (showDiffs) to declutter the top.
* compare-stats.tsx: ShotSynthesis sub-lines + caption changed from faint grey (low contrast on
green, and 9.5px under the 10px floor) to readable sage at 10.5px.

### v1.119.1 — compact Hole Outcomes (NO migration)

Client only. Replaced the Hole Outcomes donut + 5-row legend with a single horizontal stacked bar
(one strip = the round's composition), a compact wrapping legend (name · count · %), and a plain
cumulative takeaway "Par or better: X% · Doubles+: Y%" (clearer than the old double-negative). Same
categories/colors; \~⅓ the height. recharts PieChart/Pie imports removed (Cell still used elsewhere).

### v1.120.0 — dashboard reorder + How-you-compare restyle + hero layout (NO migration)

Client only.

* dashboard.tsx: section order is now Hero → time-window toggle → SCORING FORM chart → AI coach →
scoring stat groups → stat drill-down → gaining/losing (synthesis) → how you compare → hole
outcomes → recent rounds. (Toggle sits at top so it governs all windowed content incl. the
scoring-form chart.)
* Hero: index number + Use-as-my-handicap button now float to the right; the eyebrow/WHS/delta text
wraps around them, so the box is far more compact. "In use" chip shortened.
* compare-stats.tsx: extracted a shared CatBar row (name + verdict chip + 0–100 band-relative bar
with peer tick + sub-line). Both ShotSynthesis and CompareCard now render through it, so "How you
compare" matches "Where you're gaining \& losing shots" — gold uppercase eyebrow, dark-green card,
cream/sage text (dropped the serif title + light cream panels). CompareCard's sub-line is the
detailed insight sentence; synthesis's is the goal delta. Removed the old Track/band + light-panel
rendering.

### v1.120.1 — section-header expanders (NO migration)

Client only. dashboard.tsx: the "More/Less" collapse toggles for SCORING (par 3·4·5) and SHORT GAME \&
PUTTING (sand saves · 3-putts · penalties) moved from a full-width dashed row at the bottom of each
section into a compact "＋ More / − Less" button on the right of the section-header rule — saves a row.
sectionHead now takes an optional right-side node; moreBtn helper removed, replaced by expandBtn.

### v1.120.2 — dashboard fixes + merge duplicate compare tile (NO migration)

Client only.

* Fix: AI-coach tile now has marginTop:16 so it no longer sits flush against the Scoring Form tile
above it (the coach previously relied on the time-window toggle's bottom margin, which moved away
in the reorder).
* Fix: several strings in compare-stats.tsx were written as literal \\uXXXX escapes inside JSX *text*
(not string literals), so they rendered as "\\u2019" / "\\u00b7" / "\\u2014" on screen. Replaced all
with the real characters (’ · —), so the eyebrow reads "WHERE YOU'RE GAINING \& LOSING SHOTS" etc.
* Expander: the SCORING / SHORT GAME "More/Less" toggle is now a gold-bordered pill (faint gold fill
when collapsed) so it's obviously tappable, instead of plain gold text.
* Merge: removed the "How you compare" (CompareCard) tile entirely — it duplicated the same four bars
as "Where you're gaining \& losing shots". Deleted CompareCard + its insight() helper from
compare-stats.tsx and the import/usage from dashboard.tsx. The synthesis tile is now the single
peer/goal card.

### v1.121.0 — tappable category explainers in the synthesis tile (NO migration)

Client only. compare-stats.tsx: each category row in "Where you're gaining \& losing shots" (Off the
tee / Approach / Short game / Putting) is now tappable — an ⓘ marks it, and tapping expands a
"How it's measured / What to work on" panel beneath that row (one open at a time). Content lives in a
CAT\_DESC record keyed by StatKey; the Short-game entry explains scrambling in plain English and points
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

* Chart tooltip: replaced the old white `contentStyle` tooltip (background was C.card = #FFFDF6, i.e.
near-white, with recharts' default black text) on BOTH dashboard charts with a shared <ChartTip>
component — Option B: solid deep-green card, thin gold ring, gold label (course · player/date),
cream values, null series filtered out. One component, both charts (scoring-form + stat drill-down).
* TEMP DIAGNOSTIC (components/nav-debug.tsx): owner-only (amitsud@gmail.com) fixed overlay reporting the
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

Data foundation only: `member\_badges` table, `profiles.show\_card` opt-out, and the
`group\_badges` peer-read RPC, plus the pure evaluator in `lib/badges.ts` (35 unit tests).
Nothing is wired into the finalize flow yet, so deploying is inert until Phase 2. Run 0079:

```sql
-- 0079\_achievements.sql
-- Achievements/badges: per-player earned badges + a peer-visible read path.
-- Safe to run multiple times. Run in the Supabase SQL editor.

-- 1) member\_badges: one row per (user, badge\_key).
--    count       = times earned (for repeatable/count badges; 1 for once/milestone)
--    best\_value  = current record for "best" badges (differential, vs-par, fairways, etc.)
--    best\_round\_id = the round that set the current record
create table if not exists public.member\_badges (
  user\_id         uuid not null references auth.users(id) on delete cascade,
  badge\_key       text not null,
  count           int  not null default 0,
  best\_value      numeric,
  best\_round\_id   uuid references public.rounds(id) on delete set null,
  first\_earned\_at timestamptz not null default now(),
  last\_earned\_at  timestamptz not null default now(),
  primary key (user\_id, badge\_key)
);

alter table public.member\_badges enable row level security;

-- Own badges: full access to your own rows.
drop policy if exists member\_badges\_own on public.member\_badges;
create policy member\_badges\_own on public.member\_badges
  for all using (user\_id = auth.uid()) with check (user\_id = auth.uid());

-- Admins can read all (oversight/analytics).
drop policy if exists member\_badges\_admin on public.member\_badges;
create policy member\_badges\_admin on public.member\_badges
  for select using (public.is\_admin());

-- 2) profiles.show\_card — per-player opt-out of the public player card (default on).
alter table public.profiles add column if not exists show\_card boolean not null default true;

-- 3) Peer viewing: badges for everyone in a group the caller belongs to.
--    SECURITY DEFINER + is\_group\_member gate (mirrors group\_roster). Honors show\_card.
drop function if exists public.group\_badges(uuid);
create or replace function public.group\_badges(p\_group uuid)
returns table (
  user\_id uuid, badge\_key text, count int, best\_value numeric,
  best\_round\_id uuid, first\_earned\_at timestamptz, last\_earned\_at timestamptz
)
language sql security definer set search\_path = public as $$
  select mb.user\_id, mb.badge\_key, mb.count, mb.best\_value, mb.best\_round\_id,
         mb.first\_earned\_at, mb.last\_earned\_at
  from public.member\_badges mb
  join public.group\_members gm
    on gm.user\_id = mb.user\_id and gm.group\_id = p\_group and gm.status = 'active'
  join public.profiles pr on pr.id = mb.user\_id
  where public.is\_group\_member(p\_group, auth.uid())
    and coalesce(pr.show\_card, true) = true;
$$;
grant execute on function public.group\_badges(uuid) to authenticated;
```

### v1.124.0 — achievements Phase 2a: compute + backfill + wall (NO new migration)

Client only; still requires migration 0079 (above). Wires badges end-to-end:

* `lib/badges.ts` gains `computeBadgeState` (pure chronological replay -> full badge rows).
* `lib/badge-sync.ts` `syncBadges()` diffs desired vs stored and upserts/reconciles.
* home.tsx runs `syncBadges` on every finished-rounds change — this is BOTH compute-on-finish
and the one-time history backfill (idempotent, no-op when unchanged, covers all finalize paths).
* `components/achievements.tsx` `AchievementsWall` renders under the Profile tab (own badges,
earned vs locked, counts + records). Pre-migration it just shows all-locked (no crash).
Cumulative: deploying 1.124.0 includes the 1.123.0 foundation.

### v1.125.0 — achievements: tappable evidence + moved under Profile (NO migration)

Client only. `member\_badges.best\_round\_id` is now the representative round for EVERY badge
(record round for 'best', latest occurrence for 'count', earning round for once/milestone) —
no schema change; existing rows backfill this on the next app open via `syncBadges`.

* `lib/badges.ts` adds `badgeEvidence(key, round)` — recomputes how a badge was earned,
including the qualifying hole stretch for streaks (bogey-free, par train, even-par nine, etc.).
* `AchievementsWall` badges are tappable -> inline panel with the round (course + date), the
evidence text, and a per-hole strip for stretch badges.
* The wall moved INSIDE `ProfilePanel`, directly under the profile card (above notifications and
the admin blocks) so it isn't buried at the bottom for admins.

### v1.126.0 — self player card + wall syncs on open (NO migration)

Client only. Adds `components/player-card.tsx` `PlayerCard` at the top of the Profile tab:
photo, running index + trend (index now vs before the last 5 rounds), career bests (from
member\_badges), a peek-scroll badge row (hidden scrollbar, a badge clipped at the edge), and a
last-5-differentials rolling-average form sparkline. All from the player's OWN data — no peer
read path yet. `AchievementsWall` now runs `syncBadges` on open (rounds passed in) so the earning
round is always attached before render — fixes the stale first-tap on legacy rows. `ProfilePanel`
gained a `rounds` prop (threaded from home) feeding both the card and the wall's sync.

### v1.127.0 — peer player card (migration 0080)

Adds the peer read path. `player\_cards` summary + `group\_cards` RPC; `lib/card.ts` (`computeCardStats`,
`rollingForm`) + `lib/card-sync.ts` (`syncPlayerCard`, diff-guarded, runs alongside syncBadges on
rounds change). `player-card.tsx` refactored to `PlayerCardView` (presentational) + `PlayerCard`
(self) + `PeerCardModal`. Players-tab roster rows are tappable (avatar+name) -> the peer's card.
Run 0080:

```sql
-- 0080\_player\_cards.sql
-- Peer-visible player card: a small per-player summary (running index, its recent
-- trend, rolling-form series, rounds played) that group-mates can read. Needed
-- because a peer's rounds themselves are not readable (rounds RLS is own/admin).
-- Computed client-side at sync time (lib/card-sync). Safe to run multiple times.

create table if not exists public.player\_cards (
  user\_id    uuid primary key references auth.users(id) on delete cascade,
  idx        numeric,                          -- running WHS index (null if < 3 rounds)
  idx\_trend  numeric,                          -- index now minus index before last 5 rounds (neg = improving)
  form       jsonb not null default '\[]'::jsonb, -- last-5 rolling-average differential series
  rounds     int   not null default 0,
  updated\_at timestamptz not null default now()
);

alter table public.player\_cards enable row level security;

drop policy if exists player\_cards\_own on public.player\_cards;
create policy player\_cards\_own on public.player\_cards
  for all using (user\_id = auth.uid()) with check (user\_id = auth.uid());

drop policy if exists player\_cards\_admin on public.player\_cards;
create policy player\_cards\_admin on public.player\_cards
  for select using (public.is\_admin());

-- Card summaries for everyone in a group the caller belongs to. SECURITY DEFINER +
-- is\_group\_member gate (mirrors group\_roster / group\_badges). Honors show\_card.
drop function if exists public.group\_cards(uuid);
create or replace function public.group\_cards(p\_group uuid)
returns table (user\_id uuid, idx numeric, idx\_trend numeric, form jsonb, rounds int)
language sql security definer set search\_path = public as $$
  select pc.user\_id, pc.idx, pc.idx\_trend, pc.form, pc.rounds
  from public.player\_cards pc
  join public.group\_members gm
    on gm.user\_id = pc.user\_id and gm.group\_id = p\_group and gm.status = 'active'
  join public.profiles pr on pr.id = pc.user\_id
  where public.is\_group\_member(p\_group, auth.uid())
    and coalesce(pr.show\_card, true) = true;
$$;
grant execute on function public.group\_cards(uuid) to authenticated;
```

### v1.128.0 — card opt-out + member contact (migration 0081)

Client + one migration. `CardVisibilityToggle` (writes `profiles.show\_card`) under the self-card:
hides only the performance layer from peers. Peer card gains a `ContactBar` — phone Call/Text when a
number is on file, plus an always-available PII-free nudge via `send\_nudge` (shared-club gate, 6h
per-pair dedup, in-app notification type `nudge`). Roster taps pass `viewerUserId` so you don't nudge
yourself. Run 0081:

```sql
-- 0081\_nudges.sql
-- Member-to-member "reach out" nudge. create\_notification deliberately blocks
-- regular member->member notifications, so this dedicated SECURITY DEFINER RPC
-- gates on shared-club membership, dedupes per (sender, recipient) over 6h, and
-- drops an in-app notification (which the push webhook picks up). No PII shared —
-- the recipient just sees who reached out. Safe to run multiple times.

create table if not exists public.nudges (
  id           uuid primary key default gen\_random\_uuid(),
  sender\_id    uuid not null references auth.users(id) on delete cascade,
  recipient\_id uuid not null references auth.users(id) on delete cascade,
  group\_id     uuid,
  message      text,
  created\_at   timestamptz not null default now()
);
create index if not exists nudges\_pair\_time on public.nudges (sender\_id, recipient\_id, created\_at desc);

alter table public.nudges enable row level security;
-- Inserts happen only through send\_nudge (SECURITY DEFINER); clients may read their own.
drop policy if exists nudges\_own on public.nudges;
create policy nudges\_own on public.nudges
  for select using (sender\_id = auth.uid() or recipient\_id = auth.uid());

-- Returns 'sent' | 'too\_soon'. Raises on bad input / not-in-club.
drop function if exists public.send\_nudge(uuid, uuid, text);
create or replace function public.send\_nudge(p\_recipient uuid, p\_group uuid, p\_message text default null)
returns text
language plpgsql security definer set search\_path = public as $fn$
declare
  v\_sender uuid := auth.uid();
  v\_name   text;
  v\_clean  text;
  v\_msg    text;
begin
  if v\_sender is null then raise exception 'not authenticated'; end if;
  if p\_recipient is null or p\_group is null then raise exception 'recipient and club are required'; end if;
  if p\_recipient = v\_sender then raise exception 'cannot nudge yourself'; end if;

  -- caller must belong to the club; recipient must be an active member of it
  if not public.is\_group\_member(p\_group, v\_sender) then raise exception 'not a member of this club'; end if;
  if not exists (
    select 1 from group\_members
    where group\_id = p\_group and user\_id = p\_recipient and status = 'active'
  ) then raise exception 'that player is not in this club'; end if;

  -- at most one nudge per (sender, recipient) per 6h
  if exists (
    select 1 from nudges n
    where n.sender\_id = v\_sender and n.recipient\_id = p\_recipient
      and n.created\_at > now() - interval '6 hours'
  ) then return 'too\_soon'; end if;

  select coalesce(display\_name, 'A club member') into v\_name from profiles where id = v\_sender;
  v\_clean := nullif(btrim(coalesce(p\_message, '')), '');
  v\_msg := '👋 ' || v\_name || ' wants to connect';
  if v\_clean is not null then v\_msg := v\_msg || ': ' || left(v\_clean, 140); end if;

  insert into nudges (sender\_id, recipient\_id, group\_id, message)
  values (v\_sender, p\_recipient, p\_group, left(coalesce(v\_clean, ''), 140));

  insert into notifications (user\_id, message, group\_id, type, link)
  values (p\_recipient, v\_msg, p\_group, 'nudge', '/?tab=players');

  return 'sent';
end $fn$;
grant execute on function public.send\_nudge(uuid, uuid, text) to authenticated;
```

### v1.129.0 — dashboard achievements teaser (NO migration)

Client only. `AchievementsTeaser` (compact strip: recent-badge peek row + earned count) renders on the
dashboard right after the AI coach. Tapping it switches to the Profile tab and smooth-scrolls to the
achievements wall (`#achievements-wall`). The wall now leads with a 'Next up' milestone progress bar
(next rounds-played target from `rounds.length`; hidden once 100+ rounds). Dashboard gained an
`onViewAchievements` prop wired from home.

### v1.129.1 — player-card formatting fix + contextual form chart (NO migration)

Client only. (1) Replaced literal \\uXXXX escapes with real glyphs in player-card.tsx / achievements.tsx
(they render verbatim in JSX text). Fixed a pre-existing one in tee-times.tsx:373 too. Added
`ci/check-jsx-escapes.py` — now run before every package. (2) Reworked the card's recent-form line into
a contextual `FormChart`: differential y-scale labels (best/worst in window), a gold average baseline,
a dot per round with the current value called out, and a plain-language verdict (Trending down/up/holding).

### v1.130.0 — badges on round detail + accurate peer round count (migration 0082)

(1) RoundDetail now shows a 'Badges earned this round' strip — `badgesForRound(finished, roundId)`
replays chronologically and returns exactly what that round produced (uses the `priorRounds` prop
already passed in; 'new record' tag on record-setting bests).
(2) Peer card showed 0 rounds for members who hadn't synced a summary yet. `group\_cards` is
redefined to return a row for EVERY active member (LEFT JOIN player\_cards) and count rounds LIVE
from the rounds table (deleted\_at is null, status <> in\_progress). Self-contained migration. Run 0082:

```sql
-- 0082\_group\_cards\_live\_rounds.sql
-- Robust peer card: return a row for EVERY active club member (even before they've
-- synced a summary) and compute rounds-played LIVE from rounds, so the count is always
-- accurate instead of depending on the lazy player\_cards write (which was showing 0 for
-- members who hadn't opened the app yet). Self-contained: (re)creates player\_cards +
-- policies idempotently, so it works whether or not 0080 was run. Safe to run repeatedly.

create table if not exists public.player\_cards (
  user\_id    uuid primary key references auth.users(id) on delete cascade,
  idx        numeric,
  idx\_trend  numeric,
  form       jsonb not null default '\[]'::jsonb,
  rounds     int   not null default 0,
  updated\_at timestamptz not null default now()
);
alter table public.player\_cards enable row level security;
drop policy if exists player\_cards\_own on public.player\_cards;
create policy player\_cards\_own on public.player\_cards
  for all using (user\_id = auth.uid()) with check (user\_id = auth.uid());
drop policy if exists player\_cards\_admin on public.player\_cards;
create policy player\_cards\_admin on public.player\_cards
  for select using (public.is\_admin());

drop function if exists public.group\_cards(uuid);
create or replace function public.group\_cards(p\_group uuid)
returns table (user\_id uuid, idx numeric, idx\_trend numeric, form jsonb, rounds int)
language sql security definer set search\_path = public as $$
  select gm.user\_id,
         pc.idx,
         pc.idx\_trend,
         coalesce(pc.form, '\[]'::jsonb) as form,
         (select count(\*)::int from rounds r
            where r.user\_id = gm.user\_id
              and r.deleted\_at is null
              and coalesce(r.status, 'final') <> 'in\_progress') as rounds
  from group\_members gm
  join profiles pr on pr.id = gm.user\_id
  left join player\_cards pc on pc.user\_id = gm.user\_id
  where gm.group\_id = p\_group and gm.status = 'active'
    and public.is\_group\_member(p\_group, auth.uid())
    and coalesce(pr.show\_card, true) = true;
$$;
grant execute on function public.group\_cards(uuid) to authenticated;
```

### v1.131.0 — stale-round auto-finish + profile-nudge funnel (migration 0083)

(A) Auto-finish: `finish\_stale\_rounds()` finalizes stale-but-complete in-progress rounds (18+ holes,
24h+), skips abandoned partials, self-throttled hourly, attributed 'system:auto'. Called best-effort on
app open (home.tsx); manual finishes now set finished\_by=user + finished\_at.
(B) Funnel: the profile-completion banner logs `profile\_nudge\_shown` (once/session) + `profile\_nudge\_clicked`.
`get\_ops\_metrics()` + an admin Operations panel show the funnel, incomplete profiles, and stale/auto counts.
Nudge counts accumulate from deploy forward; incomplete/stale counts are live. Run 0083:

```sql
-- 0083\_ops\_autofinish\_and\_funnel.sql
-- Two operational features:
--   (A) Auto-finish stale-but-complete in-progress rounds so a forgotten "finish" tap
--       doesn't keep a real round out of the player's handicap. Abandoned partials are
--       left alone. Every finalize (manual or auto) is now attributed.
--   (B) Admin ops metrics: profile-completion nudge funnel + stale-round + incomplete
--       profile counts.
-- Safe to run multiple times.

-- (A1) Attribution for round finalization.
alter table public.rounds add column if not exists finished\_by text;       -- member uuid (as text) or 'system:auto'
alter table public.rounds add column if not exists finished\_at timestamptz;

-- (A2) Throttle registry so the global sweep runs at most hourly no matter how many
--      app-opens call it. Touched only by SECURITY DEFINER functions.
create table if not exists public.system\_jobs (
  job      text primary key,
  last\_run timestamptz not null default now()
);
alter table public.system\_jobs enable row level security;

-- (A3) Finalize stale (24h+), COMPLETE (18+ holes scored) in-progress rounds. Partial
--      abandons are skipped. Self-throttled to once/hour. Attributed 'system:auto'.
create or replace function public.finish\_stale\_rounds()
returns int
language plpgsql security definer set search\_path = public as $fn$
declare
  v\_last  timestamptz;
  v\_count int := 0;
begin
  select last\_run into v\_last from system\_jobs where job = 'finish\_stale\_rounds';
  if v\_last is not null and v\_last > now() - interval '1 hour' then
    return 0;                                   -- ran recently; skip the sweep
  end if;
  insert into system\_jobs (job, last\_run) values ('finish\_stale\_rounds', now())
    on conflict (job) do update set last\_run = now();

  with eligible as (
    select r.id,
           (select sum(h.strokes) from holes h where h.round\_id = r.id and h.strokes is not null) as gross,
           (select count(\*)       from holes h where h.round\_id = r.id and h.strokes is not null) as scored
    from rounds r
    where coalesce(r.status, 'final') = 'in\_progress'
      and r.deleted\_at is null
      and r.created\_at < now() - interval '24 hours'
  ), done as (
    update rounds r
       set status      = 'final',
           finished\_by = 'system:auto',
           finished\_at = now(),
           gross\_score = coalesce(r.gross\_score, e.gross),
           played\_at   = coalesce(r.played\_at, r.created\_at::date)
      from eligible e
     where r.id = e.id and e.scored >= 18
    returning r.id
  )
  select count(\*) into v\_count from done;
  return v\_count;
end $fn$;
grant execute on function public.finish\_stale\_rounds() to authenticated;

-- (B) Admin ops metrics (nudge funnel + stale/ incomplete counts). is\_admin-gated.
create or replace function public.get\_ops\_metrics()
returns jsonb
language sql security definer set search\_path = public as $fn$
  select case when not public.is\_admin() then '{}'::jsonb else jsonb\_build\_object(
    'nudge\_shown\_7d',    (select count(\*) from activity\_log where action = 'profile\_nudge\_shown'   and created\_at > now() - interval '7 days'),
    'nudge\_clicked\_7d',  (select count(\*) from activity\_log where action = 'profile\_nudge\_clicked' and created\_at > now() - interval '7 days'),
    'nudge\_shown\_28d',   (select count(\*) from activity\_log where action = 'profile\_nudge\_shown'   and created\_at > now() - interval '28 days'),
    'nudge\_clicked\_28d', (select count(\*) from activity\_log where action = 'profile\_nudge\_clicked' and created\_at > now() - interval '28 days'),
    'profiles\_incomplete', (select count(\*) from profiles
                              where coalesce(deactivated, false) = false
                                and (avatar\_url is null or handicap\_index is null)),
    'stale\_ready',   (select count(\*) from rounds r
                        where coalesce(r.status,'final') = 'in\_progress' and r.deleted\_at is null
                          and r.created\_at < now() - interval '24 hours'
                          and (select count(\*) from holes h where h.round\_id = r.id and h.strokes is not null) >= 18),
    'stale\_partial', (select count(\*) from rounds r
                        where coalesce(r.status,'final') = 'in\_progress' and r.deleted\_at is null
                          and r.created\_at < now() - interval '24 hours'
                          and (select count(\*) from holes h where h.round\_id = r.id and h.strokes is not null) < 18),
    'auto\_finished\_7d', (select count(\*) from rounds where finished\_by = 'system:auto' and finished\_at > now() - interval '7 days')
  ) end;
$fn$;
grant execute on function public.get\_ops\_metrics() to authenticated;
```

### v1.131.1 — FIX: duplicate in-progress rounds (no migration)

Root cause (confirmed from real data — one user produced 34 in\_progress rows for a single
Pinch Brook round over 2.5h): `RoundEditor.backgroundSave` inserted a NEW in\_progress row
whenever its in-memory round id (`dbIdRef`) was empty. On an iOS PWA the id often didn't
survive a screen lock (it's set async after the insert, so a lock before it completed saved
the draft with an empty id → the next cold-start reload re-inserted), and the 2-3 lock-flush
events iOS fires at once raced the non-atomic `if(!rid)` guard (→ paired same-microsecond rows).
Fix: new `ensureRoundId()` — (1) serializes creation via an in-flight promise ref so racing
saves await the same insert; (2) ADOPTS an existing in\_progress row for the same user+course
created in the last 12h before inserting a new one; (3) persists the id into the local draft
immediately. Net: one row per round session regardless of locks/reloads.
**Verify after deploy:** re-run the complete/partial stuck counts — new rounds should create \~1
in\_progress row, not a ladder.

**One-time cleanup of existing duplicates** (soft-delete; keeps the most-scored row per
user+course+day so any real round stays resumable). PREVIEW first, then run the UPDATE:

```sql
-- PREVIEW: rows that WOULD be soft-deleted (rn>1 = duplicates, keeping the best per cluster)
with ranked as (
  select r.id, r.course, r.created\_at,
         (select count(\*) from holes h where h.round\_id=r.id and h.strokes is not null) as scored,
         row\_number() over (partition by r.user\_id, r.course, r.created\_at::date
           order by (select count(\*) from holes h where h.round\_id=r.id and h.strokes is not null) desc,
                    r.created\_at desc) as rn
  from rounds r
  where coalesce(r.status,'final')='in\_progress' and r.deleted\_at is null)
select \* from ranked where rn > 1 order by course, created\_at;

-- APPLY: soft-delete the duplicates
with ranked as (
  select r.id,
         row\_number() over (partition by r.user\_id, r.course, r.created\_at::date
           order by (select count(\*) from holes h where h.round\_id=r.id and h.strokes is not null) desc,
                    r.created\_at desc) as rn
  from rounds r
  where coalesce(r.status,'final')='in\_progress' and r.deleted\_at is null)
update rounds set deleted\_at = now() where id in (select id from ranked where rn > 1);
```

### v1.132.0 — built-in round-save diagnostics (verify before trusting the fix)

Adds an opt-in, per-device diagnostics panel (admin → Manage → Round-save diagnostics) so the
duplicate-in\_progress bug can be REPRODUCED and the fix CONFIRMED on a real phone before we rely on it.

* `lib/debuglog.ts`: localStorage-backed event log (survives PWA reload/cold-start, which the bug
involves) + two per-device flags. All a no-op unless logging is enabled — zero overhead for players.
* RoundEditor now logs: `mount` (what id it started with), every `ensure` decision
(reuse / adopt / insert / await\_inflight / legacy\_insert), and every `flush` (which lock event fired).
* Toggle **Reproduce bug (disable dedupe)** runs the ORIGINAL blind-insert path (no adopt, no
serialization) on that device only, so the ladder of inserts can be produced on purpose.
* The dedupe FIX (adopt existing row within 12h + in-flight insert serialization + immediate id
persistence) from v1.131.1 is the DEFAULT path (reproduce off), so shipping this protects all users
while letting the admin verify.
No migration. Procedure: deploy → admin Manage → Round-save diagnostics → Logging ON → Reproduce ON →
score a few holes locking the phone between each → expect multiple red `insert` lines for one round →
Reproduce OFF → rescore → expect one insert + green adopt/reuse. Then run the v1.131.1 cleanup SQL.

### v1.133.0 — consolidated Admin tab (no migration)

All admin surfaces moved out of Profile and the scattered More-menu entries into ONE Admin tab
with two tiers. Reuses every existing panel unchanged — no logic rewritten, no migration.

* New `AdminHome` (components/manage.tsx, exported): card index + inline sub-view router.

  * Tier 1 — Club admin (shown when activeGroup.role==='admin', scoped to that club): Members and
Club settings, which JUMP to the existing Players / Clubs tabs (no duplication).
  * Tier 2 — System / Super admin (profile.is\_admin only): Analytics (AdminAnalytics+AdminEngagement),
Operations (OpsMetrics), Activity log (ActivityTab), Clubs oversight (AdminGroupsTab), Users
(AdminUsersTab), Player admin (AdminPanel with new showAnalytics={false}), Feedback
(AdminFeedbackTab), Diagnostics (RoundSaveDiag), System tools (test-account toggle + YardageBackfill).
* Removed the four ★ More-menu tabs (Activity/Oversight/Users/Feedback) and the admin block + test
toggle from ProfilePanel; Profile is now player-only. Nav shows a single 'Admin ★' entry when the
user is a club admin OR master admin.
* `AdminPanel` gained `showAnalytics` (default true) so its analytics header isn't duplicated when
rendered as the Player-admin sub-view.
Note: Users / Player admin / Clubs oversight retain some historical overlap (kept intact to avoid a
risky governance refactor); can be rationalized later.

### v1.134.0 — attention badges on Admin tiles (migration 0084)

`get\_admin\_todos()` (is\_admin) returns {pending\_clubs, new\_feedback, pending\_course\_edits, stale\_ready}.
AdminHome fetches it once and shows a gold number badge on the tiles that have a to-do you can action
from that tile: Clubs oversight (pending\_clubs), Feedback (new\_feedback), Operations (stale\_ready).
Player-admin badge intentionally deferred to the governance dedup (its queue has no clean home yet).
pending\_course\_edits is returned now for the dedup's Courses screen. Run 0084:

```sql
-- 0084\_admin\_todos.sql
-- Counts that drive the "needs attention" number badges on the Admin hub tiles.
-- is\_admin-gated; returns {} for non-master callers. Safe to run multiple times.
-- pending\_course\_edits is included now so the dedup's Courses screen can badge it later.
create or replace function public.get\_admin\_todos()
returns jsonb
language sql security definer set search\_path = public as $fn$
  select case when not public.is\_admin() then '{}'::jsonb else jsonb\_build\_object(
    'pending\_clubs',        (select count(\*) from groups where status = 'pending'),
    'new\_feedback',         (select count(\*) from feedback where status = 'new'),
    'pending\_course\_edits', (select count(\*) from course\_change\_requests where status = 'pending'),
    'stale\_ready',          (select count(\*) from rounds r
                               where coalesce(r.status,'final') = 'in\_progress' and r.deleted\_at is null
                                 and r.created\_at < now() - interval '24 hours'
                                 and (select count(\*) from holes h where h.round\_id = r.id and h.strokes is not null) >= 18)
  ) end;
$fn$;
grant execute on function public.get\_admin\_todos() to authenticated;
```

### v1.135.0 — manual per-hole yardage entry in the course editor (no migration)

Previously the course editor's per-tee 'Yards' was display-only (sum of tees\[].yardages, '—' when
unset); the only manual entry lived in the master-admin Yardage Backfill tool. So a club admin who
added a tee the API didn't know had no way to enter its yardages.
Fix: the 'Yards' cell on each tee row is now a button that expands a per-hole yardage grid for that
tee (writes tees\[].yardages). Available to anyone who can edit the course (same permission as
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

`admin\_list\_users.rounds\_count` counted ALL rows in `rounds` (incl. soft-deleted + in-progress), so a
user with phantom duplicates showed an inflated count (Nihar: 38) that disagreed with the player card
(3). Now filtered to real rounds (deleted\_at is null, status <> in\_progress) to match the card and the
rest of the app. Pure function fix, no data change. Run 0085:

```sql
-- 0085\_admin\_list\_users\_real\_rounds.sql
-- Fix: admin\_list\_users.rounds\_count counted ALL rows in `rounds` for a user, including
-- soft-deleted (deleted\_at not null) and in-progress rounds. A user with phantom/duplicate
-- in-progress rows or soft-deleted rounds therefore showed an inflated count in Admin ->
-- Users (e.g. 38) that disagreed with the player card's real-round count (e.g. 3).
-- Align the count with the app's standard real-round definition used everywhere else:
-- not deleted, and not in-progress. Pure function fix; no data changes. Safe to re-run.
create or replace function public.admin\_list\_users()
returns table (
  id uuid, display\_name text, email text, is\_admin boolean, banned boolean,
  handicap\_index numeric, group\_count int, rounds\_count int
)
language sql security definer set search\_path = public as $$
  select p.id, p.display\_name, p.email, p.is\_admin, coalesce(p.banned, false),
         p.handicap\_index,
         (select count(\*) from group\_members gm where gm.user\_id = p.id and gm.status = 'active')::int,
         (select count(\*) from rounds r
            where r.user\_id = p.id
              and r.deleted\_at is null
              and coalesce(r.status, 'final') <> 'in\_progress')::int
  from profiles p
  where public.is\_admin()
  order by p.display\_name nulls last;
$$;
grant execute on function public.admin\_list\_users() to authenticated;
```

KNOWN SIBLING (flagged, not yet fixed): the GROUP-level rounds\_count in admin group oversight
(migrations 0027/0028/0030, `count(\*) from rounds where group\_id=g.id`) has the same missing filter,
so per-club round totals in Clubs oversight are similarly inflated. Fix pending owner go-ahead.

### v1.135.3 — FIX: Clubs oversight per-club round count (migration 0086)

Sibling of 0085: admin\_group\_overview.rounds\_count counted soft-deleted + in-progress rounds, inflating
per-club totals; the last\_activity round lookup did too. Both now filtered to real rounds. Run 0086:

```sql
-- 0086\_admin\_group\_overview\_real\_rounds.sql
-- Fix (sibling of 0085): admin\_group\_overview.rounds\_count counted ALL rows in `rounds`
-- for a club, including soft-deleted + in-progress, inflating per-club round totals in
-- Clubs oversight. Also filter the last\_activity round lookup so a deleted/in-progress
-- round doesn't register as club activity. Real-round definition matches the rest of the
-- app: deleted\_at is null AND status <> 'in\_progress'. Pure function fix; no data change.
create or replace function public.admin\_group\_overview()
returns table (
  group\_id uuid, name text, status text,
  admin\_names text, member\_count int, rounds\_count int, games\_count int,
  last\_activity timestamptz, my\_support boolean, is\_default boolean
)
language sql security definer set search\_path = public
as $$
  select
    g.id, g.name, coalesce(g.status, 'active') as status,
    (select string\_agg(coalesce(p.display\_name, gm2.email, 'admin'), ', ')
       from group\_members gm2 left join profiles p on p.id = gm2.user\_id
       where gm2.group\_id = g.id and gm2.role = 'admin' and gm2.status = 'active'
         and gm2.is\_support = false) as admin\_names,
    (select count(\*) from group\_members gm where gm.group\_id = g.id and gm.status = 'active' and gm.is\_support = false)::int as member\_count,
    (select count(\*) from rounds r
       where r.group\_id = g.id and r.deleted\_at is null
         and coalesce(r.status, 'final') <> 'in\_progress')::int as rounds\_count,
    (select count(\*) from games ga where ga.group\_id = g.id)::int as games\_count,
    greatest(
      coalesce((select max(r.played\_at) from rounds r
                  where r.group\_id = g.id and r.deleted\_at is null
                    and coalesce(r.status, 'final') <> 'in\_progress'), 'epoch'::timestamptz),
      coalesce((select max(ga.created\_at) from games ga where ga.group\_id = g.id), 'epoch'::timestamptz),
      coalesce(g.created\_at, 'epoch'::timestamptz)
    ) as last\_activity,
    exists (select 1 from group\_members gm3
            where gm3.group\_id = g.id and gm3.user\_id = auth.uid() and gm3.is\_support = true) as my\_support,
    coalesce(g.is\_default, false) as is\_default
  from groups g
  where public.is\_admin()
  order by last\_activity desc;
$$;
grant execute on function public.admin\_group\_overview() to authenticated;
```

### v1.135.4 — engagement analytics count real rounds only (migration 0087)

Audit of round-counting after 0085/0086: get\_admin\_analytics (0068) was already correct (final,
non-deleted, test excluded). get\_admin\_engagement (0078) filtered deleted\_at but NOT in-progress, so
unfinished rounds (which carry played\_at) inflated WAU/MAU, weekend reach/share, new-vs-returning, and
the game/solo split. 0087 recreates it excluding in-progress everywhere. Full SQL posted in chat / here.
OBSERVATION (not changed): get\_admin\_engagement does not exclude test accounts (get\_admin\_analytics
does). Left as-is pending owner decision — flag only.

### v1.136.0 — FEATURE: Power Users analytics (migration 0088)

New super-admin Analytics section: top 25 users by composite engagement score, with every metric
shown individually and tap-to-sort on any column, an All-time / 90-day window toggle, and friction
(kept starting rounds that didn't finish) + quiet (no activity 30d+) badges — directly answering
'did engaged users try, hit breakage, and give up?'. Reuses daily\_active/rounds/game\_players; no new
tracking tables. New RPC get\_power\_users(p\_days); component AdminPowerUsers in manage.tsx, rendered
under the Analytics view. Run 0088:

```sql
-- 0088\_power\_users.sql
-- Super-admin analytics: top users by a composite engagement score, with every underlying
-- metric exposed individually (client re-sorts) plus friction/churn signals that answer
-- "did engaged users try, hit breakage, and give up?".
--
-- Composite score = completed\*4 + games\*2 + active\_days\*1 + opens\*0.1
--   completed rounds are the real unit of value; opens are noisy so weighted low.
-- Friction flag: >=3 abandoned/deleted attempts AND completion rate < 60% (kept starting
--   rounds that never finalized — the phantom-round-bug signature).
-- Churn flag: no activity in > 30 days (or never active).
--
-- All metrics honor the window param: p\_days null = all-time; e.g. 90 = last 90 days.
-- Real-round definition matches the rest of the app: deleted\_at is null AND status<>'in\_progress'.
-- Test + deactivated accounts excluded. is\_admin() gate returns zero rows to non-admins.
create or replace function public.get\_power\_users(p\_days int default null)
returns table (
  user\_id uuid,
  display\_name text,
  completed\_rounds int,
  unfinished\_rounds int,
  deleted\_rounds int,
  games\_played int,
  active\_days int,
  total\_opens int,
  completion\_pct int,
  last\_active date,
  days\_since\_active int,
  churned boolean,
  friction boolean,
  score numeric
)
language sql security definer set search\_path = public as $$
  with base as (
    select p.id, p.display\_name, p.last\_active
    from profiles p
    where public.is\_admin()
      and coalesce(p.is\_test, false) = false
      and coalesce(p.deactivated, false) = false
  ),
  rc as (
    select r.user\_id,
      count(\*) filter (where r.deleted\_at is null and coalesce(r.status,'final') <> 'in\_progress'
                        and (p\_days is null or r.played\_at > current\_date - p\_days))                         as completed,
      count(\*) filter (where r.deleted\_at is null and coalesce(r.status,'final') = 'in\_progress'
                        and (p\_days is null or r.created\_at > now() - make\_interval(days => p\_days)))         as unfinished,
      count(\*) filter (where r.deleted\_at is not null
                        and (p\_days is null or r.created\_at > now() - make\_interval(days => p\_days)))         as deleted
    from rounds r
    group by r.user\_id
  ),
  gp as (
    select gpl.user\_id, count(\*) as games
    from game\_players gpl
    join games g on g.id = gpl.game\_id
    where (p\_days is null or g.created\_at > now() - make\_interval(days => p\_days))
    group by gpl.user\_id
  ),
  da as (
    select user\_id, count(\*) as active\_days, coalesce(sum(opens), 0) as opens
    from daily\_active
    where (p\_days is null or day > current\_date - p\_days)
    group by user\_id
  )
  select
    b.id,
    b.display\_name,
    coalesce(rc.completed, 0)::int,
    coalesce(rc.unfinished, 0)::int,
    coalesce(rc.deleted, 0)::int,
    coalesce(gp.games, 0)::int,
    coalesce(da.active\_days, 0)::int,
    coalesce(da.opens, 0)::int,
    case when coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0) > 0
         then round(100.0 \* coalesce(rc.completed,0)
                    / (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)))::int
         else null end,
    b.last\_active::date,
    case when b.last\_active is null then null else (current\_date - b.last\_active::date) end,
    case when b.last\_active is null then true else (current\_date - b.last\_active::date) > 30 end,
    (coalesce(rc.unfinished,0) + coalesce(rc.deleted,0) >= 3
      and (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)) > 0
      and 100.0 \* coalesce(rc.completed,0)
          / (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)) < 60),
    (coalesce(rc.completed,0) \* 4 + coalesce(gp.games,0) \* 2 + coalesce(da.active\_days,0) \* 1
      + coalesce(da.opens,0) \* 0.1)::numeric
  from base b
  left join rc on rc.user\_id = b.id
  left join gp on gp.user\_id = b.id
  left join da on da.user\_id = b.id
  order by score desc nulls last
  limit 25;
$$;
grant execute on function public.get\_power\_users(int) to authenticated;
```

### v1.136.1 — FIX: 0088 ORDER BY alias

get\_power\_users failed at deploy with 'column "score" does not exist' — the composite expression
lacked an alias, so ORDER BY score couldn't resolve it in the RETURNS TABLE function. Added `as score`.
No app-code change. Corrected 0088:

```sql
-- 0088\_power\_users.sql
-- Super-admin analytics: top users by a composite engagement score, with every underlying
-- metric exposed individually (client re-sorts) plus friction/churn signals that answer
-- "did engaged users try, hit breakage, and give up?".
--
-- Composite score = completed\*4 + games\*2 + active\_days\*1 + opens\*0.1
--   completed rounds are the real unit of value; opens are noisy so weighted low.
-- Friction flag: >=3 abandoned/deleted attempts AND completion rate < 60% (kept starting
--   rounds that never finalized — the phantom-round-bug signature).
-- Churn flag: no activity in > 30 days (or never active).
--
-- All metrics honor the window param: p\_days null = all-time; e.g. 90 = last 90 days.
-- Real-round definition matches the rest of the app: deleted\_at is null AND status<>'in\_progress'.
-- Test + deactivated accounts excluded. is\_admin() gate returns zero rows to non-admins.
create or replace function public.get\_power\_users(p\_days int default null)
returns table (
  user\_id uuid,
  display\_name text,
  completed\_rounds int,
  unfinished\_rounds int,
  deleted\_rounds int,
  games\_played int,
  active\_days int,
  total\_opens int,
  completion\_pct int,
  last\_active date,
  days\_since\_active int,
  churned boolean,
  friction boolean,
  score numeric
)
language sql security definer set search\_path = public as $$
  with base as (
    select p.id, p.display\_name, p.last\_active
    from profiles p
    where public.is\_admin()
      and coalesce(p.is\_test, false) = false
      and coalesce(p.deactivated, false) = false
  ),
  rc as (
    select r.user\_id,
      count(\*) filter (where r.deleted\_at is null and coalesce(r.status,'final') <> 'in\_progress'
                        and (p\_days is null or r.played\_at > current\_date - p\_days))                         as completed,
      count(\*) filter (where r.deleted\_at is null and coalesce(r.status,'final') = 'in\_progress'
                        and (p\_days is null or r.created\_at > now() - make\_interval(days => p\_days)))         as unfinished,
      count(\*) filter (where r.deleted\_at is not null
                        and (p\_days is null or r.created\_at > now() - make\_interval(days => p\_days)))         as deleted
    from rounds r
    group by r.user\_id
  ),
  gp as (
    select gpl.user\_id, count(\*) as games
    from game\_players gpl
    join games g on g.id = gpl.game\_id
    where (p\_days is null or g.created\_at > now() - make\_interval(days => p\_days))
    group by gpl.user\_id
  ),
  da as (
    select user\_id, count(\*) as active\_days, coalesce(sum(opens), 0) as opens
    from daily\_active
    where (p\_days is null or day > current\_date - p\_days)
    group by user\_id
  )
  select
    b.id,
    b.display\_name,
    coalesce(rc.completed, 0)::int,
    coalesce(rc.unfinished, 0)::int,
    coalesce(rc.deleted, 0)::int,
    coalesce(gp.games, 0)::int,
    coalesce(da.active\_days, 0)::int,
    coalesce(da.opens, 0)::int,
    case when coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0) > 0
         then round(100.0 \* coalesce(rc.completed,0)
                    / (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)))::int
         else null end,
    b.last\_active::date,
    case when b.last\_active is null then null else (current\_date - b.last\_active::date) end,
    case when b.last\_active is null then true else (current\_date - b.last\_active::date) > 30 end,
    (coalesce(rc.unfinished,0) + coalesce(rc.deleted,0) >= 3
      and (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)) > 0
      and 100.0 \* coalesce(rc.completed,0)
          / (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)) < 60),
    (coalesce(rc.completed,0) \* 4 + coalesce(gp.games,0) \* 2 + coalesce(da.active\_days,0) \* 1
      + coalesce(da.opens,0) \* 0.1)::numeric as score
  from base b
  left join rc on rc.user\_id = b.id
  left join gp on gp.user\_id = b.id
  left join da on da.user\_id = b.id
  order by score desc nulls last
  limit 25;
$$;
grant execute on function public.get\_power\_users(int) to authenticated;
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
safe-area insets, and the real rects of the shell + nav, then reports GAP\_below\_nav = innerHeight -
nav.bottom. Copy button dumps JSON. Once we have the numbers the fix is deterministic.

### v1.136.4 — DIAGNOSTIC: viewport panel reacts to the toggle live (no migration)

ViewportDiag read diagEnabled() once at mount; since it lives on the always-mounted Home shell,
enabling the toggle mid-session didn't surface it without a full reload. Now polls the flag every 800ms
so toggling on/off in Admin -> Diagnostics shows/hides the panel within a second. No reload needed.

### v1.136.5 — FIX: bottom-of-screen gap below the nav (no migration)

Root cause found via the viewport diag + a screenshot: the position:fixed;inset:0 body from 1.136.2
(added to kill the bounce) made iOS resolve the SMALL viewport (svh = 894 on the test device) for the
body, which stops 62px short of the real screen (lvh = 956) — that shortfall was the green gap below
the nav. GAP\_below\_nav read 0 because it compared against innerHeight/svh (894), not the true screen.
Fix (app/globals.css, new): html/body locked with overflow:hidden + overscroll-behavior:none; body
position:fixed sized to height:100lvh (fallback 100vh) so it fills the FULL screen; padding-top keeps
content below the black-translucent status bar. Shell height switched from calc(100dvh - safeTop) to
100% so it fills the body content box exactly. Bounce stays fixed; nav now reaches the physical bottom.
After deploy the diag should show bodyH \~956 and navBottom \~956 (GAP\_below\_nav will read \~-62 because
that metric still references svh/innerHeight; the negative just means the nav now extends past svh to
the real bottom — visually correct).

### v1.136.6 — FIX: nav pushed off-screen by 1.136.5 (no migration)

1.136.5 sized the shell with height:100%, but a wrapper sits between <body> and the shell without a
fixed height, so the percentage fell back to auto and the shell grew to its full content height
(diag: shellH 2913, navBottom 2975) — nav off the bottom of the screen. Also bodyH read 1018 =
100lvh + padding-top (padding was outside the height). Fix: shell now sized with a viewport unit via
the .app-shell class (100lvh, fallback 100vh) so it's independent of the parent chain; top safe-area
padding moved INTO the shell with box-sizing:border-box (no overflow); body padding-top removed.
Expected diag now: bodyH \~956, shellH \~956, navBottom \~956; GAP\_below\_nav \~-62 (references svh, fine).

### v1.136.7 — FIX: robust height for browser + installed; icon-clip cushion (no migration)

Made the shell height context-aware instead of one-size: the installed app (display-mode:standalone)
uses 100lvh (stable full glass, the known-good value from 1.136.6); a browser tab uses a LIVE
JS-measured height (--app-h = visualViewport.height, published by new components/viewport-sync.tsx)
that tracks Safari's toolbar so the nav stays pinned to the visible bottom instead of hiding behind it.
Also added an 8px cushion to the nav's bottom padding so the icon labels are no longer clipped at the
screen edge. Diag now reports mode (installed/browser), vvOffsetTop, the --app-h var, and
navBottom\_vs\_visible (should be \~0 = nav flush to the visible bottom in BOTH contexts).

### v1.137.0 — FEATURE: Analytics name-level drill-down, STAGE 1 (migrations 0089, 0090)

Additive — nothing removed from the existing Analytics tab. New shared drill engine: every stat is a
button that opens one reusable bottom-sheet (StatDrawerHost) listing the exact users behind the number,
fetched from the is\_admin-gated admin\_stat\_users(stat,arg,date) RPC (uniform name/detail/tag rows).
STAGE 1 wires drill-down onto the existing stats: Total users, Rounds done, DAU/WAU/MAU, Lapsed, Round
completion, Abandoned, New-users, Never-joined-a-club, and the Avatars/AI feature bars. The engine
already includes branches for the stage-2/3 stats (installed/browser, notif on/off, failing subs, mutes,
sharing, guests, daily active/rounds) so those stages are client-only.
Also: install-vs-browser capture is LIVE (0089) — mark\_active(p\_standalone) records each user's latest
open mode into profiles.last\_standalone; home.tsx now passes display-mode. Forward-only, no backfill.
Run 0089 then 0090 (full SQL posted in chat).
STAGE 2 (next): new summary tiles. STAGE 3: Daily report.

### v1.138.0 — FEATURE: Analytics stage 2 — new drillable tiles (migration 0091; 0090 corrected)

New AdminExtraStats section under Analytics: Platform (installed vs browser), Notifications (on/off,
failing/stale devices, most-muted types), Profile sharing (on/off), Guests — each tile drills to the
named users via the shared engine. Counts from get\_admin\_extra\_stats (0091).
CORRECTION to 0090 (re-run it — create-or-replace, safe): push\_prefs values are 'push'|'inapp'|'off',
not true/false, so the mute drill now matches value='off', and notifications on/off is based purely on
having an active push\_subscription (no vestigial \_master). Run order: 0089, 0090 (corrected), 0091.
STAGE 3 next: Daily report (date-driven active users + rounds; engine branches already present).

### v1.139.0 — FEATURE: Analytics stage 3 — Daily report (NO migration)

Client-only; reuses engine branches active\_day / rounds\_day from 0090. New AdminDailyReport section:
recent-day chips + a calendar date input; two drillable tiles (Active users, Rounds played) whose
counts are the length of the engine lists; an inline rounds list color-coded by status (completed /
in progress / auto-finished / deleted-issue). Tapping a tile or row opens the shared drawer for the
chosen date. Completes the analytics drill-down feature (stages 1-3). No new SQL to run.

### v1.140.0 — FEATURE: Friction review (integrity sweep agent) — migration 0092 + push route

Run migration 0092 (creates friction\_items, sweep\_friction, get\_friction\_items, get\_friction\_rounds,
resolve\_friction, and schedules the daily pg\_cron job). If 'create extension pg\_cron' errors, enable
pg\_cron once in Supabase > Database > Extensions (same as tee reminders). Optionally run
'select public.sweep\_friction(true);' once for an immediate first pass over historical data.
Client: new AdminFrictionReview section at the top of Analytics (tabs Open/Needs action/Resolved,
Run-check-now, keeper picker + soft-delete on clear). app/api/push/route.ts now treats type
'friction' as push and titles it 'Data integrity flag' — admins get one summary push per sweep that
flags something new. Retired the old 'friction' wording (Power Users badge -> 'restarts'; abandoned
drill tag shown as 'unfinished') so 'friction' now means only the integrity ledger.

### v1.140.1 — FIX: Friction review is now its own admin card

Moved AdminFrictionReview out of the Analytics view into its own admin-home Card + view
(setView 'friction'), with a live open-count badge fed from get\_friction\_items('open') merged
into the todos effect. No migration. Client-only.

### v1.140.2 — FIX: removed the Power Users “restarts” badge

That badge was the old computed heuristic (>=3 abandoned/deleted AND completion <60%) — a live,
unresolvable verdict on normal behaviour, with no way to clear it. Removed the badge + legend; kept
the neutral completion\_pct column and the 'quiet' churn badge. get\_power\_users.friction still
computes but is now unused (no migration). 'Friction' now means only the integrity ledger.

### v1.140.3 — UI: cleaner running-handicap “how?” expansion

runningHandicap() now returns recentDetail\[{d,used}] (newest-first, exact best-N flags). The tile
expansion drops the duplicated 'used: X (of all Y)' line for a single newest-first list of the last
20 differentials with the counted ones in gold+bold, a 'Newest round first.' note, and a payoff line
('The 8 in gold average 12.4 — that’s your index', or with the small-sample adjustment spelled out).

### v1.140.4 — FIX: enforce 10px minimum font size

Swept all sub-10px fonts up to 10 (rule: never below 10px). 11 instances across player-card,
achievements, round-detail, manage (engagement week labels) and the shared ui sub-label. The
handicap-index label on the player card was the visible one. Client-only.

### v1.141.0 — FEATURE: Flights Stage 1a (one-off setup + data) — migration 0093

Additive columns games.flight\_mode / games.flights / game\_players.flight (0093). Game setup (stroke
or Stableford only) gains a Flights control next to Handicap allowance: Off / One-off flights /
Season league (disabled until Stage 2). One-off shows a 2/3/4 picker and an even auto-split of the
field by handicap index, with per-band counts; each player's band is written to game\_players.flight
at create, and flight\_mode/flights onto the game. Players without an index start unassigned. New
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
game has flight\_mode='oneoff' with bands, a By-flight / Overall toggle appears above the board.
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
only effects are cosmetic (multi-player name headers truncate \~1 char sooner). Added
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
game\_players.flight and games.flight\_mode/flights. Missing indexes are filled inline from the field
rail (writes game\_players + the member's profile) and block enabling until resolved — same rule as the
phone. Details = read-only summary; Field \& Matchups = labeled next-phase placeholders. Reuses
lib/flights + the 0093 columns; the phone flow is unchanged. Entry: a desktop-only link in the game
room (organizer only, ≥900px) to /organize/<id>. NEXT: Matchups step, then full create-in-console + drag.

### v1.144.1 — Notifications panel UI fixes — migration 0094 (optional but recommended)

Rebuilt the bell panel as a bottom sheet consistent with the app's other popups (scrim + viewport-
anchored panel, left:0/right:0/maxWidth 440/margin auto) — this also fixes the old absolute dropdown
that ran off the left edge on phones. Added a header with an × close button and 'Clear all', and each
notification now shows relative + absolute date/time ('3h ago · Jul 13, 3:42 PM'). Dark greenMid sheet
with cream/sage text to match. 'Clear all' calls new RPC clear\_my\_notifications() (0094; SECURITY
DEFINER scoped to auth.uid()) with a client-side delete fallback, so it works even before the
migration is run. No behavior change to how notifications are created or marked read.

### v1.144.2 — Notifications: dismiss (mark read) + bold unread, replacing hard-delete

Reworked per the dismiss model: opening the bell no longer auto-marks everything read, so unread
notifications now show BOLD with a gold dot and read ones are muted/normal weight. 'Clear all'
(hard delete) is replaced by 'Mark all read' (shown only when there are unread); tapping a single
unread notification acknowledges just that one. Nothing is deleted — rows persist; the panel still
shows the 30 most recent. Retention unchanged: older-than-30 stay in the DB (no expiry, no history
screen). Migration 0094 (clear\_my\_notifications) is now UNUSED — harmless if already applied; can be
ignored or dropped. No new migration.

### v1.145.0 — FEATURE: full Notifications screen (history) — no migration

New NotificationsScreen (a 'notifications' tab) showing a user's COMPLETE notification history,
paginated (30 at a time, 'Load older'), so nothing sent to a user is out of reach beyond the bell's
recent-30 peek. Same dismiss model: unread bold + gold dot, tap one to acknowledge, 'Mark all read'.
Reachable from the More menu ('Notifications') and a new 'See all notifications →' footer in the bell
panel (onSeeAll prop). Shared notifWhen() timestamp helper. Note: the known-safe initials-regex
escape false-positive moved from manage.tsx:1226 to :1231.

### v1.145.1 — 90-day notification retention — migration 0095 (DB-only)

purge\_old\_notifications() deletes notifications older than 90 days (read or unread); scheduled via
pg\_cron daily at 04:23 UTC ('purge-old-notifications'), same idempotent unschedule-then-schedule
pattern as tee-reminders/friction-sweep. No client change — the bell and Notifications screen simply
won't surface anything older than 90 days because it's gone. Run 0095 in the SQL editor.

### v1.145.2 — Surface the 90-day retention to users

Notifications screen now shows a footer line: 'Notifications are kept for 90 days, then removed
automatically.' so the purge (0095) isn't a surprise. Client-only, no migration.

### v1.146.0 — FEATURE: tappable 'live' notifications — no migration

Notifications that carry a link (the event types: game\_added, game\_finished, money\_owed/paid,
bet\_posted, tee\_new, tee\_reminder, group\_member — stored by the 0069–0074 triggers as /?tab=… or
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
Badge engine (lib/badges.ts): the broke\_100/90/85/80/broke\_par badges changed from 'once' to 'count',
so their stored count is now the NUMBER OF ROUNDS that cleared the threshold (was: first time only).
syncBadges is diff-based and recomputes from each player's rounds on load, so these counts backfill
automatically the next time each user's card syncs — no manual migration/backfill needed.
Peer card now passes group\_badges.count through (the RPC already returned it; the client was dropping it).

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
app; course\_handicap falls back to a computed one from index+rating+slope+par). This levels high vs
low handicappers: playing to your handicap earns the streak. Badges relabelled 'Net bogey-free 3+/5+/
nine/round' with updated descriptions. Par-train, bounce-back, blow-ups, even-par-nine stay GROSS
(absolute scoring feats) — only bogey-free changed. Keys unchanged; syncBadges recomputes counts from
each player's rounds on next load, so counts re-derive on net automatically (no backfill).

### v1.148.4 — REFINE: 'Clean card' → 'Penalty-free round', off the summary card — no migration

no\_penalties relabelled 'Penalty-free round' (Clean card was misleading — read as no-bogeys). Evidence
text updated. Added to the card's CARD\_EXCLUDE so it no longer appears on the profile/peer card; it
still lives on the full Achievements wall. Key unchanged.

### v1.149.0 — FIX: analytics day anchored to US Eastern — MIGRATION 0096 (RUN IT)

Resolves the discrepancy where the DAU tile (server UTC day) and the Daily report (browser-local day)
counted different 24-hour windows. Now a new analytics day starts at MIDNIGHT US EASTERN for everyone,
regardless of device timezone. Implemented by setting `timezone = America/New\_York` ON the functions
(ALTER FUNCTION ... SET timezone), so every current\_date / calendar-day comparison inside them evaluates
in ET without rewriting the bodies. Functions altered: mark\_active (stamps daily\_active.day in ET now),
get\_admin\_analytics (DAU/WAU/MAU/views/sparkline/churn), admin\_stat\_users (drill-downs incl active\_day),
get\_admin\_engagement (rounds-cadence windows). Rolling `now() - interval` windows are absolute instants
and unchanged. Client: the Daily report builds its Today/Yesterday buttons in ET (Intl en-CA / America/
New\_York) so they match the tiles; captions note 'Days run midnight–midnight US Eastern'.
FORWARD-ONLY: daily\_active stores a date (not a timestamp), so opens already stamped in UTC can't be
perfectly reclassified — only opens from this migration forward are ET-exact; history is within \~1 day.
DEPLOY: run migration 0096.

### v1.149.1 — FIX: last UTC calendar-day touchpoints → Eastern — MIGRATION 0097 (RUN IT)

Follow-up to 0096. Anchored the remaining live functions that decided a calendar day in UTC:
get\_power\_users (activity window + days-since-active/churn flags) and the round-recording RPCs
post\_game\_rounds / post\_group\_rounds (only their played\_at FALLBACK used UTC; primary is the game's
match date, unchanged). All via ALTER FUNCTION ... SET timezone. After this no live function uses a
UTC calendar day (only a cosmetic 2-digit-year fallback in the 0060 tee-code trigger remains).
DB-only. DEPLOY: run migration 0097.

### v1.149.2 — TOOLING: migrations run-ledger

Added MIGRATIONS.md (checklist of every migration; tick when run) + ci/gen-migrations-checklist.py
to regenerate it (adds new files, preserves ticks). Manual-run workflow has no tracking table, so
this is the record for catching un-run migrations. Currently flagged to verify-applied: 0082, 0092,
0093, 0095, 0096, 0097 (0094 is optional/unused).

### v1.150.0 — FEATURE: profile sharing gates showcase only (Option B) — MIGRATION 0098 (RUN IT)

show\_card (profile sharing) now hides only the SHOWCASE — badges + the form sparkline. Name, handicap
index, and round count stay visible to club-mates (roster basics), so a private member's card reads
'N rounds' instead of a broken '0'. group\_cards (0098, supersedes 0082) returns a row for every active
member incl. opted-out, always populates idx/idx\_trend/live-rounds, blanks form when sharing off, and
returns show\_card. group\_badges unchanged (still hides badges for opted-out = correct). Client peer card
surfaces show\_card, keeps rounds/index, and shows a clear '<name> has profile sharing off — badges and
form are hidden' note instead of the old misleading 'No card details'. Fixes Karan Sarin showing 0 rounds.
DEPLOY: run migration 0098.

### v1.151.0 — FEATURE: card index default = entered; Sandbaggers admin tab — MIGRATION 0099 (RUN IT)

1. Profile card now shows the player-ENTERED (GHIN) index by default, falling back to the app's
scoring-computed index only when none is entered. (Was: computed first.) Both self + peer cards.
2. New System-admin tab 'Sandbaggers' (🚩): flags players whose entered index differs from the app's
scoring-computed index (player\_cards.idx) by >=20% RELATIVE, but ONLY once they have >=18 posted
rounds (a thinner record skews the computed index, so GHIN is trusted as-is below that). Shows
entered vs scoring, rounds, %, and direction (index looks high = classic sandbag / low). RPC
admin\_sandbaggers() (0099), is\_admin-gated, security definer. DEPLOY: run migration 0099.

### v1.151.1 — CHANGE: Sandbaggers is now a CLUB-admin tab, club-scoped — MIGRATION 0100 (RUN IT)

Moved the Sandbaggers card from System (master-only) to the Club-admin tier, and made it club-scoped.
admin\_sandbaggers(p\_group) (0100, supersedes 0099) returns flagged members of THAT club and is callable
by an admin of the group (is\_group\_admin) OR a master admin. Same rule: >=18 posted rounds, >=20%
relative gap. AdminHome now receives activeGroupId and passes it through. DEPLOY: run migration 0100
(if 0099 was never run, 0100 is all you need; if it was, 0100 replaces it).

### v1.151.2 — ROLLBACK + RENAME: Sandbaggers system-only again; 'Super admin' → 'System Admin' — MIGRATION 0101 (RUN IT)

Reverted 0100's club-scoping: Sandbaggers is a System-admin (master) tool again — app-wide, master-gated,
card back in the System tier. admin\_sandbaggers() (0101, no-arg, is\_admin-gated) supersedes 0099 + 0100 —
run 0101 and ignore those. Removed the now-unused activeGroupId plumbing from AdminHome.
Renamed the admin tier badge 'SUPER ADMIN' → 'SYSTEM ADMIN' (desc: 'System admins only').
BACKLOG: logged 'Multiple System Admins (owner model)' — allow >1 system admin with an owner (Amit) who
alone can revoke/demote; owner cannot be demoted; audit every change.
DEPLOY: run migration 0101.

### v1.152.0 — FEATURE: owner model / multiple System Admins — MIGRATION 0102 (RUN IT)

profiles.is\_owner marker above is\_admin. Only the OWNER can add or remove system admins (promote AND
demote owner-only); owner cannot be demoted; you can't change your own admin status; every change is
audit-logged server-side. New RPCs: is\_owner(), admin\_set\_system\_admin(p\_user,p\_make) (owner-gated).
admin\_list\_users() now returns is\_owner (owner sorted first). Users tab: role badge ('★ owner' /
'★ system admin') + owner-only 'Make admin' / 'Remove admin' buttons (hidden for everyone but the owner,
never shown on the owner row or your own).
SEED: 0102 auto-sets is\_owner on the sole existing admin. If you had >1 admin already it no-ops — then
run the manual seed line in the migration with your email. After deploy, confirm you show '★ owner'.
DEPLOY: run migration 0102.

### v1.152.1 — FIX: Admin tab horizontal drift (no migration)

The Admin views had no width guard, so a wide child (dense stat/bar rows, the drill-down table) could
push the whole page and let it drift left/right on a phone — only on Admin. Clamped both AdminHome
containers to width:100% / maxWidth:100% / overflowX:hidden. Content that's legitimately wide (the
admin\_stat\_users drill table) keeps its own local horizontal scroll inside its box; everything else
(flex tiles, flex:1 bar charts) reflows to fit. No data or logic change.

### v1.152.2 — Global no-horizontal-scroll + admin label clarity + APP\_RULES.md (no migration)

1. No-horizontal-scroll is now APP-WIDE, enforced at the single inner scroll container
(home.tsx scrollRef: overflowY:auto + overflowX:hidden). Reverted the admin-only clamps from
v1.152.1 (global rule supersedes). Wide content must use its own local overflowX:auto box.
2. Admin label clarity: system-admin button now reads 'Make system admin' / 'Remove system admin';
club-admin toggle reads 'Make club admin' / 'Remove club admin' (+ audit text). No more bare 'admin'.
3. Added APP\_RULES.md (global invariants reference) + ci/check-global-rules.py (guards Rule 1: the
scrollRef horizontal clamp). Release builds now run this check alongside fontsize + jsx-escape.

### v1.152.3 — Swipe-cue for horizontal-scroll boxes (no migration)

New shared <HScroll> (components/hscroll.tsx): an overflowX:auto box that shows a "Swipe →" cue in
the corner ONLY while there's more content to the right (mobile hides native scrollbars); the cue
vanishes at the end and never shows when content fits. Applied to the two wide data boxes — admin
drill table (manage.tsx) and the round-detail hole strip (round-detail.tsx). Codified in APP\_RULES.md
rule 1: any new horizontally-scrollable box uses <HScroll> (badge-shelf carousels keep their
half-clipped-badge cue). No data/logic change.

### v1.152.4 — FIX: Activity log actor shows name, not email (no migration)

The game-delete log used the actor's email while game-create/end/reset used display name, so a delete
read as 'amitsud@gmail.com' next to 'Amit Sud'. Fixed centrally: logActivity (lib/activity.ts) now
resolves display\_name from actor\_id when the passed name is empty or looks like an email, so ALL entries
(games, groups, admin actions) read as names. Also set game\_deleted to pass displayName directly.
Same actor\_id throughout — this was only a label. Existing historical rows keep their old label.

### v1.152.5 — FIX: 'Completed a round' logs once, on first finalization (no migration)

round-editor save() logged a round\_completed activity on EVERY save of a solo round, so re-opening a
round to fix a score/add stats wrote a new 'Completed a round (score)' line each time (the drifting
scores + partials seen in the log). Now it captures the round's prior status and logs a completion only
when the round FIRST becomes final; re-saves of an already-final round no longer log. Game rounds remain
excluded as before. Fixes audit-trail spam; no change to the rounds data itself.

### v1.153.0 — FEATURE: warn before logging a round that duplicates an active game (no migration)

Root cause of the Preet-style duplicate: a player who's being scored in a group game could also start a
SEPARATE manual round via New round (game\_id NULL), which the rounds(game\_id,user\_id) unique index can't
dedupe. RoundSetup.start() now checks whether the player is in an ACTIVE (status<>'ended') game at the
same course; if so it warns: their scores post automatically and they can add their own putts/fairways/
sand/penalties on the game's scorecard — 'Log a SEPARATE round anyway? This usually creates a duplicate.'
Warn, not block (legit second rounds / back-entry still allowed). In-game guidance for view-only gross +
editable stats already existed (tournaments.tsx). No rounds-data change.

### v1.153.1 — refine duplicate-round warning: only when the game is still unfinished (no migration)

v1.153.0 warned whenever the player was in any active game at that course. Refined: it now also checks
the player's own scores in that game (game\_players.scores, 0-based hole keys) and only warns if the
round is still UNFINISHED (fewer scored holes than the course's hole count). A fully-scored game that
the organizer simply hasn't ended no longer triggers it (that's likely a genuine second round). Message
shows progress (e.g. '11/18 holes in'). NOTE: there is no system auto-END for games — only stale-complete
in-progress ROUNDS auto-finish (0083). Auto-ending fully-scored stale games is a possible follow-up.

### v1.154.0 — game auto-complete + organizer nudge — MIGRATION 0103 (RUN THIS)

Fully-scored games that the organizer never ended no longer linger 'active' forever.

* New games columns: scored\_at (first seen fully scored), end\_nudge\_at (nudge sent).
* post\_game\_rounds refactored: posting body extracted to post\_game\_rounds\_internal(p\_game, p\_system);
post\_game\_rounds keeps its organizer-only gate and delegates (client 'End game' unchanged).
* sweep\_stale\_games() (throttled once/hour via system\_jobs, called on app open in home.tsx): a game is
'fully scored' when every player who started has all holes in and NO player is mid-round (partials
keep it in progress). Stamps scored\_at; nudges the organizer 2h later ('...auto-complete at the end
of today...', type game\_autocomplete, link /?tab=games); auto-ends + posts everyone's rounds at the
end of the ET day, attributed finished\_by='system:auto' (mirrors the stale-round sweep 0083).
* Guard: only games created within the last 30 days are swept (avoids resurrecting ancient games).
* There is still NO auto-complete for single in-progress ROUNDS beyond finish\_stale\_rounds (0083).

### v1.155.0 — System Admin: stale games panel — MIGRATION 0104 (RUN THIS)

Operations panel (System Admin) now lists every unfinished game older than 24h, app-wide, so an
admin can see how much stale/abandoned game data is awaiting cleanup.

* New RPC admin\_stale\_games() (is\_admin-gated, security definer, READ-ONLY): returns each non-ended
game >24h old with per-player completeness (same scores read as post\_game\_rounds) and a verdict:
fully\_scored / in\_progress / no\_scores / empty, ordered cleanable-first then oldest.
* OpsMetrics (manage.tsx): fetches it alongside get\_ops\_metrics; adds three count tiles (Total stale,
Fully scored, Abandoned) and a per-game list with a colour-coded verdict badge (gold=fully scored,
sage=in progress, red=no scores, grey=no players). Read-only — no in-app delete yet.
* Note: fully\_scored stale games under 30d auto-complete via sweep\_stale\_games (0103); this panel
surfaces the longer tail (abandoned partials, empty shells, >30d fully-scored).

### v1.156.0 — stale-games panel: per-row Delete (System Admin) — MIGRATION 0105 (RUN THIS)

The Operations → Stale games panel now has a Delete button per row for clearing abandoned games
without dropping to SQL.

* New RPC admin\_delete\_stale\_game(p\_game) returns text (is\_admin-gated, security definer). Guards:
refuses if the game is already 'ended' (not\_stale) or has any live non-deleted rounds (has\_rounds),
so it can never orphan a posted round. Nulls game\_id on any soft-deleted rounds, then deletes
game\_players + games (mirrors admin\_delete\_game). Returns forbidden|not\_found|not\_stale|has\_rounds|deleted.
* OpsMetrics (manage.tsx): each stale row shows a red outline Delete button when rounds\_posted=0
(behind a confirm), or a 'has rounds' note when protected. On 'deleted' the row is removed from the
list in place; other statuses surface a short alert.

### v1.157.0 — test-group sandbox + wipe — MIGRATIONS 0106 \& 0107 (RUN BOTH)

App Testing (group 41935c40-…) is now a true sandbox.

* 0106: groups.is\_test (App Testing=true) + is\_test\_group() helper. post\_game\_rounds\_internal bails
before creating any rounds for a test group (covers game-end + auto-complete sweep); recordMyGameRound
(client) does the same. sweep\_stale\_games and admin\_stale\_games now skip test groups (no nudges, no
ops-panel clutter). Aggregate analytics already exclude is\_test PROFILES, so test activity is fully
sandboxed: games/betting/money work, but nothing hits Rounds/handicaps/stats.
* 0107: admin\_wipe\_group(p\_group) — is\_admin-gated AND hard-guarded to is\_test groups only. Clears the
group's games+game\_players, rounds+holes, money (expenses/expense\_shares/group\_guests/settlements),
group\_activity, tee\_times+rsvps, notifications; resets player\_cards/member\_badges for the group's TEST
members only. KEEPS the group + members. Returns forbidden|not\_found|not\_test|wiped.
* manage.tsx GroupsAdmin: gold 'Wipe data' button on test-group rows (type-the-name confirm).
* NOTE: manual rounds a real user logs directly to a test group are not gated (phantom users can't log
manually; games are the only phantom vector). Revisit if that edge matters.

### v1.158.0 — TEST MODE border (no migration)

A thin red border + centered 'TEST MODE' label now frames the whole app whenever the user is in a
test state, so it's never invisible. Shows when EITHER the account is a test account (profiles.is\_test)
OR the active club is a test group (groups.is\_test). home.tsx: groups query/AppGroup now carry is\_test;
derived `testMode = profile.is\_test || active group is\_test`; fixed pointer-events:none overlay
(#DC2626, z-9999) in the app shell, label offset by safe-area-inset-top for notch/PWA. Purely visual;
the two underlying mechanisms are unchanged and remain distinct (is\_test USER = excluded from
aggregate analytics; is\_test GROUP = games never post rounds / sandboxed).

### v1.158.1 — FIX: analytics charts overflowed narrow screens (no migration)

Weekend-reach and New-vs-returning charts ran off the right edge on phones. Root cause: horizontal
flex bar rows whose columns were flex:1 but lacked minWidth:0 — a flex item defaults to min-width:auto
and can't shrink below content, so the per-column nowrap week label pinned each column to its intrinsic
width and \~13 weeks summed past the viewport; the app-shell overflowX:hidden then clipped the right
side silently (invisible on wide desktop, broken on phone). Fix: minWidth:0 on each column + overflow
hidden on the row + thinned week labels (\~6 max, showWk()). Audited all other charts — SVGs are
width:100%, the hole-outcomes bar is percentage-width in an overflow-hidden box, legends flex-wrap —
all safe. Added ci/check-chart-overflow.py (flags a mapped bar-column with a nowrap label missing
minWidth:0) to the pipeline, and documented the flex minWidth:0 idiom in APP\_RULES rule 1.

### v1.159.0 — automated layout-overflow e2e (Playwright + GitHub Actions) — no migration

Runtime guard so chart/layout overflow can't silently ship. AdminEngagement now accepts an optional
`inject` prop (skips its fetch) and is exported. New dev-only route app/dev/layoutprobe renders it with
worst-case 13-week mock data (inert in prod; only active when NEXT\_PUBLIC\_LAYOUT\_PROBE=1). Playwright
(playwright.config.ts, e2e/overflow.spec.ts) builds+starts the app at a 360px viewport with placeholder
Supabase env (no secrets, no login — the probe never hits the backend) and fails if scrollWidth>clientWidth
or any element extends past the viewport. .github/workflows/e2e-overflow.yml runs it on every push/PR.
npm script: `npm run e2e`. devDep @playwright/test. NOTE: GH Actions reports pass/fail on the commit;
it does not block a Vercel deploy unless branch protection requiring the check is added.

### v1.159.1 — remove the e2e/Playwright harness (per owner) — no migration

Stripped the v1.159.0 automated-overflow harness: deleted playwright.config.ts, e2e/overflow.spec.ts,
.github/workflows/e2e-overflow.yml, and app/dev/layoutprobe; reverted AdminEngagement to its original
(no export/inject); removed the @playwright/test devDep + `e2e` script (lockfile reconciled). RETAINED
the real fixes: the v1.158.1 two-chart overflow fix, the ci/check-chart-overflow.py static guard (still
runs every build), and the v1.158.0 TEST MODE border. Overflow is now guarded statically + by eye.

### v1.160.0 — trend-chart fixes: 3-putt data, dynamic axis, red/green bars (no migration)

Dashboard stat drill-down (the click-to-expand TREND charts):

* 3+ putts (item 9): now returns null for rounds with no putt data (gross-only or untracked), so they're
excluded instead of charted as a false 0. A valid round with zero 3-putts still shows 0.
* Dynamic y-axis (item 4): drill-down trends now fit the data via niceDomain (pct stats clamped 0-100)
instead of a generic auto axis — same data-fit treatment the scoring-form differential already uses.
* Colourful bars (item 8): bars now run green (beat your average) / red (didn't), direction-aware
(lower-is-better vs higher), matching the scoring-form differential; rolling lines recoloured
(cream 5-rd, gold 10-rd) and caption updated.
* Items 5/6/7 (scrambling 0%, missing putts bar, missing Stableford bar) are data-specific and pending
a round-level diagnostic. Items 1 (avatars in analytics), 2/3 (popup dismissal global rule), and a
full trend audit (10) are queued.

### v1.160.1 — popup dismissal + trend NaN hardening (no migration)

* Item 2: admin 'who' drill sheet (DrillModal) no longer dismisses on backdrop tap — a scroll that
ended on the backdrop was reading as a tap and closing it. Now ×-only (backdrop dims but doesn't
close). APP\_RULES rule 4 extended: popups need an always-reachable × and must not close on scroll.
* Items 6/7 hardening: drill-down trend series now filters Number.isFinite(v), not just v!=null, so a
NaN can't slip through as an invisible bar. (FB Jul 10 putts 31/15 and Weequahic Jun 17 Stableford
are both finite/estimable per data, so please re-verify on this build.)

### v1.160.2 — dismissable chart tooltips (item 3) (no migration)

The recharts hover tooltip stuck 'on' after a tap on touch, with no way to dismiss (screenshot IMG\_1366).
Fixed at the shared ChartTip level so it's fixed on every dashboard chart at once:

* ChartTip now renders a corner × that fires a global 'bnn-chart-dismiss' event.
* New DismissableChart wrapper listens for that event and remounts the chart (clears recharts' internal
active-tooltip state). Wraps the scoring-form differential and the stat drill-down charts.
* All three <Tooltip> layers set wrapperStyle pointerEvents:auto so the × is tappable (recharts sets the
tooltip layer pointer-events:none by default, which would swallow the tap).
Note: screenshot shows this Weequahic round labelled 'Jun 16' while the DB date is Jun 17 — a separate
date-display off-by-one (UTC parse) worth fixing; flagged, not yet addressed.

### v1.161.0 — avatars in the analytics 'who' drill (item 1) · MIGRATION 0108

* admin\_stat\_users (the shared is\_admin-gated drill that every analytics stat routes through) now
returns a 4th column, avatar\_url, pulled from the profile behind each row (host.avatar\_url for the
guests stat). DROP+CREATE because the return shape changed; re-applies the 0096 America/New\_York
timezone and the authenticated grant. Regenerated from 0090 (paren-aware insert so rounds\_day's
subquery FROM wasn't touched).
* DrillModal rows now render <Avatar src={u.avatar\_url} name={u.name}/> — a real photo when set, the
initials circle otherwise (Avatar's own fallback), with tap-to-enlarge for real photos. Removed the
now-dead local initials() helper (also clears a jsx-escape advisory false positive).
* Covers the primary analytics 'who' lists. The power-users TABLE (get\_power\_users) is a separate
stats grid — avatars there deferred unless wanted.

### v1.161.1 — avatars in more people-lists (item 1, breadth) (no migration)

All client-side (no DB change) — the profile/player objects already carry avatar\_url; Avatar falls
back to initials when a photo is absent:

* tournaments.tsx: flight handicap editor rows, guest members list, and flight members list now show
a small avatar beside each name (native <select> option rows can't hold avatars, left as-is).
* manage.tsx Power users table: small avatar in the sticky name cell. get\_power\_users already returns
user\_id, so avatars are fetched client-side by id (best-effort; if RLS blocks reading those profiles
it silently falls back to initials — never blocks the table). No migration.
* money.tsx settlements/balances already had avatars — confirmed, unchanged.
Still pending avatars: round-setup player picker, round-detail playing partners, share-card, a couple
of remaining tournaments guest/scorecard-header spots.

### v1.161.2 — avatar sweep finish (no migration)

* tournaments.tsx guest row now shows an avatar (guests have no profile photo, so it's the initials
circle — consistent with member rows).
* Audited the rest: round-setup is a solo round-entry flow (no player picker), round-detail is a single
player's scorecard, tee-times roster + money settlements already had avatars. Remaining name displays
are not 'who is this' lists: native <select> options (can't hold avatars), the dense live-scoring grid
column headers, action pills (mark-out), inline sentence mentions, and the stylized share card.

### v1.161.3 — analytics engagement charts rebuilt on recharts (no migration)

The Weekend-reach and New-vs-returning charts were hand-rolled flex div-bars: a value of 1 became a
\~4px sliver (read as a broken dash), one tall bar crushed the rest, and labels didn't sit under bars.
Rebuilt both as recharts BarCharts (160px tall) matching the dashboard aesthetic:

* Weekend reach: gold bars, radius top, a thin y-axis for scale, aligned x labels (interval
preserveStartEnd + minTickGap), value labels on each bar via LabelList. Small bars are now readable.
* New vs returning: proper stacked bars (new=gold bottom, returning=sage top), the week TOTAL labelled
on top, legend kept below. Replaces the two-number-per-column clutter.
* Removed the old flex-bar scaling helpers (maxG/maxNR/stepW/stepNR/showWk). Imported recharts into
manage.tsx. No tooltips (values are labelled) — avoids the stuck-tooltip issue on these admin charts.

### v1.161.4 — chart axis-fit as a default (no migration)

Making 'fit the axis to the data' a standing rule instead of a per-chart fix (APP\_RULES rule 17):

* AdaptiveTrend now self-fits its y-axis to the data range when no explicit domain is passed (pct
stats clamp 0-100) — so no future chart using it can ship un-fitted.
* Removed dead code: trend/diffDomain/ptsVals/ptsDomain (a leftover block that fed no chart).
Audit of every chart in the app (all now fit their space): dashboard scoring-form differential
(niceDomain), stat drill-down trends (niceDomain / pct-clamped), AdaptiveTrend (self-fit),
hole-outcomes proportion bar (no axis), manage engagement weekend + new-vs-returning (recharts,
0-based count bars, 160px tall), feature proportion bars, player-card FormChart (SVG, data-range
fit + span-0 guard). No un-fitted charts remain.

### v1.161.5 — date off-by-one display fix + % axis labels (no migration)

* fmtDate: a plain 'YYYY-MM-DD' (a DATE column like played\_at) was parsed by new Date() as UTC
midnight, rendering as the previous day in the Americas (e.g. Jun 17 -> 'Jun 16'). Now parsed as a
local calendar day. Full ISO timestamps still parse as before. Fixes dates across scorecards, round
lists, tooltips, share cards — anything via fmtDate.
* Percentage trend charts (scrambling, GIR, fairways, sand saves) now label the y-axis with '%' via a
tickFormatter, in both the dense (AdaptiveTrend) and bar drill-downs — answers 'is that a percentage?'
* NOTE: the deeper 'played\_at = game creation date, not actual play/record date' issue is separate and
pending a design decision (see chat) — not changed here.

### v1.162.0 — round date = when it was actually played/scored · MIGRATION 0109

Server-only (no client change). Date priority for a recorded round is now: a deliberately-entered
date > the date it was actually scored > the game's creation date.

* post\_game\_rounds\_internal (games) and post\_group\_rounds (tee-group posting): rdate is now the game's
match date ONLY if it was deliberately entered (differs from the game's creation day, ET); otherwise
the date it's being scored (now, ET). And played\_at is no longer overwritten on re-post — it locks to
the first (scoring-day) value, so finalizing a day later doesn't move the date.
* Backfill: every existing game round whose date was the non-deliberate default (match date = creation
day, or null) is reset to the day it was scored (round.created\_at, ET). Deliberate match dates and
solo rounds (user-picked date) are left untouched.
* Worked example: the Weequahic 'Match Play' game (created Jun 17 ET, match date stored Jun 17, scored
Jun 20, ended Jun 21) → backfill sets it to Jun 20, the day it was played.
* Separate/optional: the game 'Match date' field is still capped at max=today (can't schedule a future
play date) — not changed here; the new rule makes it moot for the recorded date.

### v1.162.1 — allow scheduling a game ahead (remove today-cap on play date) (no migration)

The game date field was capped at max=today, so you couldn't set a future play date when scheduling a
game the night before / a few days out — and a tee-time's future play\_date got clamped down to the
creation day (the root of the 'Jun 20 -> stored Jun 17' bug). Removed the cap and relabeled the field
'Play date'. Works with the 0109 rule: a deliberately-set (incl. future) date is honoured; if left at
the default, the scored-date fallback still records the day it was actually played.

### v1.163.0 — editable play date + past-date confirmation (solo rounds) (no migration)

* Round editor now shows an editable 'Play date' (defaults to the round's stored date); saving writes
it to rounds.played\_at on both the update and insert paths.
* Any round saved with a date before today prompts 'This round is dated {date} — {N} days in the past.
Save it with that date?' Wired into new-round entry (hole-by-hole + gross) and the round editor.
Backdating stays a deliberate one-tap-to-confirm action rather than a silent default.
* Still to do (team side): organizer-edits-a-game's-date (all players' rounds move together) and the
0110 change making games always record the scored date. This release is the solo-round half.

### v1.164.0 — games always record the scored date + organizer date-edit · MIGRATION 0110

* Games are scored live and never back-dated, so a game round's recorded date is now ALWAYS the day it
was scored. Dropped the 'deliberately-entered date wins' branch (0109) for games; the game's play
date is scheduling/display only. Rain-delay case (scheduled Jun 19, played Jun 20) now records Jun 20.
* New RPC set\_game\_played\_date(p\_game, p\_date): organizer-only; moves the game's date AND every
player's round together. Surfaced as an organizer-only 'Play date' control in the game view (Save
button appears only when changed; past-date confirmation before it moves anything).
* Backfill completes 0109: forces every game round to its scored (first-post/creation) day, ET.
* Solo rounds are unaffected (user-entered date, editable per v1.163.0).

### v1.164.1 — move the 'Swipe ->' cue to the top of scrollers (no migration)

The HScroll discoverability cue sat at bottom-right and overlapped the last row of content (visible in
the Power Users table, where it hid the last user). Moved it to top-right in the shared component, so
it never covers content. Global change — applies to both boxes that use HScroll (admin/power-users
table in manage.tsx, and the round-detail hole strip).

### v1.164.2 — HScroll: swipe pill -> slim scroll-position bar (no migration)

Replaced the overlay 'Swipe ->' cue (which covered content wherever it was anchored) with a slim
custom scroll bar placed BELOW the content in normal flow — it never overlaps any text or data.
Shows only while the box overflows; the gold thumb reflects position + how much is off-screen and is
draggable (or scroll the content). Native scrollbar hidden to avoid a double bar. Global change via
the shared component — applies to the Power Users table (manage.tsx) and the round-detail hole strip
(round-detail.tsx). Chosen from an A/B mockup.

### v1.164.3 — freeze table headers on long tables (no migration)

A table taller than the phone lost its column headers as you scrolled down. HScroll now takes an
optional maxHeight so the box scrolls vertically too, and a thead marked position:sticky;top:0 stays
frozen while rows scroll under it. Applied to the Power Users table (manage.tsx, maxHeight 70vh, sticky
header with the sticky-left Player corner at the highest z-index). New global rule in APP\_RULES (rule 1).

### v1.165.0 — durable, immutable Money audit trail + integrity fixes · MIGRATION 0111

The Money ledger now keeps a permanent, tamper-proof record of every change, so an expense's full
allocation can always be traced — even after it's deleted. Fixes the gap where deleting an expense
erased its own history (the old `expense\_audit`, 0050, was `on delete cascade`) and the allocation
breakdown vanished with the live rows.

* **New `money\_audit` table**: one immutable snapshot per underlying write. NOT cascade-linked to the
expense, so a deletion's snapshot outlives the expense. Read-only to members; NO update/delete policy
(append-only, can't be doctored). Snapshots denormalize member/guest names so they still render after
those rows change or are gone.
* **Captured by DB triggers, not app code** — they fire on every write path (manual expenses, admin
edits, bet-posting from games, or a raw API call), so the trail can't be bypassed. A `BEFORE DELETE`
trigger freezes the full allocation the instant before it cascades. The snapshot insert is
exception-guarded so an auditing hiccup can never block a user's save/delete.
* **Because the app writes an expense and its shares/payers in separate requests**, one logical
create/edit produces a short burst of snapshot rows; `collapseAuditBursts` (lib/money.ts, unit-tested)
folds each burst into one clean version (first row's action, last row's settled snapshot). A delete is
always its own terminal version.
* **UI**: the expense detail sheet now shows a full "History · N changes" list, each version expandable
to its allocation as it stood then. A deleted expense's log entry is tappable and opens a read-only
frozen snapshot ("DELETED" badge, full paid-by + split). No write code was touched.
* **Integrity fix — child-row write lock**: `expense\_shares` / `expense\_payers` writes are now scoped to
the parent expense's `created\_by` or a group admin/owner (previously ANY active member could rewrite
another member's split directly via the API). Reads stay open to all members. Matches the app's own
UI gate and the parent expense's update policy — makes true the model "edit only your own; admins edit
anyone, all logged."
* **Sanity rail**: a single expense is capped at $100,000 (`amount\_cents <= 10000000`) via CHECK
constraint.
* Settlement permissions unchanged (honor system, by design — convenience over airtight).
* **Migration 0111 must be run** in the Supabase SQL editor. Deploying the code ahead of it is safe
(the audit UI simply shows nothing until snapshots exist), but the audit trail and the child-write
lock don't take effect until it's applied.

### 165.1.260714 — adopt new version scheme + doc sync (no migration, no app change)

First release under the new `FEATURE.EDIT.YYMMDD` version scheme (see "Versioning" note at the top).
Docs-only: recorded the scheme in APP\_RULES (#13), HANDOFF (§4 step 2, §5), and here. No code or app
behavior changed and there is no migration — deploy at leisure (it only refreshes repo docs and the
version label; users will see a routine "update available" from the version-string change).

### 166.0.260714 — Events: group expenses into islands · MIGRATION 0112

Expenses can now be grouped under an Event (e.g. "Ireland Trip", or a game), so each event's spend sits
in its own island with its own per-person breakdown — while settlement stays group-wide.

* **`group\_events`** (migration 0112): one member creates an event (name + optional free-form date);
anyone can attach expenses to an OPEN event. `expenses.event\_id` is nullable (optional field) and
`on delete set null` (deleting an event never deletes its expenses — they fall back to Ungrouped).
* **Lifecycle open → closed.** An admin CLOSES a settled event via `set\_event\_closed` (admin/owner only,
logged): it drops out of the picker, its expenses are sealed (no edits/deletes), and it moves to a
collapsed "Closed events" section that stays fully viewable. Admin can reopen. **Enforced by DB
triggers**, not just UI — a closed event's expenses can't be changed and nothing can be added/moved
into it (consistent with the 0111 audit work). Closed events can't be deleted (sealed record); open
ones can (by creator/admin), and their expenses fall back to Ungrouped.
* **Move an expense** between open events (or ungroup) via `move\_expense\_event` — expense creator or
admin; target must be open; moving out of a closed event requires a reopen first. Logged.
* **Game-linked events auto-create on bet-post** (`ensure\_game\_event`): the game becomes an event whose
name/date come from the game and are locked (a game event can't be hand-renamed). Reposting a bet into
a closed game-event is blocked with a "reopen it first" message.
* **Balances view** now renders event islands (open → Ungrouped → collapsed Closed), each with its total,
a "settled/unbalanced" chip (per-event nets to zero = settled), and — for admins — a Close/Reopen
control. The add/edit form has an optional Event picker with inline "＋ New event"; the expense detail
sheet has a "Move" control. Settle-up is unchanged and stays group-wide.
* New pure, unit-tested helpers in `lib/money.ts`: `eventNet` (per-member spent/share/net for one event)
and `expensesByEvent`. `computeBalances`/`simplify` are untouched — events are a reporting lens only.
* **Migration 0112 must be run** (after 0111). Code is safe to deploy ahead of it (the events UI simply
shows nothing until the table exists), but events don't work until it's applied.
* First release using `FEATURE.EDIT.YYMMDD`: this is FEATURE 166.

### 166.1.260714 — migration ledger (self-recording) · MIGRATION 0113

Confirming which migrations have run is now a query, not an honor-system checklist. Adds a
`schema\_migrations` table + `record\_migration()` helper; from 0113 on, every migration ends with
`select record\_migration('NNNN\_name');` and signs the log when it runs. Backfills a single
`baseline\_through\_0110` marker (confirmed applied) and auto-detects 0111/0112 by object existence, so the
ledger is accurate the moment 0113 runs regardless of order. Confirm state anytime with
`select id, applied\_at from public.schema\_migrations order by id;`. New standing rule in APP\_RULES (#14).
No app-behavior change. Run 0113 LAST, after 0111 and 0112.

### 166.2.260714 — Money UI cleanup: drop Category, drop manual event date, header padding (no migration)

Refinements to the Money tab, display-only — no schema change.

* **Category removed** end-to-end: gone from the add/edit form, expense rows, the detail sheet, and the
old "Spend by category" summary block. Description carries the expense now. The `expenses.category`
column is left in place (DB default 'other'); nothing destructive, old values just stop showing.
* **Manual event-date field removed.** Events no longer ask for a typed date. Islands now show the
auto-recorded **created** date and, once closed, the **closed** date (from `created\_at`/`closed\_at`) —
shown on both open and closed islands. Game-linked events keep their date in the description text
(built by `ensure\_game\_event` from the game), so no date is lost there.
* **Header padding**: the Money screen root had no horizontal padding, so content sat flush against the
phone edges — added `0 14px` so headers and islands breathe.
No migration. Deploy via the normal flow.

### 166.3.260715 — auto-stamp the version date (build tooling; no migration, no app change)

The `YYMMDD` segment of the version is now computed from the US/Eastern date at build time in
`scripts/write-version.mjs`, instead of being typed by hand. Only FEATURE.EDIT is maintained in
package.json now; the date in package.json is a placeholder the build overrides, so the shipped version
always carries the true Eastern ship date and can't be fat-fingered (a 6-digit third segment marks the
new scheme; legacy 1.MINOR.PATCH is left untouched). Rule updated in APP\_RULES #13 / HANDOFF §4. This is
also the first build to correctly land on 260715 rather than carrying 260714 forward.

### 166.4.260715 — fix false "settled" on event islands; rename Delete → Void (no migration)

* **Bug fix:** event islands showed "settled / ready to close" the moment they had any expenses, before
any payment. Cause: the old `balanced` flag checked whether per-person nets sum to zero — a mathematical
identity that's ALWAYS true (total paid always equals total owed). Replaced with `eventNet.owedWithin`
(sum of positive nets = amount someone fronted for others within the event). The chip now reads
**"all square"** only when nobody fronted, otherwise **"$X fronted"** (neutral, C.sage) — never a
payment claim. Removed the misleading "Shares balance — ready to close" admin hint. Rationale:
settlements are group-wide and not tagged to an event, so an event genuinely can't know if it's been
paid — the admin asserts done-ness by CLOSING it; the app never fabricates "settled." `owedWithin` is
unit-tested (fronting case, self-square case, guest-to-sponsor case).
* **Rename Delete → Void** on the expense edit screen: "Void expense" button + reworded confirm ("removed
from everyone's balances, but the record stays in the activity log"). The frozen-snapshot badge now reads
VOIDED and the log/version wording says "voided." Void better fits the connotation of reversing a charge,
and matches what already happens — the record persists in the audit trail, only the live row is removed.
Internal action key stays `expense\_deleted` (icons, log history, existing rows unaffected). Mechanic
unchanged. No migration.

### 167.0.260715 — event settled-state (derived), tap-through balance breakdown, Money spacing (no migration)

* **Event settled-state — now real.** Corrects 166.4: an event is settled when every participant is
globally square (per the model "settle globally = settled everywhere"; owedWithin===0 events are
trivially settled). Islands show **settled** (green) / **$X outstanding** / **open**, and the admin
"ready to close" hint returns but only when actually settled. Global balances (computeBalances) are
passed into the islands to derive this; settle-up itself is unchanged and stays group-wide.
* **Tap-through balance breakdown (new).** Tapping a person on the Balances tab opens a plain-language
ledger of how their number was built — "You paid $60 for Beer cart" (+), "You owe $100 — your share of
Rental (Ireland Trip)" (−), "You paid $50 to Dave" — grouped by event, with a running total that
reconciles exactly to the shown balance. This is the RAW obligation list, deliberately NOT the
simplified who-pays-whom (that stays on the Settle tab). New pure helper `personLedger` in lib/money.ts,
unit-tested to reconcile to computeBalances for every member (incl. guest-sponsor and settlements).
* **Spacing fix.** The shared `Eyebrow` header has zero margin, so Money's Add tab and "Expenses by
event" headers sat flush together. Added a spaced local `MoneyHead` (18px top / 8px bottom) for all
Money section headers — scoped to Money to avoid touching other screens' spacing.
No migration; app-only.

### 167.1.260715 — FIFO event settlement, oldest-first (no migration)

Refines 167.0's settled logic to handle partial payments the way Amit specified: a person's cumulative
payments retire their debts **oldest-first**, with Ungrouped treated as just another dated bucket (ordered
by date alongside events). So paying half clears your oldest events first instead of nothing settling.

* New pure helper `eventSettlement` (lib/money.ts): buckets each person's net by event/ungrouped, orders
by date, and FIFO-allocates their net payments-out (settlement "from" minus "to") oldest-first. An event
is settled when its total owed is fully covered by participants' oldest-first allocations. Unit-tested:
partial payment settles the older event and leaves the newer open; no payment settles nothing; full
payment settles all; an older Ungrouped bucket takes the payment before a later event.
* Island chip now shows **settled** / **"$X of $Y settled"** (partial, amber) / **"$X outstanding"** /
**open**, and "ready to close" only when truly settled. Replaces the all-or-nothing global-square check
from 167.0.
No migration; app-only.

### 167.2.260715 — per-event settling with confirm-on-return · MIGRATION 0114

Settlements are now event-attributable, per person, all-or-nothing — replacing FIFO (which let a disputed
old event block newer ones). Approved via mockups before build.

* **Migration 0114**: `settlements.event\_id` (null = Ungrouped/legacy global) + `settlements.status`
('pending' | 'confirmed', default confirmed). Pending rows are ignored by balances AND event
settled-state — they only drive the "confirm your payment" nudge and persist so a settle survives an
app close.
* **Settled-state is computed** (lib `eventSettlement`): a person is settled for an event when their
confirmed, event-tagged coverage ≥ their current within-event owed; the event is settled when every
ower is. No cross-event ordering, so a stuck/disputed event never blocks another. Editing an expense
changes the owed and thus re-opens the event automatically when coverage falls short (Amit's option (a),
computed — no destructive deletion, no trigger). `withinEventDebts` splits a person's within-event debt
across that event's fronters (largest-remainder). Both unit-tested (pay-newer-leaves-older-open,
pending-doesn't-count, edit-up-reopens, full-coverage-settles).
* **Confirm-on-return flow**: tapping Settle on an event arms pending settlement rows (persisted), hands
off to Venmo/PayPal (deep link) or shows the Zelle handle to copy; on return the app asks "did it go
through?" → confirm flips pending→confirmed (counts immediately) and notifies each payee via
`create\_notification`; "Not yet" leaves it pending with a persistent "confirm your payment" banner +
Settle-tab-independent nag on Balances. We can't force the pay app to return the user, so this catches
them on return and nags until resolved. No payee verification (trust model) — the notification is a
courtesy heads-up.
* Balances/transfers now count **confirmed settlements only**. The existing global Settle tab is unchanged
(records confirmed, event\_id null) so nothing regresses.
* **Run migration 0114** (after 0113). Per the DB ledger, 0111–0113 are already applied; 0114 is the only
new one. Confirm afterward with `select id, applied\_at from public.schema\_migrations order by id;`.

### 167.3.260715 — standardized header spacing + iOS-safe date fields (app-wide; no new migration)

Two consistency changes that apply across every screen, not just Money.

* **Header spacing is now a default, app-wide.** The shared `<Eyebrow>` header (components/ui.tsx) carries
the benchmark spacing (`marginTop:16, marginBottom:8`) by default — matching the value tee-times already
used. Removed the Money-local `MoneyHead` workaround from 167.0; Money now uses `<Eyebrow>` like
everywhere else. Every screen that uses `<Eyebrow>` gets consistent vertical rhythm for free, and new
screens comply automatically. Standing rule added (APP\_RULES #15). NOTE: this nudges header spacing on
all screens by design — if any specific screen looks off, flag it and I'll tune that spot.
* **Date fields are now guarded for the known iOS bug.** Bare `<input type="date">` renders badly on
iPhone; the compliant patterns are `<ShortDateInput>` or a raw input with `WebkitAppearance:"none"`.
Fixed one non-compliant input (admin analytics date picker in manage.tsx) and added
`ci/check-date-inputs.py` (blocking) to the pre-ship pipeline so a non-compliant date field can never
ship again. Standing rule added (APP\_RULES #16), pipeline updated (HANDOFF §4).
* No new migration. 0114 (from 167.2) remains the outstanding one to run in Supabase if not already done.

### 167.4.260715 — dashboard tile-header consistency (stage 1 of header cleanup; no migration)

First screen in the staged header-consistency pass. Dashboard tile headers are now uniformly `<Eyebrow>`:

* Converted two hand-rolled stragglers: "RUNNING HANDICAP INDEX" (was a bare gold div with no margin →
now standard `<Eyebrow>` spacing 16/8) and "✦ AI COACH" (was fontWeight 800 → normalized to the standard
700; kept `margin:0` because it's a collapsible row header with a chevron, so the tile padding handles
spacing and the chevron stays aligned).
* Left alone (correctly): the sage `sectionHead` divider (label + rule line) — a distinct, already-uniform
pattern, not a tile header.
* Policy codified in APP\_RULES #15: tile headers are `<Eyebrow>`; row-headers with a control pass
`style={{margin:0}}`; lookalikes (pills, chips, column headers, banners, the sage divider) stay as-is.
NOTE for review: "RUNNING HANDICAP INDEX" gains the standard 16px top / 8px bottom spacing it didn't have
before — please eyeball that tile and confirm it looks right before I apply the same pass to the next screen.
No migration.

### 167.5.260715 — header-consistency sweep, app-wide (no migration)

Single pass applying the agreed three-tier header policy across the app (dashboard was 167.4).

* New shared `<FieldLabel>` (ui.tsx) for quiet sage form labels (a tier below Eyebrow section headers).
* Converted hand-rolled section headers to `<Eyebrow>`: money (Payments recorded, ledger bucket titles),
manage (WHAT TO NOTIFY ME ABOUT, NOTIFICATIONS, CLUBS/ANALYTICS/REMOVE FROM APP), achievements (category
labels), compare-stats (all 3), home (WELCOME), player-card (Index\[margin:0]/Badges/Recent form),
organizer (railH3 aligned to standard).
* Money field labels (Zelle contact, Now a member?, Sponsored by) → `<FieldLabel>`; "Guests" title 16→17.
* tee-times aligned to the app standard: dropped its local `EB` header override (was 12px/ls1.8 → now the
standard 11/ls3), screen title "Tee Times" → Georgia serif (was sans), section field-labels → FieldLabel.
* Left as-is (intentional, not tile headers): color-coded course-diff labels (current vs proposed cue),
table column headers, status/badge pills, banners (TEST MODE), the Tier-1 title-size hierarchy, and the
dashboard's sage section-divider.
* Going-forward: APP\_RULES #15 (headers use Eyebrow; tile/row rules) + #16 (date fields). No migration.

### 167.6.260715 — owe reminder is per-club + switches club on tap (no migration)

The top-of-app "you owe" banner no longer lumps clubs together.

* **Per-club reminders**: one line per club you owe in (kept separate, not summed). The club is NAMED only
if you belong to multiple clubs ("You owe $X in Pebble Beach"); with a single club it stays "You owe $X
to settle up".
* **Tap switches club + opens Balances**: tapping a reminder switches the active club to that one (reusing
the same group-switch path the tee-time notifications use), opens Money → Balances so you see the
expenses, and shows a transient toast "Switched to {Club} to view expense" — only when a switch actually
happened (no toast if it's already your active club).
* **Bug fix (from 167.2)**: `loadOwed` counted ALL settlements including pending/armed ones, so a
not-yet-confirmed settle wrongly shrank the owe banner. Now counts confirmed settlements only —
balances and the banner agree.
No migration.

### 167.7.260715 — fix: moving settled expenses into an event showed people owing (no migration)

Bug (reported on Livingston Early Morning Golfers): a group where everything was settled, with ungrouped
expenses moved into a new event, showed the event as people owing money. Cause: per-event settled-state
(167.2) only counted settlements tagged to that event, but the payments that squared those expenses were
tagged to no event (global/ungrouped) and weren't moved with the expenses — so the new event saw the debts
but none of the coverage. Global balances were always correct; only the per-event display was wrong.
Fix: `eventSettlement` now treats a participant who owes nothing GLOBALLY (net >= 0 over confirmed
settlements) as settled for every event — so pre-existing, global-tab, and untagged settlements all count,
and moving already-settled expenses can't make them look unpaid. Participants who still owe overall are
still judged by event-tagged coverage, preserving per-event/dispute handling (pay a newer event, an older
one stays open). Regression test added. No migration.

### 167.8.260715 — Money module hardening + stress battery (no migration)

Full correctness pass on the Money module after the move-into-event bug. Two more bugs found and fixed,
plus a large automated test battery so the core math can't silently regress.

* **Fix — balance breakdown mismatch**: PersonLedgerModal was fed ALL settlements (incl. pending) for its
line items while showing a confirmed-only headline balance, so with a pending settle the lines wouldn't
sum to the shown balance (despite the modal's copy promising they do). Now fed confirmed-only.
* **Fix — contradictory island UI**: in the netting case (globally square but owing *within* an event),
the island showed a "settled" chip AND a "Settle $X" button at once. Settle affordance now gated on
`!settled`.
* **Stress battery** (lib/money.test.ts): adversarial cases (rounding $10/3, cross-event netting, circular
debt, over-settlement, guest multi-hop) + a seeded property-based fuzzer over **3,000 random valid
ledgers** asserting the core invariants every time: (1) balances conserve to zero; (2) personLedger
reconciles to computeBalances for every member; (3) per-event nets sum to zero; (4) withinEventDebts sums
to owed exactly with positive amounts; (5) a globally-square member never blocks a bucket; covered never
exceeds owed; (6) simplify conserves and zeroes. Money suite now 111 assertions, all passing.
* Scope note: the incorrect "owing" was the per-event island display only; the home-screen "you owe"
banner is global-balance based, so genuinely settled members saw no banner.
No migration.

### 168.0.260715 — popup safe-areas (global), event who-owes summary, drop Built line (no migration)

* **Bottom popups clear the nav bar + safe areas (global).** New shared `<BottomSheet>` (components/ui.tsx)
reserves bottom room for the tab bar + iOS home indicator and caps height against the notch. Fixes the
reported Money expense popup whose bottom (and last button) was hidden behind the nav bar. All six Money
sheets patched to the safe pattern; standing rule added (APP\_RULES #17); shared component in place so new
popups comply. Other screens' sheets tracked for migration.
* **Event islands now summarize who owes what.** Under each event header: "All members settled" (green) when
settled, otherwise a plain-language line — e.g. "Ravi owes $50 · Amit gets $50" — built from the per-event
nets, so a viewer instantly sees the standings even when not settled. Detailed per-member paid/net rows
still shown below.
* **Removed the "Built: <date>" line** in Help → version tile (redundant now the date is in the version
number). Dropped the now-unused APP\_BUILT\_AT import.
No migration.

### 168.1.260715 — bottom-popup safe-area sweep + guard (no migration)

Swept every bottom-docked popup for the nav-bar/safe-area rule (#17), and added a blocking CI guard so it
can't regress.

* Found: the manage handicap-override drawer, the notification-bell drawer, and the three tee-times
drawers (RSVP / assign-captain / captain-duties) included env(safe-area-inset-bottom) but only \~10-16px
of it — not enough to clear the \~56px nav bar (these are viewport-fixed, so on iOS PWAs they paint over
the nav). Brought all to the standard `calc(72px + env(safe-area-inset-bottom))`, matching Money.
* Left as-is (correct): the home More-menu — it's the nav's own overflow menu and docks directly against
the nav (`16px + safe`), so it must NOT clear the nav.
* New guard `ci/check-bottom-sheets.py` (blocking): every bottom-docked sheet panel must include
env(safe-area-inset-bottom). Added to the pre-ship pipeline; rule #17 updated.
No migration.

### 168.2.260715 — closed events seal their payments too · MIGRATION 0115

Consistency fix (reported): an admin could "Unmark" a payment on a closed (sealed) event without reopening
it — contradicting "closed = sealed." Now the flow is reopen → unmark, matching how closed-event expenses
already behave.

* **Migration 0115**: `\_guard\_settlement\_frozen\_event` trigger blocks DELETE of a settlement tied to a
closed event ("reopen the event to unmark it") and blocks INSERT of a new payment into a closed event.
UPDATE is allowed so a pending settle armed before the event closed can still be confirmed.
* **UI**: the Unmark button is hidden on closed-event payments (shows a "🔒 closed" note instead); the
unmark handler also pre-checks and tells the admin to reopen first. Reopen the event (existing admin
control on the closed island) and Unmark returns.
* **Run migration 0115** (after 0114). Confirm with `select id, applied\_at from public.schema\_migrations order by id;`.

### 168.3.260715 — Money permission/lifecycle audit fixes · MIGRATION 0116

Full audit of every Money write path against the permission model (who) and lifecycle model (open/closed,
pending/confirmed). Findings + fixes:

* **CRITICAL — confirm-on-return was silently blocked.** `settlements` had no UPDATE RLS policy, so the
pending→confirmed transition was denied by RLS with no error — armed payments never actually confirmed.
0116 adds an UPDATE policy (payer OR payee OR admin). The confirm handler now also checks the result and
surfaces a failure instead of silently swallowing it.
* **Both parties can clear a line (your call).** Payee can now "Mark received", not just the payer "Mark
paid" (admin still can too) — two chances to settle a line item. (INSERT policy already allowed a party;
UI now exposes it to the payee.)
* **Guest retire/un-retire is now creator-or-admin** (was any member). 0116 splits the guest RLS: any
member adds; only the guest's creator or an admin edits/retires/deletes. UI gates the buttons and shows
"added by X" otherwise. (Keys off group\_guests.created\_by; a guest's sponsor can still vary per expense.)
* **A game bet posts to a FRESH event if the game's prior event was closed** (your call). Dropped the
one-event-per-game unique index; ensure\_game\_event now reuses the game's OPEN event or creates a new one.
* **Non-issue confirmed:** group\_pay\_roster is a read-only, membership-checked handles lookup — no bulk-pay
bypass. Event creation stays open to any member (your call).
* Recorded the full who-can-do-what matrix in MONEY\_PERMISSIONS.md.
* **Run migration 0116** (after 0115). Confirm with `select id, applied\_at from public.schema\_migrations order by id;`.

### 168.4.260715 — More menu: visible close + keeps nav visible (no migration)

* The "⋯ More" menu previously covered the bottom nav and could only be dismissed by tapping the (dim,
undiscoverable) backdrop. Now it docks ABOVE the nav (measured nav height via ResizeObserver), so the
nav stays visible and usable, and it has an explicit "MORE ×" header to close it.
* Standing rule #18: every popup/menu needs a visible close control; nav-extension menus sit above the
(always-visible) nav. Bottom-sheet guard updated to recognize above-nav menus as compliant.
No migration.

### 168.5.260715 — one-confirmation-per-line (race-proof) · MIGRATION 0117 (includes 168.4 menu fix)

* **Double-post fixed at the DB layer.** With both parties able to clear a line ("Mark paid" / "Mark
received"), two simultaneous confirmations could post twice and over-count. Migration 0117 adds a
`dedup\_key` + unique index: the client stamps a stable key for the debt line (derived from pair + event

  * how much is already confirmed-settled), so both parties compute the SAME key for the same line and the
DB rejects the second — guaranteed one confirmation per line even under an exact race. A genuinely new
later debt for the same pair carries a different key, so repeat settlements still work. Both settle paths
(arm-pending and mark) stamp the key and handle the unique-violation (23505) gracefully with a refresh.
* **Void-of-settled-expense: confirmed correct, no change.** If an expense is voided after payment, the
payment stays and the payer is shown as owed a refund — which is the intended outcome.
* **Run migration 0117** (after 0116).

### 169.0.260715 — payments recorded at the expense level (stage 2) · MIGRATION 0118

Settlements now carry expense-level allocation lines (the sub-ledger from the design doc). OVERALL BALANCES
ARE UNCHANGED — they're still computed from payment totals; allocations only make per-event/per-expense
attribution exact and traceable.

* `lib/money.ts`: new `allocateSettlement` (FIFO split of a payment across the expenses it clears; unmapped
remainder — e.g. a simplify-rerouted debt — becomes a single general/null line so lines always sum to the
payment). `eventSettlement` now derives per-event coverage from allocations, so coverage FOLLOWS an
expense when it's moved between events (the original bug, now correct by construction). Global-square kept
as a fallback for general/historical (null-expense) allocations.
* Writes: both settle paths (`recordSettlement`, `armSettle`) go through the atomic `record\_settlement`
RPC (0118) — one payment header + its allocation lines in a single transaction, with the sum-check and
party/admin permission enforced server-side. No settlement is ever written without allocations.
* Tests: +9 (allocator sums/FIFO/unmapped-remainder; allocation-based coverage; and the move-carries-
coverage proof). Money suite now 120 assertions, all passing. Overall-balance math untouched (the fuzzer's
conservation/reconciliation invariants still hold).
* **Run migration 0118** (after 0117; run 0117 first if you haven't). It creates the sub-ledger, the RPC,
backfills history as general allocations, and self-aborts via a reconciliation gate if any payment's
allocations don't sum. Confirm with `select id, applied\_at from public.schema\_migrations order by id;`.
No user-facing change except the move case is exact and payments are now traceable to expenses.

### 169.1.260715 — More menu: flush to nav + no background scroll (no migration)

* The "⋯ More" menu no longer floats above the nav with a gap. It's now anchored structurally (an absolute
panel at `bottom:100%` of a wrapper around the nav), so its bottom edge is exactly the nav's top edge
regardless of nav height/safe-area — no measured offset to drift. Removed the ResizeObserver/navH
measurement it relied on.
* The screen behind the menu no longer scrolls while it's open (scrollRef locks to `overflow:hidden` when
moreOpen). Backdrop still closes on tap; the × still closes it.
* CI: global-rules guard accepts the intentional scroll-lock; bottom-sheet guard recognizes above-nav
(`bottom:100%`) menus as compliant.
No migration.

### 169.2.260715 — fix: event-tagged payment's general remainder now counts toward that event (no migration)

Live-trace finding (App Testing group): a payment made toward an event can have a portion that doesn't map
to a specific expense (a within-event netting remainder → a general/null allocation line). eventSettlement
was skipping ALL null-expense allocations, so that remainder didn't count toward the event — making a payer
who settled IN FULL still look short in that event (e.g. paid $50.33, only $42 counted). Fix: a general
(null-expense) allocation now counts toward its settlement's OWN event bucket; only truly global settlements
(no event) stay on the global-square path. Regression test added from the live scenario. Money suite 122
assertions, all green. No migration (pure logic in eventSettlement).

### 169.3.260715 — event summary + balances reflect payments (no migration)

Display catch-up to the payment model (found in the live App Testing session).

* **#1 Event summary now reflects payments.** The event "who owes what" line used raw expense fronting nets,
so a member who had settled still showed as owing. New `eventStandings` subtracts confirmed payments
(expense-tagged + event-tagged general remainder) per member, so a paid member drops off and only genuine
remaining owes/gets show; "All members settled" appears when none remain. Balanced (owes == gets).
* **#3 Balances breakdown attributes payments to events.** personLedger settlement lines now label the
event(s) a payment cleared (via allocations), e.g. "You paid $50.33 to Jonny · E", instead of showing at
the parent level with no event.
* \#2 (how to retract a payment): it's the "Unmark" button in the Settle tab → "Payments recorded" list
(hidden only for closed events). No code change; can surface it more prominently if wanted.
* Tests +5 (eventStandings). Money suite 127 assertions, all green. No migration.

### 169.4.260715 — "covered" reflects real payments only (no migration)

Live finding: after unmarking the only payment, event E still read "$42 of $97.67 settled" — the global-square
rule was counting a net-creditor member's unpaid share as "covered." Fix: the covered dollar figure now sums
ACTUAL payment coverage only; global-square still decides whether an event is fully settled (keeps a
fully-squared group green) but no longer inflates the "$X settled" number. So with no payments, an event
reads "$0 / owes full" as it should. Regression test added. Money suite 129 assertions, all green. No migration.

### 169.5.260716 — comprehensive money scenario suite + two logic fixes (no migration)

Wrote and executed a full math-logic + process/workflow test plan (lib/money-scenarios.test.ts): 11 named
workflows (settle, unmark, move-in/out, dispute, net-creditor, global-square, re-mark, guest, multi-payer,
edit) each asserting derived state after every step, plus a 1,500-run RANDOM-WORKFLOW fuzzer that applies
random action sequences and checks invariants after EVERY step (conservation, covered<=owed, standings
balance, allocation sums). Now part of `npm test`. It caught two real holes, both fixed:

* **global-square was too generous.** It settled any member who owed nothing NET — including net creditors
(owed overall), so an event whose only ower was a creditor showed green "settled" with $0 paid. Now it
applies only to members who are FULLY square (net exactly 0, i.e. actually paid up); a net creditor still
owes their in-event share until it's paid/netted.
* **eventStandings could go unbalanced** (owes != gets) in cross-bucket cases (independent flooring). Rewrote
it to compute a signed remaining position per member, which sums to zero by construction — owes == gets
always.
Main money suite 129 + scenario suite 118, all green. No migration.

### 169.6.260716 — settle asks the REMAINING amount, not the raw share (no migration)

Live bug: event F asked Amit to settle $188.75 (his raw within-event share) even though he'd already paid
$170.42 toward F via a parent-level payment — it should have asked for the $18.33 remainder. Cause: the
settle action used raw within-event debt and only subtracted payments TAGGED to that event, missing
parent-level/global payments whose coverage landed on the event. Fix: new withinEventDebtsRemaining computes
each ower's debt from the post-payment standings (eventStandings), and both the event's "Settle" button and
armSettle now use it — so a re-settle only asks for what's genuinely left, routed to whoever is still owed.
Regression test proves raw 188.75 → remaining 18.33. Money suite 132 + scenarios 118, all green. No migration.

### 169.7.260716 — test hardening: intent/round-trip property (no app change)

Answering "why did the suite pass while real bugs slipped?": the suite tested the pure lib with
self-consistency invariants (conservation, balance) — but (a) the test oracle shared the app's mental model,
(b) invariants aren't user-intent, and (c) two live bugs lived in the COMPONENT, which the lib suite doesn't
cover. Added an INTENT/ROUND-TRIP property to money-scenarios: across 1500 random states, the settle OFFER
must equal the member's true remaining (computed independently from standings), and an ower who pays the
offer must end EXACTLY square — never overshoot. This is the check that would have caught the $188.75 bug.
It passes. Standing principle going forward: the component must derive all money figures from the tested lib
(no inline math). No app-code change this version; test-suite only.

### 169.8.260716 — one settle surface: club-level only, "As entered" is view-only (no migration)

Collapsed the settle model to a single canonical surface, eliminating the cross-surface/cross-basis bug
family (event-vs-club, simplified-vs-as-entered double-pay).

* **Event islands no longer have a Settle button.** They show each event's settled state (from allocations)
and, if you still owe, a note to settle from the Settle tab. All settling is club-level; club payments
allocate down to events (audit trail + per-event settled-state retained).
* **"As entered" is now read-only** — it shows who owes whom by expense for reference, with no Mark/Pay
buttons. Settling happens only from **"Fewest payments"** (simplified), which is derived from net balances
so it can never over-settle. This fixes the bug where, after clearing everything, the as-entered view still
asked for (stale, cycle) payments that would have corrupted balances.
* The view toggle is now a local per-user view switch (anyone can flip to the reference view); settling is
always via Fewest payments. The event-level arm/pending machinery is retired from the UI (club Venmo flow
via startPay is unchanged).
No migration.

### 169.9.260716 — move-with-payments guard + retire event-level arm/pending (no migration)

* **Move guard.** You can no longer move an expense in or out of an event that has recorded payments —
those payments were settled against a fixed set of expenses, so moving would misroute their coverage
(the settle-then-move bug). The move is blocked with a message to unmark the event's payments (Settle tab)
first. Checks both the source and destination event (event-tagged settlements OR club-payment allocations
landing on the event's expenses).
* **Dead-code cleanup.** Removed the orphaned event-level settle path (`armSettle` + the `onSettleEvent`
prop) left over from removing the event-island Settle button. The club-level Venmo flow (startPay) is
unchanged. (The `payChoose` modal is now inert; left in place for a later dedicated cleanup.)
No migration.

### 169.10.260716 — cross-club isolation test (no app change)

Added a scenario proving a member in two clubs has each club's balances/simplify computed independently
(no cross-club netting), mirroring the loader's per-group filtering. Scenario suite now 125 assertions.
Test-only; no app-code change.

### 170.0.260716 — admin "Untangle payments" view, read-only first increment (no migration)

New admin-only screen for resolving erroneous entries. Reachable from Balances (admin only) → "Untangle
payments". Responsive: single-column card layout that works on both phone and desktop.

* **Reconciliation banner**: recomputes club balances and confirms they net to $0.00 (or flags the gap).
* **Member picker** (ranked by |balance|) → shows that member's full itemized ledger via personLedger:
every expense share and every payment (with allocations), each with its signed effect and a running
balance that ends at the member's true net.
* **Audit log**: recent money changes (expense add/edit/void, settle/unmark) with actor, from group\_activity.
This increment is READ-ONLY (highest value, zero risk). Next: per-line Void (soft-delete, reversible) /
Unmark / Edit (new version, keeps audit) with a live balance-impact preview before commit, per the mockups.
No migration.

### 170.1.260716 — impact-confirmation modal on add / edit / void (no migration)

Adding, editing, or voiding an expense now pops a confirmation that previews the balance impact before it
commits. New pure helper expenseImpact(beforeShares,beforePaid,afterShares,afterPaid) returns the signed net
delta per member (guests resolved to sponsors); it always sums to $0 for a valid change. The Save/Add button
and the Void button open a shared <ImpactModal> showing each affected person's +/- change; only Confirm writes
to the DB. Void shows the same preview (danger-styled) before removing. Tested: 9 new assertions for
add/edit/void deltas (all conserve). Money suite 141. No migration.

### 170.2.260716 — impact confirmation on mark-paid + unmark too (no migration)

Extended the impact-preview modal to the two remaining direct money actions: marking a payment paid and
unmarking one. Marking shows payer +$X / payee −$X; unmarking shows the inverse (danger-styled). Both now
route through the shared <ImpactModal> in SettleScreen — Confirm commits, Cancel aborts. The Venmo/PayPal/Zelle
flow keeps its own confirm-on-return. No migration.

### 170.3.260716 — untangle actions + expense soft-delete (migration 0119)

Migration 0119 adds expenses.deleted\_at (soft delete) + a partial index; all reads now filter deleted\_at is
null. Void is now a SOFT delete (reversible) instead of a hard delete — the expense is hidden from balances
but restorable. The admin Untangle view is now actionable:

* Expense rows: **Edit** (opens the editor → new version, keeps audit) and **Void** (soft-delete, impact
preview first via ImpactModal).
* Payment rows: **Unmark** (impact preview first).
* **Voided expenses** section lists soft-deleted expenses with one-tap **Restore** (inline confirm).
* Reconciliation banner + audit log (now includes expense\_restored).
All destructive actions preview their per-member balance impact before committing. RUN MIGRATION 0119.

### 171.0.260716 — feature mirror: App Testing can assume any club's feature set (no migration)

New effectiveGroupId(groupId) helper in lib/golf: the App Testing club maps to a mirror target so its feature
gates behave like another club's, without touching that club's data. Defaults to TGC, so App Testing now has
the full TGC workflow — Tee Times nav, money-game betting defaults, clean-sweep posting to Money, six-hole
subtotals, member-tee defaults. All 8 TGC gate sites (home nav, tournaments tee/sweep/sixes, manage edition)
now go through effectiveGroupId. A "Feature mirror (testing)" control in Club settings (shown only for App
Testing) lets you point it at TGC, any other club, or off — per-device (localStorage), reloads on change,
copies/changes no data. Server side is membership-gated throughout (tee\_times RLS, bet→money inserts), so no
server changes needed. No migration.

### 171.1.260716 — mirror also sources the course library (no migration)

Fix: when App Testing mirrors a club, the tee-time course dropdown (favorite\_courses.group\_id) and the
game-creation course list (loadCoursesForGroup via group\_courses) were still reading App Testing's own
(empty) courses, so no courses showed. Both now read from effectiveGroupId, so mirroring TGC surfaces TGC's
course library for tee times and games. Read-only lookups (RLS lets a member of the mirrored club read them);
tee times / games / money still write to App Testing. No migration.

### 171.2.260716 — real-time Tee Times (migration 0120)

The Tee Times tab now updates live instead of only on pull-to-refresh. Added a Supabase realtime subscription
(channel per group) on tee\_times (group-filtered) and tee\_time\_rsvps; any change reloads the tab. Migration
0120 publishes tee\_times + tee\_time\_rsvps to the supabase\_realtime publication (idempotent, guarded). RLS
scopes which events each client receives. RUN MIGRATION 0120.

### 171.3.260716 — live-test bug batch

Fixes from App Testing (mirroring TGC). No new migration (still requires 0120 from 171.2 for realtime).

* **Guest handicap (game setup):** the inline "NEEDS HCP" field committed on the first keystroke, so typing 11 recorded 1 and the field vanished. Typing no longer commits; a ✓ button confirms, and a committed index shows an "edit" link.
* **Waitlist → game roster:** creating a game from a tee time seeded the roster from every "in" RSVP including waitlisted signups. Now excludes anyone in the waitlist set (a member's guest correctly consumes a spot).
* **Post bet winnings blocked despite sponsor:** buildPostNets returned null for two different reasons but both showed "Assign a sponsor for each guest first." The real cause was guest-record creation failing on a name collision (guest already in the group). findOrCreateGuestId now falls back to the existing same-name guest, and the two failure modes show distinct, accurate messages.
* **Settle default:** the Settle tab now always opens on Fewest payments (As entered is a read-only reference view).
* **Confirmation modal:** the impact modal for settle / mark / unmark / add / edit / void now shows each person's resulting club balance (e.g. "owes $37.50 → settled up · owed $45.00 → owed $7.50") instead of raw +/- accounting deltas.

### Open — under investigation (needs live data, not guessed)

* **"$37.50 paid but $27.50 settled" on the bet event:** a club-level settle allocates FIFO (oldest first) across ALL of the payer's fronted expenses the payer shares, including closed events. Jonny's $37.50 net payment appears to have paid an older debt first, leaving the bet under-covered on the per-event view even though the overall pair balance is likely square. Needs a ledger trace before any allocation change.

### 171.4.260716 — settled events read consistently (display only, no lib change)

Traced the "$37.50 paid / $27.50 settled" report against live App Testing data: the money is correct — every
pair is globally square (conservation = 0). Jonny's $37.50 club-level payment FIFO-allocated $10 to an older
Tip debt (event E) and $27.50 to the bet; Ameya's $7.50 landed on Golf cart (event F). So the bet expense
only shows $27.50 of allocation coverage even though everyone is settled.
The real defect was a display contradiction: eventSettlement flags the event "settled" (it honours global
square), but eventStandings is allocation-literal and still listed "Jonny owes $10." Fix is display-only —
when an event is settled we now show "All members settled" instead of the per-event allocation remainder, so
the badge and the line always agree. eventStandings and all settle/offer math are unchanged (a clamp attempt
in the lib broke the event-balance and settle-offer invariants and was reverted). Full suite green.
Known cosmetic note: while an event is only PARTIALLY settled, the "$X of $Y settled" chip counts coverage
allocated to that event's expenses, so a payment that FIFO-lands on an older event can make an event look
less-progressed than the payer expects. The overall balances are always correct; revisiting per-event
coverage display is a separate design task.

### 172.0.260716 — one ledger: settlement is club-level only (display/flow, no money-math change)

Resolved the two-ledger conflict at its root by removing the second ledger. Events no longer claim to be
"settled" — that was a per-event lens that can only reconcile with the club lens by fiat, which is what
produced the "$27.50 of $45 / Jonny owes $10" contradiction. Now:

* Event islands show only the expenses and the raw per-member split (paid / net) as a record. Removed the
settled / "$X of $Y settled" / outstanding badges and the per-event standings line.
* Settlement happens exclusively in the Settle tab, club-level, Fewest payments. Removed the
As-entered / Fewest-payments toggle (Fewest payments is the only mode; overall balances are the source of truth).
* Event close is now a no-gate "Archive event" (option a) — no longer requires the event to look settled.
Archived events are relabelled from CLOSED and now also show the split for the record; reopen unchanged.
* Removed eventSettlement / eventStandings / withinEventDebtsRemaining / pairwiseDebts usage from the UI.
lib/money.ts is UNCHANGED — allocateSettlement and all balance math untouched. Full suite green.
Disputes workflow: fix the numbers in the event (edit / void / restore, all reversible), then settle at club
level. If a dispute surfaces after payment, unmark in the Settle tab, correct, re-settle.

### 172.1.260716 — drop the "open" pill from event cards

The active-event card was showing a green "open" pill, which read like the old "outstanding" settlement
status and re-created the exact confusion 172.0 removed. Events don't reflect settlement anymore, so the pill
is gone — an active event shows only its expenses and split. Archived events keep the "archived" tag (that's a
real lifecycle state). Display only; no lib or schema change.

### 173.0.260716 — Buckets: per-Bucket settlement worlds rolling up to the Club (migration 0121)

The money model, reworked from first principles. A **Bucket** (the renamed "event", DB table stays
`group\_events`) is now a self-contained settlement world: its expenses net among its members, its own
confirmed settlements pay those down, and it is SETTLED when everyone in it is net-square. Settlement is
scoped to a single Bucket — `allocateSettlement`/`record\_settlement` always carry the Bucket's `event\_id`,
so no payment ever reroutes across Buckets (the cross-Bucket FIFO netting was the root cause of the
"$27.50 of $45 / Jonny owes $10" contradiction). The **Club** is a read-only rollup: each member's net is
the sum of their Bucket balances (== computeBalances, an exact partition identity). A member can be net-$0
at the Club while owing in one Bucket and owed in another — you settle inside Buckets, never at Club level.

Engine (lib/money.ts, additive — existing functions unchanged): `bucketBalances`, `bucketTransfers`,
`bucketSettled`, `clubRollup`. New tests lib/bucket-model.test.ts — 34 assertions incl. a 1,500-run
multi-Bucket fuzzer proving partition, per-Bucket conservation, Bucket-settled⟺no-transfers, and Bucket
isolation (settling one Bucket never moves another). Full suite green.

UI (components/money.tsx):

* Settle is per-Bucket — transfers computed with `bucketTransfers` and grouped under Bucket headers; each
row carries its `bucketId`; Pay/Mark/Venmo/PayPal/Zelle and the confirm-on-return flow all thread it.
A Bucket with no transfers shows "✓ settled". Recorded payments are labelled with their Bucket.
* `recordSettlement(from,to,amt,method,bucketId)` — now REQUIRES a Bucket; records `p\_event=bucketId`,
`allocateSettlement(...,bucketId,...)`, `settleKey(...,bucketId)`.
* Balances stays the Club scoreboard (net per member); tapping a member shows the per-Bucket breakdown
(PersonLedgerModal groups lines by Bucket, shown even at net-zero).
* Add: the Bucket picker defaults to **General**; "New event" → "New Bucket"; bets still auto-create their
own Bucket; guests still resolve to sponsor within each Bucket.
* Log tab renamed **Activity**.

Migration 0121\_money\_clean\_slate — ONE-TIME clean slate (approved: only disposable test data existed) +
Bucket foundation. Run it ONCE, right AFTER deploying this build (it makes `settlements.event\_id` NOT NULL,
which the previous UI would violate). Guarded by the ledger so re-running never re-wipes. Also creates one
**General** Bucket per club and adds `group\_events.is\_general`.

DEPLOY ORDER: deploy 173.0 first → then run 0121 in the Supabase SQL editor. (0120 from 171.2 is still
required for realtime Tee Times if not already applied.)

