## 211.8.261021 — Scramble: one app player per team, and entered team handicaps (0209)

Owner (Oct 21): at an outing only one golfer per team may use BNN — their teammates stay outside the app (not even as guests), the player enters the team's score, and the team handicap comes from the outing. And for any scramble, the organizer may enter a team's handicap instead of the calculated USGA allowance.

## 211.7.261021 — Scramble: making teams in setup, and editing a scramble's settings

**Teams couldn't be made (owner).** The setup control center's Teams step always opened the "teams" tab — the two-team editor four-ball and alternate shot use. A scramble has no two global teams; its own Teams editor sat on another tab, so the step led to the wrong editor and there was no evident way to make teams. Now the Teams step opens on the editor the format actually uses (scramble → its Teams editor), and a "teams" tab on a format without two global teams moves there too. The control center speaks scramble ("Make the teams — Setup → Teams.", then "4 teams · one leaderboard"), and the format line reads "Scramble · teams of 4 · USGA allowance" instead of the raw key.

## 211.6.261021 — Badges and player cards worked out by the server (0208)

Owner (Oct 21): "have the database do the math". A member's **player card** (the handicap index calculated from their rounds, its trend, recent form and round count — seen by club-mates, and compared by the admin sandbagger check with the index they ENTERED) and their **badges** were computed on the phone and written as results; a member could overwrite them by a direct request — e.g. set their calculated index to match their entered one and vanish from the sandbagger check, rounds untouched.

## 211.5.261021 — Access-rule review fixes (0207) and the cross-club isolation suite

**Review of every access rule (132) and member-callable privileged function (160)** — owner decisions Oct 21.

## 211.4.261021 — Security contract fixed on GitHub; members' privileges match their row rules (0206)

**Why 211.2 / 211.3 failed GitHub's fresh-database check.** GitHub builds its test database with Supabase's real image, where members (authenticated) and signed-out visitors (anon) receive EVERY privilege on every new public table and function by default — as in production. The local test database's Supabase shim mirrored that only for service_role, so locally migrations produced fewer permissions than Supabase, the contract passed locally, and on GitHub it found 27 member-writable tables without the approved-accounts rule. App behaviour was never affected.

## 211.3.261021 — Defence in depth for signed-out visitors (0205)

Measured before this: signed-out visitors (anon) held Supabase's default full privileges on the 12 core tables, and could call 83 privileged (SECURITY DEFINER) functions, including admin ones. Nothing was exploitable — row-level security refused every table and every function refused internally — but each protection was one layer.

## 211.2.261021 — The security contract: every release checks permissions and privacy, without exceptions

Owner (Oct 21): "each version needs to check [RLS security and integrity] without compromise." Before this, CI checked each migration's wording, that every table had row-level security on, and exactly pinned the rules of 12 core tables — but a migration could loosen a rule on any of the other ~48 tables, add a member-writable table without the approved-accounts rule (0197 was only a written note), or make a privileged function callable by signed-out visitors, and nothing would fail. Measured today: 47 tables refuse a signed-out visitor outright, 12 return nothing, none showed a row; no anon-callable privileged function is exploitable — but only because every migration so far happened to be careful.

## 211.1.261021 — Scramble

The Scramble format, end to end (owner-approved mock and decisions, Oct 20): every player hits, the team picks the best shot, everyone plays from there — one score per team per hole.

## 211.0.261021 — Scramble foundations (not yet selectable)

The groundwork for the Scramble format (owner-approved mock, Oct 20): every player hits, the team picks the best shot, everyone plays from there — one score per team per hole. Owner decisions: team sizes 2, 3 and 4; one leaderboard or team v team (both); an optional drive requirement (off by default); handicap strokes hole by hole; no betting. Nothing is visible to members yet — the format isn't offered in the game picker until the screens are built (next releases).

## 210.12.261020 — Admin sees every club; "last active" instead of "last sign-in"

**Admin sees every club (0202).** Player admin listed Jigar Shukla in LEMG but not PA-NJ golfers, which he runs. The rules for CHANGING memberships already allowed system admins in every club; the rules for READING clubs and memberships never had the same exception, so five Admin screens silently showed only the owner's own clubs — Player admin (memberships, its add-to-club list), Admin → Users (admit-to-club list), Club reports (club picker), Clubs oversight (test-club markers) and course reviews (club names) — and removing someone from a club the owner isn't in silently did nothing. Now system admins can read every club and membership (matching what they can change); members still see only their own clubs. Pending clubs show by name, marked "(pending)". ci/assert-admin-reads-clubs.sql — fails on the old rules ("a system admin cannot see a club they are not in"); the live security baseline records the two rules' new wording.

## 210.11.261020 — The app opens on the dashboard, not a finished game

**The bug.** Opening the app first checked whether the member was last inside a game room (a note saved on the phone) and, if so, reopened Games — which restored that game — without checking whether it had finished. Once a game had been opened, the app kept returning to it after it was completed. (An unfinished solo round, a half-done setup and a course edit already checked that they were genuinely unfinished; only the game room didn't.)

## 210.10.261020 — Club notifications open the right club

**The bug.** "Your club 'PA-NJ golfers' is approved…" linked to /?tab=manage&manage=groups — a destination the app doesn't understand (it knows ?tab=groups; there is no "manage" tab). Tapping it in the app was ignored (the notification was still marked read); opening it from a phone notification didn't reach Clubs. The approval itself succeeded. The same broken link was on "Your club's report is ready" (0195) and on the held-sign-up notice to club admins (0189, /?tab=manage&manage=members).

## 210.9.261019 — A support visit is not a join

The owner entered PA-NJ golfers as a support admin for five seconds, and the club's admin was told "Amit Sud joined PA-NJ golfers." The join notification (0165) treated the temporary support membership (0028) as an ordinary member joining.

## 210.8.261019 — Club requests you can actually see and approve

**The bug.** A club is visible only to its members and its creator — with no exception for system admins — so Admin's "Club requests" list read clubs directly and was ALWAYS empty for anyone else's request. Jigar Shukla's "PA-NJ golfers" (pending since Oct 20) was invisible to the owner. The old Approve / Decline buttons also didn't check for errors (they could notify "approved" after a failed update).

## 210.7.261019 — Real formats in the tests; minimum samples and visible basis; review points 5 and 6

**Messy data, real formats.** The production profile showed BNN's groups play match, skins, Stableford and Trifecta. lib/test-fixtures/messy-games.ts now includes Stableford (a shortened card, a one-score card, a blow-up hole, a guest), skins with carryover (every hole tied, an empty card, a shortened card, a guest) and Trifecta (a 12-hole player and an empty card inside a foursome); every statistics feature runs through them.

## 210.6.261019 — Only completed rounds count toward exceptional play — and it's said plainly

Owner decision (Oct 19, after the production data profile showed 8 of 86 cards were shortened rounds): rounds that stopped early (9+ holes, not every hole) still count as rounds played, but never toward top scores, standout rounds, positions or best scores — and every place that shows exceptional play says so:
- **Recap** (app and shared image), when a game has shortened rounds: "Only completed rounds count toward top scores and standout rounds — Raj (14 holes) and Sam (12) aren't counted." One sentence (lib/round-rules shortenedNote), used word for word by the round-summary email's group section.
- **Round-summary email**, for a member whose own round was shortened: "Your round was shortened (14 holes) — only completed rounds count toward positions and standout rounds."
- **Club report** (club page and email): "Best scores and standout rounds count completed 18-hole rounds only — N shortened rounds this period weren't counted."
Cards under 9 holes aren't rounds at all and aren't called "shortened". Tests: messy data (who is shortened, top scores, the sentence, the member's email, the club report), rendered recap in both modes, the report view.

## 210.5.261019 — One definition of a round; messy-data tests; the data profile

**One definition (lib/round-rules).** What a round is now lives in one place, matching BNN's handicap engine and the recap: a hole counts only with a real (positive) score; fewer than 9 holes is not a round; 9+ is a valid round even if marked complete early; a full card has every hole; a missing handicap index is missing, never 0; alternate-shot scores belong to the pair. Used by the club report, the recap highlights (finishers), the round-summary email and the alternate-shot pair totals. This fixed one more instance of the reported bug: the round email's net position counted empty and partial cards in the field ("5th of 7" where only 5 had full cards). Guard ci/check_round_rules.py: statistics code that writes its own completeness check or converts a handicap index directly fails the build (it flags the 210.4 email code).

## 210.4.261019 — No silent 1,000-row cut-offs, anywhere

Supabase returns at most 1,000 rows per request — for table reads AND for server functions that return lists. A full audit found the pattern well beyond the review's two loaders, including older code: the home screen loaded ALL of a member's holes in one request (the dashboard and handicap would lose the oldest rounds past ~55 rounds × 18 holes; nobody is near that today — max 30 rounds), the Money screen and the home "you owe" banner read every expense, share, payer, settlement and allocation that way, and the money audit trail read oldest-first with a 1,000 cap (it would have dropped the NEWEST history).

## 210.3.261019 — Review points 1 and 3: approved accounts only; corrections keep their protection

**3 · Only approved accounts change data directly (0197).** Sixteen tables accept direct writes from app users; some row rules checked only "signed in" (a pending account could add a shared course or record its own round by calling the database directly). One rule now guards fourteen of them — activity_log, competition_players, competition_sessions, competitions, favorite_courses, game_players, games, group_courses, group_events, group_invites, group_members, groups, holes, rounds: a direct change by an account that is new, pending, suspended, merged or removed — or has no profile — is refused, whatever the table's own rule allows. Deliberate exceptions: profiles (account fields stay locked, 0189) and notifications (marking one's own as read). Server functions keep their own checks. ci/assert-active-accounts.sql (fails without the rule); two older tests now give their test users profiles, as real members have.

## 210.2.261019 — Hardening from the external review (points 2, 4, 7, 8, 9)

**2 · Club report accuracy.** What counts as a round now follows BNN's handicap rule (owner): fewer than 9 holes with real scores is not a round (never scored / abandoned — an empty or one-score card no longer becomes "best gross 0 / 4"); 9 or more counts, even when marked complete early. Best gross and best net: complete 18-hole rounds only (owner: option A). A missing handicap index is skipped, never read as 0 (no fake "20 → 0" most improved). Alternate shot counts toward games, rounds, attendance and rivalries but feeds no individual scoring award (the scores belong to the pair). Standout rounds stay exactly as the recap computes them (full rounds). Tests reproduce each reported case and fail on 210.1.

## 210.1.261019 — Club reports published; whole-number net

**Publishing (0195).** On July 1 (January–June) and October 1 (July–September), 9 am Eastern, each active club with finished games in the period gets its report: built by the 10-minute email tick with the same code as the admin preview (lib/club-report), saved as a FROZEN copy (club_reports.snapshot), shown on the club page ("Club report · July–September 2026 — See the report"), pushed to the club's members ("Your club report is ready"), and emailed. Emails go to THE OWNER ONLY at first (app_settings.club_reports = {"recipients":"owner"}); "everyone" sends to each club's members. Members have their own switch — Profile → Notification settings → Club report emails (on by default) — and a signed one-click turn-off in each email; a round-summary turn-off link can't turn off club reports or vice versa. Members read only their own club's reports. Building and publishing don't need email configured; sending does (production only).

## 210.0.261019 — Head-to-head & partners; club report preview

**Head-to-head & partners** (Profile, owner-approved mock). A member's OWN record only (owner decision): head-to-head from singles — won / lost / halved against each opponent — and partners from four-ball, alternate shot and Trifecta pairs — played, won, points — with "Your best partner". Built on lib/match-outcomes: every finished match, players by account, scored with exactly the recap's functions and "decided" rules (lib/match-outcomes.test.ts checks the winners agree with the recap's). Guests have no account and aren't listed. Hidden until there are finished matches.

## 209.6.261019 — Cup box follows the Cup's lock (replaces 209.5, which wasn't deployed)

209.5's Cup box ignored whether the Cup's schedule was locked. On an UNLOCKED Cup (schedule still a draft — sessions can be added, removed or resized, so the points total isn't final) it would have worked out "need N more to win", a clinch or a winner from a schedule that could still change — contradicting the Cup standings page, which declares no winner until the schedule is locked. Now, like the standings page: an unlocked Cup's box shows the secured score, "Schedule not locked yet — no winner until it is", and "Session 3" (no "of 5"); a locked Cup is as in 209.5. Tests cover both.

## 209.5.261019 — Cup standings on a session's recap

A Ryder Cup session's recap — in the app, on the shared image, and in the round-summary email — shows the Cup's overall standing after that session, right under the session headline (owner-approved mock): "LIVINGSTON RYDER CUP · AFTER THIS SESSION — Red 9½ – Blue 6½ · 12 points left · Red need 5 more to win, Blue need 8"; once a team has clinched, "🏆 Red have won the Cup — with a session to spare"; after the last session, "FINAL … 🏆 Red won the Livingston Ryder Cup" (or "The Cup is shared" / "🏆 Red retain the …" by the Cup's tie rule). The header also says "Session 3 of 5".

## 209.4.261018 — Team colours redesigned; guests scored by the people playing with them

**Team colours** (owner-approved mock). A colour dot right beside each team name — in the create-game form (all three team-format layouts) and at the top of Setup → Teams (the separate 209.1 colour block is gone). Five clearly different colours: red, blue, gold, purple, green (measured: every pair 41+ apart; pink, teal and orange dropped — orange was ~25 from red and gold). Picking the other team's colour SWAPS the two, announced with Undo — nothing is greyed out. Automatic colours say so ("Blue · automatic"); the automatic second-team colour is now GOLD (was orange — older games' orange second teams turn gold). A team named after a colour keeps it ("Colour from the name"); that colour can't be taken by the other team. One rule (pickTeamColour) behind every screen; tests lib/team-colour.test.ts and the rendered lib/team-colour-render.test.tsx.

## 209.3.261018 — Round-summary email (owner only while it's honed)

**What.** About an hour after a round, an email from hi.its.birdienumnum@gmail.com. A GAME round (owner): the group's recap first — the recap card's sections in its order (lib/recap-email; the "how the field played" lines are checked word for word against the card on the same game) — then "Your round": position, net birdies, standout; round stats (fairways, greens, putts and three-putts, penalties, average on par 3s/4s/5s, putts per green hit, sand saves, scrambles — the app's own rules, shown only when recorded on most holes); highlights; the scorecard on cream with the app's circles and squares and a net row. A solo round: the same without the group. If the round changes later, an "Updated:" email (at most hourly, within a week); an unchanged round is never resent.

## 209.2.261018 — GitHub check back on Supabase CLI 2.101.0 (no app change)

209.1 moved GitHub's fresh-database check to Supabase CLI 2.111.0. Its newer database image no longer grants the server role (service_role) privileges on tables by default, so ci/assert-profile-privileges.sql failed ("permission denied for table profiles"). The hosted staging and production databases were created under the old defaults and DO have those grants — the server reads and writes tables directly (push, course checks) every day — so the newer image matched them worse, not better. Back to 2.101.0, whose grants match the hosted databases; its supautils crash is avoided because tests never call a revoked function (208.4). The rebuild still prints the exact image tag.

## 209.1.261017 — Choose which course changes to apply, team colours, Standout watch

**Choose which provider changes to apply (0192).** A course update now lists each change with its own tick box (per tee: rating, slope, yardages; tees added / removed; per hole: par; and ALL stroke-index changes as one item — providers swap indexes between holes, and taking half a swap breaks handicap strokes). Defaults (owner): a change to something corrected by hand starts unticked ("you corrected this by hand on …" — detected by comparing today's course with the provider's last version in course history); a removed tee starts unticked and shows how often it was played this year; everything else ticked. The server rebuilds the list with the same code (lib/course-merge), builds the merged course, and the database re-checks admin rights, the review revision, that the course wasn't edited since, and a valid stroke-index set before saving; one history version names exactly what was taken. Unticked changes are remembered and not asked about again unless the provider's value changes (the course check skips them). The all-or-nothing "Update stored course" button is gone.

## 209.0.261017 — Standout rounds, a new recap order, and Season Wrapped readiness

**Standout rounds** (designed with the owner on the Bowling Green data). Each finished player's Score Differential — USGA method: each hole capped at net double bogey on the full course handicap, then 113/slope × (adjusted gross − rating) — against their Handicap Index. With 8+ scored players, measured against the FIELD's average gap (how the course and conditions played; the idea behind the WHS playing-conditions calculation); smaller groups against the player's own index. Shown when someone beat the field (or their handicap) by 2.0+; "exceptional round" = 7.0+ below their own index (the WHS term). Celebration only — nobody is named for a bad round. Everyone who qualifies is listed, with the context line "The field averaged X over its handicaps (a normal day is about 3)". Verified against the real Bowling Green differentials (field 5.1 over; standouts 3.9, 2.9, 2.9, 2.2), as approved in the mock.

## 208.5.261017 — An automatic game name follows a changed date or course

A game created without a typed name is named "Format / Course / Date". Changing the date (or course) afterwards updated the game but not that name, so the title kept the old date (reported on production, game 445262). Now, when the organizer changes the date or course, an automatic name is rebuilt to match; a name the organizer typed is never touched. The automatic name is recognised by its shape, so a date written differently on another phone still counts. `lib/game-name.test.ts`.

## 208.4.261017 — GitHub check fixed: the crash was a known Supabase bug (no app change)

**Cause, confirmed.** 208.3's probe crashed the database the moment an app user called a function that app users have no permission to run. That is a known defect in Supabase's PostgreSQL 17.6 images up to 17.6.1.111 (in its supautils extension): calling a function the caller lacks EXECUTE on crashes the server instead of answering "permission denied" (supabase/postgres #2112, #2366; supabase/cli #6094; fixed in 17.6.1.121). BNN's code and the merge are not involved — the merge runs as the server role, which the bug doesn't affect.

## 208.3.261017 — Diagnostics, round 2 (no app change)

208.2's run showed the crash happens on PostgreSQL 17.6 (Supabase's image) in the merge test's STEP 6 — after the previews, refusals and remove checks, before the merge itself. Step 6 (a) has an ordinary app user call the server-only merge function, expecting a refusal, then (b) switches back to the admin role. This round:
- splits step 6 into 6a–6d (call, refusal caught with its message, role reset, done);
- adds two standalone probes before the main test: PROBE_A (app user calls the function inside an error-catching block) and PROBE_B (the same call as a plain statement). If either crashes Supabase's build, an app user calling that function from a browser could restart the database — that is what this round establishes.

## 208.2.261017 — Diagnostics for a database crash in GitHub's check (no app change)

GitHub's fresh-database check (Supabase's own Postgres image, CLI 2.101) crashed with a segmentation fault (signal 11) while running ci/assert-account-merge.sql; the same test passes on plain PostgreSQL. A segfault is a defect in the database build or one of its extensions, triggered by something the merge test does. To find what:
- the rebuild prints the exact database version and installed extensions before the merge test;
- the merge test announces each step (MERGE_STEP 1–10, with 7b/7c around the merge itself), so the log shows the last step reached before a crash.

## 208.1.261017 — Fix: "Merge into…" opened off-screen

In Admin → Users, "Merge into…" (and "Duplicate — merge into…" in the sign-up queue) opened the merge panel at the TOP of the list, above every row — so when the row was further down the list, tapping it appeared to do nothing (found on staging, Oct 16). The panel now opens directly under the row or sign-up it belongs to and scrolls into view. `lib/account-gate-render.test.tsx` checks the panel opens inside the tapped row (fails on 208.0, passes now).

## 208.0.261016 — Sign-up approval, duplicate check, and safe account merge

**Why.** Vimal Narayanan ended up with two BNN accounts (work and personal Google accounts, via two clubs' invite links). The club "Delete permanently" button then half-deleted the duplicate — five browser-side steps, the last blocked by privacy rules without an error, so it reported success while the profile, the session and the email all remained. The old system "merge" (0032) and "wipe" (0038) missed most account references, including the money ledger.

## 207.3.261015 — Version bump for a clean staging deploy (no code change)

Same code as the final 207.2 (the redesigned recap with its three wording fixes). Renumbered so the deployed version is unambiguous: an earlier 207.2 build was found on staging (its recap said "4 singles matches played"). Check: staging should show 207.3.

## 207.2.261013 — Game completion recap and announcement

**The recap.** A finished game opens on its recap, at the top of Play: the result headline by format — team formats "Red beat Blue 3–1" (decided points only); Trifecta the same from its contests; individual singles each player's own match ("you beat Karan 3 & 2"), with no invented overall winner; Stableford / stroke play the winner by the game's own ranking; skins the skins outcome — then "Ended early" with what was unfinished (never counted as settled), your own line, course · date · format · holes played, the money STATUS (posted · not posted · needs review — never an amount), a "results changed since they were announced" note after corrections, and for a Cup session a link to its standings.

## 207.1.261013 — Admin → Courses: what data is in use, what's wrong, what to do next

Each course row now leads with one headline (Review required · Latest check failed · Provider data incomplete · Not checked yet · Up to date) and then, separately: **Current data** (when it last changed, how, and by whom — from 207.0's history); **Last compared with the provider** (the last COMPLETE comparison — a failed or incomplete check no longer hides it); **Latest check** (any outcome, with the reason); the **review state** (changes awaiting review with the FULL count; kept as-is with the date and reason; applied; matches); and member corrections awaiting approval. A failure and a pending review are both shown. Filters: Review required · Failed / incomplete · Not checked · All. "Review changes" opens the course; details also hold the History.

## 207.0.261013 — Course history and restore

Every change to a shared course's content — data, name, facility, location, provider link — is now kept as a version, and a site admin can restore any earlier version as a new one.

## 206.2.261013 — Review follow-ups: manual team moves atomic, guest lookup gated, scheduled check validated, mid-check edits caught, name reversal saved

Second-pass review of 206.1 (Oct 13). Items 1, 3 and 5 completed fixes that 206.x had applied to one path but not a second; 2 and 4 were genuine edge cases.

## 206.1.261013 — Money refresh, atomic team balancing, honest push delivery, ordered team-name saves (review findings 5, 4, 10, 9)

**5 — A failed money refresh showed wrong balances (High).** Every money query treated an error as "no rows". Now the balance-critical set (expenses, shares, payers, settlements, allocations) is all-or-nothing: if any fails, nothing on screen is replaced, a notice says the figures are from the last complete refresh (with Retry), and every money action is blocked by the one write gate until a complete refresh succeeds. `lib/money-refresh-render.test.tsx` mounts the real Money screen with the network intercepted: on the ORIGINAL code one failed settlements refresh shows "Amit Sud (you) owes $45 · Karan Sarin is owed $45" for a debt already settled, with no warning; on the fix the settled balances stay, the notice shows, settling is paused, and a good refresh clears it.

## 206.0.261013 — Course freshness: server-side checks, approval of an exact revision, full comparison (review findings 1, 2, 3, 6)

**1 — "API data" could be supplied by an ordinary member (High).** The browser fetched the provider, computed the comparison and handed both to `record_course_freshness`; an admin's approval then wrote that payload into the shared course. That function is REMOVED (0183). The browser now sends only a course id to `POST /api/courses/freshness`; the server reads the stored course, fetches GolfCourseAPI with its own key (`lib/provider-course.ts`, also used by `/api/courses`), validates, compares, and records through `record_course_freshness_checked` — service role only, with the member's club membership verified inside the database.

## 205.4.261013 — Season Wrapped: "seen" actually saved; matches against guests counted (review findings 7, 8)

**Finding 7 — opening a summary did not persist "seen".** `void createClient().rpc(...)` discarded a lazy Supabase request builder, so no request was ever sent: the banner returned on reopening and on other devices. Now awaited (`markSeasonSeen`), and "seen" is recorded locally only once the server confirms it. `lib/season-seen-request.test.ts` counts real network calls: the old pattern sends 0, the fix sends exactly 1.

## 205.3.261013 — Security: two hand-made production tables without RLS; a live guard so it cannot recur

**What Supabase found (2026-10-11).** Two public tables on production with Row-Level Security off: `course_id_pre_reconciliation_snapshot` and `course_id_reconciliation_tmp`. They were not created by any migration — they were made by the one-off course-id reconciliation run by hand on production before 177.20 (Aug 2026) and never dropped. Contents: course reference data only (ids, names, facilities, locations, provider ids, match notes) — no users, scores or emails. RLS was enabled on both on Oct 13 as an immediate fix.

## 205.2.261013 — Season Wrapped: every club, per-account banner, "season summary" wording

**Every club.** A season summary already covered all of a golfer's rounds and games whatever the club; the club card picked one club. It now lists every club the golfer played in that year — the club's rounds and your own, your rank only where top three — and "played most with" across all of them. Migration 0181 also corrects `season_club_stats`: it counts rounds PLAYED IN each club (`rounds.group_id`), where 0180 counted every round by every member, so a golfer in four clubs showed the same 26 rounds in all four (caught on real data before release; the assertion now covers a golfer split across two clubs and fails on the 0180 function).

## 205.1.261013 — Season charts labelled by month

The season's differential and putts charts numbered every round along the x-axis (1 … 26), which crowded it to unreadable on a phone. They now carry one label per month, at the first round of that month (Apr · May · Jun …); bars stay one per round, in date order. `FormBars` gained optional `ticks` / `tickFormatter`; without them it behaves exactly as before, so the Dashboard's Scoring Form is unchanged. Client-only; no migration.

## 205.0.261013 — Season Wrapped: the year-end summary

Every golfer's season, Jan 1 – Dec 31, as a one-minute story, a share card and a look-back.

## 204.3.261013 — Outlook line disappears once every match is decided

"If every match ended now" is redundant once nothing is still out — the decided score above it IS the result. Hidden in all three team formats when no match remains open; the rendered test checks a fully scored Trifecta shows no line. Client-only; no migration.

## 204.2.261013 — Ending a game with a running clock (BN163); outlook figures in the scorecard face; staging auto-score

**BN163 on End game (staging 718817, ended after 9).** `finish_game_and_post_rounds` closes every still-running round clock; the 0163 reset fence treats that as a score write and requires the score context that only a scorecard established, so ending a game with any clock open failed — hidden at 18 holes because clocks were normally closed by then. Migration 0179 sets the context inside the function for its own write; nothing else changes. Asserted on the full chain: the exact failure on the old function, success on the new.

## 204.1.261012 — Balanced matchups: like plays like, as a starting point captains can edit

What already existed, under a dice: singles has "Build balanced matches" (nearest playing handicap across the teams — like plays like) and the team formats had "Build balanced groups", which EVENED THE FIELD — each team's strongest pair was put against the other's weakest so every group had a similar mix, which is the opposite of a balanced match.

## 204.0.261012 — Match status under the group card; one standings convention; the singles table everywhere

**Group card.** For four-ball, Trifecta and alternate shot, the group's Results card now sits directly under the group scorecard — the same component the Results tab shows, with the group's name header and pair boxes suppressed (the scorecard above already names the four) and headed "Match status". Three contest rows with the gold leader, the points line, nothing new to learn. Placed below, not pinned, so it never covers scores.

## 203.4.261012 — Balance teams keeps equal numbers

Reported on a real field: with skewed handicaps, Balance by handicap could put more players on one side than the other. The "give the next player to the lighter side" step had no count limit, so a 30 against three 2s went 1 v 3. Equal numbers are the hard rule and now come first: team sizes are fixed up front (equal, or one apart for an odd field), the draft deals only into teams with room — preferring the lighter side among those — and a swap pass then narrows the handicap gap without changing counts. The skewed case gives {30, 2} v {2, 2}, the best possible with two a side. Tests: that case, 60 random fields of 4–20 players all with equal (or one-apart) counts, and a small field where the swap pass finds the best equal split; the old rule fails the new test. Applies to the game Teams tab and the Ryder Cup roster alike. Client-only; no migration.

## 203.3.261011 — Ryder Cup roster: "who is playing" back in front of balancing

203.1's Balance by handicap index dealt the whole club roster onto two sides, removing the step where the organizer chooses who is in. Each roster row now has an **In** tick (tapping a team button also marks the player in; untick clears their side), with **Everyone in** and **Clear** shortcuts and a count of who is in. Balance deals only the players who are in, leaves everyone else out, and asks for at least two. Sides can still be set by hand with the team buttons, as before. Client-only; no migration.

## 203.2.261011 — Team names save as you type; verification-sheet convention retired

**Team names.** On the Teams tab the names now save themselves — 700 ms after the last keystroke and on leaving the box — with "Saving… / Saved" inline and any error shown in place. The "Save names" button is gone: it was redundant, and after the game reloaded (balance, another device) its enabled/disabled check compared stale edits with fresh names and appeared to do nothing. The boxes also follow the game when it reloads under them. `renameTeams` now throws on failure so the panel can show why.

## 203.1.261011 — Balancing requires every handicap first; Ryder Cup roster balances by index

**Games.** Balance by handicap now refuses to run while any active player lacks a course handicap, naming them: "Set a course handicap for Dan Lee, Ed Park first (Players tab), then balance." A zero placeholder would have skewed the sides and forced a re-run once the handicap was set.

## 203.0.261010 — Balance teams by handicap

Game setup → Teams gains **⚖️ Balance by handicap**. The basis is each player's Playing Handicap for THIS game (the engine's `chBasis` × allowance, rounded — the number the match is played off, not the index). Method: snake draft on descending playing handicap, always handing the next player to the lighter side, so sums and the top-to-bottom spread stay close; ties keep roster order so a re-run gives the same answer. Players who already have a score are locked to their team and counted on it; no-shows are ignored; a player with no course handicap yet is placed last, counts as 0, and is named in the result. One confirmation shows the outcome before anything is written — "Red 61 (avg 12.2) · Blue 60 (avg 12.0) — difference 1 · 6 players will move" — and only players whose team changes are written. The result line stays on screen afterwards.

## 202.6.261009 — Team band a few shades darker

The 85%-cream tint read too light on the phone. The band is now 30% team colour / 70% cream (red #e5cac6, blue #c8d1e0), chosen from a real render; the contrast test still proves dark text ≥ 4.5:1 on both and on yellow, violet, grey, gold and black. One number in `lib/team-tint.ts`; the public page and the group card both follow it. Client-only; no migration.

## 202.5.261009 — No box around the arithmetic toggle

iOS draws a bordered pill around any <button> unless its appearance is reset, even with border:none; the "Tap for the handicap arithmetic" control showed one. Reset (appearance none, no outline/shadow/radius, inherited font). The chevron stays. Client-only; no migration.

## 202.4.261009 — Line-up rows: tinted team band behind the name; grey chevron toggle for the arithmetic

Chosen from four rendered options: the team is shown as a **light tint band behind the name row** (option B) instead of 6px side bars — on the public page and the group card alike. The band is a tint of the team colour, not the colour itself (`lib/team-tint.ts`: the colour mixed ~85% into the cream card), so the dark text never changes by team; the test proves ≥ 4.5:1 for the two colours in use and for yellow, violet, grey, gold, black and pure red, which answers "what if the teams were Yellow and Violet". Team colours remain fixed by team order (first red, second blue) and each row still prints the team's name in words, so "Sharks v Jets" reads correctly with the bands as markers.

## 202.3.261009 — Line-up page: the handicap arithmetic opens from a visible button

"Tap for the handicap arithmetic" was plain text; the actual tap target was the player's name row above it, which nobody could know. The arithmetic now opens from a real button under each row — "Show the handicap arithmetic" / "Hide the handicap arithmetic", underlined, 24px tall — and the name is no longer a tap target. The rendered test mounts the page, taps the button and asserts the arithmetic appears. Client-only; no migration.

## 202.2.261009 — One rule for shortening names: first name, then last initial, then full name

A game with three Amits showed three "Amit"s. Twenty-seven separate `split(" ")[0]` sites across seven files each shortened names on their own. `lib/short-names.ts` is now the one rule, decided per set shown: first name; if it collides, first name + last initial ("Amit S", "Amit B"); if that still collides ("Amit S" twice), the full name for those two. Single-word names stay as they are; the comparison ignores case and spacing, the label keeps the person's spelling. The same person is "Amit" in a foursome with no other Amit and "Amit S" on the full leaderboard — what a human would do.

## 202.1.261008 — Readable links for the live scorecard and competition pages; security dependency bumps

**Links.** Every public link now reads as something. The live scorecard uses the game's slug from 0177 — one slug, one switch, two pages: `/live/bowling-green-golf-club-oct10-7h3k2p` and `/lineup/…` the same. Competitions get their own: `/live/cup/fall-ryder-cup-oct10-m4x8rq`, minted by `set_competition_share` when sharing is turned on and cleared when it is turned off. Tokens keep working, so links already in chats do not break. Migration 0178 redefines `get_live_scorecard` and `get_live_competition` from their 0155 bodies with only the lookup line changed, and both slug makers guarantee the 16-character minimum the readers require (a one-letter course name is padded). Asserted on the full chain: both pages resolve by slug and by token; a guessed competition slug resolves to nothing; revoke clears the slug.

## 202.0.261008 — Readable line-up links: /lineup/bowling-green-oct10-7h3k2p

The link in the chat read as a jumble (`/lineup/83c53…`). It now reads as the course (or game name) and match date plus six characters from a confusion-free alphabet (no 0/O/1/l/I): `/lineup/bowling-green-golf-club-oct10-7h3k2p`. The words are for reading; the six characters (29^6 ≈ 594 million) are what authorizes — a link anyone could guess from the club's calendar would be a public page, not a share link. Asserted: a guessed slug with the wrong code resolves to nothing.

## 201.8.261008 — The line-up link shows the match date, not the day it was created

The link's title and header read today's date for Saturday's game: 0173 returned `created_at` because its author believed games carried no play date. `games.played_at` is the match date (a DATE column; 0110 calls it "the game's MATCH date"). Migration 0176 returns it as `played_on` (YYYY-MM-DD, falling back to created_at in Eastern only when unset); the page, the chat preview and the group card format it on the device as "Sat, Oct 10, 2026" — weekday and year, built as a local date so it cannot shift a day across the UTC boundary. The full-chain assertion seeds a Saturday match created on a Thursday and requires the Saturday; its first run caught an off-by-one in the migration (applying `at time zone` to a DATE in a UTC session yields the previous evening) before it shipped.

## 201.7.261008 — Group picker lists only groups that hold players

201.6's game-order change added every tee-group number ("Grp 1" … "Grp 5") to the picker alongside the named foursomes, so a game whose players all sat in foursomes showed five empty buttons. Only groups that actually contain a player are listed now; tee groups appear only for games without foursomes. Tested both ways. Client-only; no migration.

## 201.6.261008 — Line-up arithmetic prints the course handicap the engine actually uses; groups in game order

Production screenshot (2026-10-08): "Index 14 → Course Handicap 15 × 90% = 13.7 → plays off 14". 15 × 0.9 is 13.5. The engine applies the allowance to the UNROUNDED course handicap (15.2 from index 14 on slope 131; `chBasis` is deliberately unrounded — "rounding belongs at the end of the chain", 181.13), and the card printed the rounded one. The card and the text export now print the exact figure: "Course Handicap 15.2 × 90% = 13.7 → plays off 14". Whether WHS wants the course handicap rounded BEFORE the allowance (Rule 6.2a says it does) is a scoring decision for the owner, flagged in BACKLOG; the card no longer misstates its input either way.

## 201.5.261008 — Public share pages are never served from the service-worker cache; link previews name the game

**Why the scroll fix did not reach the phone.** `public/sw.js` is cache-first for every same-origin request, including `/lineup/<token>`. Safari's worker cached the broken 201.2 page on first open; 201.3 and 201.4 downloaded a *waiting* worker that, by design, activates only when someone taps Update — and a public page has no Update button. Safari kept serving the cached page. `/live/<token>` had the same exposure. Public share routes are now in `shouldBypass()` — always network, never cached — and `ci/check_public_routes_scroll.py` fails the build if either prefix leaves the bypass list (negative-tested). The page footer shows the build version so "which build is this phone on" is answerable from the screen.

## 201.4.261008 — Recurrence audit: every past incident that could recur now has an executable guard

The owner's observation after 201.3 ("we have run into this issue before when creating web links, but it seems we don't learn from past experiences") was correct, and the pattern is specific: lessons recorded as prose — a comment in globals.css, a release note — only work if read at the right moment. The fixes that held this week were the ones that became guards (JSX escapes, design scale, contrast, migration authorization, shell geometry). This release audits DEPLOY_NOTES from 177.x and converts the remaining recurrence-prone classes into guards, each negative-tested with a deliberate violation.

## 201.3.261007 — Live line-up page scrolls (hotfix)

Production, 2026-10-07: the line-up link opened but would not scroll and nothing below the fold could be tapped. `app/globals.css` locks `html`/`body` (overflow hidden, body position:fixed) so the installed app never rubber-bands; a page rendered outside the app shell must own its scroll container — the `/live` page does, with `.live-scroll`, after the identical failure at 184.1 — and the new page did not. It now uses the same container. `ci/check_public_routes_scroll.py` (new, in `npm run guards`) fails the build for any page under `app/live` or `app/lineup` without one; negative-tested. The render test asserts the container. Client-only; no migration.

## 201.2.261007 — The organizer gets the game notification too

Migration 0175: `notify_game_added` no longer skips the organizer. Every player in the game receives the same notification with the same deep link; the organizer's reads "You set up "Saturday Fourball". Tap to open the game." since "Amit added you" is meaningless to Amit. The owner's reasoning: the organizer is a player too, and receiving it is how they know it went out.

## 201.1.261007 — Game deep link; the line-up page tells the truth about opening the app; game_added opens the game

**Game deep link.** `/?game=<code>` resolves, for a signed-in person, to a game they can see (a player or a member of its club), switches to that club if needed and opens the game room; unknown code or no access → the Games tab as usual. Also honoured when tapped from an in-app notification. Nothing is granted by the link: visibility is the game's existing rule.

## 201.0.261007 — Live line-up link for the chat; per-group card; the line-up card redesign

**Why a link.** A line-up image stops working past one foursome — twenty players make an 1,800px image WhatsApp shrinks to a thumbnail, and it is wrong the moment the organizer swaps a pairing. The line-up is now shared as a **live link** (`/lineup/<token>`) that fits a chat at any size, refreshes itself every 25 seconds and on return to the tab, and goes dark when the game ends ("This game has finished, so the line-up is no longer shown"). It rides the game's existing public `share_token` and the organizer's existing on/off switch, so one decision covers the live scorecard and the line-up.

## 200.0.261007 — Line-up card: tee rating/slope, the allowance arithmetic in full, opponents and strokes

Game setup → Line-up showed each player's team and group, a bold number labelled nothing (the course handicap before any allowance — on a 90% game a player read 15 and played off 14 unknowingly), no slope or rating, and no opponent.

## 199.5.261006 — Confirmed on device; diagnostic compares against the shell's own reference

On-device readout after 199.4 (installed, portrait): `appH_var 894px · shellH 894 · navBottom 894 · navTop 844` with iOS still reporting `visualVP_h 611` — the stale value is present and no longer matters. Fix confirmed. The diagnostic's `navBottom_vs_visible` still compared the nav to the visual viewport and read −283 in red while the nav was flush; it now compares against the height the shell is sized to (layout viewport when installed, visual viewport in a tab). `visualVP_h` stays on the panel for diagnosis. The rule is recorded in APP_RULES.md, HANDOFF.md and the project memory. Client-only; no migration.

## 199.4.261005 — Installed app sizes its shell to the layout viewport, not iOS's stale visual viewport

The diagnostic readout from the phone (installed, portrait, no keyboard): `innerHeight 894 · visualVP_h 611 · appH_var 611px · shellH 611 · navBottom 611`. The nav was rendered — 283px above the bottom of the screen, because the shell was sized to a visual viewport iOS had left stale. 199.3's keyboard-gate change was necessary (that stale value also tripped the keyboard heuristic and hid the nav outright) but did not address the shell height, and my explanation of the earlier screenshot was wrong on that point.

## 199.3.261005 — Bottom nav no longer hidden by a false keyboard detection (portrait, iOS)

The bottom nav disappeared in portrait (fine in landscape) on both staging and production, with no layout file changed since July. Cause: `ViewportSync` inferred "keyboard open" from `100lvh − visualViewport.height > 180px`, and the stylesheet hides the nav and grows the shell to full height while that attribute is set. In portrait the phone now reports a gap above 180 with no keyboard — iOS's viewport reporting moved under a fixed pixel threshold. The attribute is now set only while an editable element (text-like input, textarea, contenteditable) has focus AND the viewport has shrunk; without focus the gap is ignored. Focus changes re-evaluate the attribute. `lib/viewport-editable.ts` is the one definition of "summons the keyboard", unit-tested (the dashboard-with-nothing-focused case is the regression). `ci/check_shell_geometry.py` passes on all six device profiles. Client-only; no migration. Hotfix — ship ahead of everything else.

## 199.2.261005 — Test push body no longer carries a server-zone clock

The test push said "sent 2:38am" at 10:38pm ET: the body was formatted on the server, which runs in UTC. The body now carries no time (the device stamps the notification itself). Audited the other server-side writers: SQL notifications format with `at time zone 'America/New_York'`; the delivery/attempt logs and admin lists are formatted on the device. Client-only change; no migration.

## 199.1.261005 — Push delivery log and a test-push button

"Have I ever been sent a push?" had no answer in the app: the webhook decided and sent, and kept nothing. Migration 0172 adds `push_delivery_log`, written on every webhook call — the notification, recipient, type, what the preference decided (push / in-app / off), endpoints tried, delivered and failed, and a result note ("1 delivered to the push service, 0 failed"; "not pushed: this type is set to inapp"; "endpoint gone (410), removed"). The sender is now one shared module (`lib/push-send.ts`) used by the webhook route and by the new `/api/push/test`, which sends a test push to the caller's own enrolled devices (one a minute).

## 199.0.261005 — Course data: act on each course; API attempt log; course-change notices can be pushed

**Course data actions (Admin).** Each row now has: *Refresh from API now* (one provider request; records the attempt, diffs against the stored data and records the review exactly as New Round and the nightly sync do — the shared checker gained a `force` option to skip its 24-hour cache); *Update stored course* and *Keep current* when provider changes are pending (same server functions as the Courses queue); *Approve corrections in Courses* when member edits await global approval; and *Changes & attempt log*, which shows the pending per-tee diff and the last 20 provider attempts.

## 198.1.261005 — Push device health: failing vs dormant, devices named, dead endpoints pruned

Admin → Analytics → Notifications showed "1 failing / stale device — Amit Sud, fails 0, last seen Aug 22". The row was a dead iPhone endpoint: iOS dropped the phone's web-push subscription some time after Aug 22 and re-enrolled it under a new endpoint on Oct 1; the old row lingers until a push to it returns 410, and none had been attempted. The tile counted it as a problem device and the drill-down could not say what it was.

## 198.0.261005 — Admin · Course data: every course, its verification, pending updates and pending corrections, on one screen

Until now the state of a course was spread across three places: the course editor (last API verification, one course at a time), the queue at the top of Courses (pending provider updates, shown only when non-empty) and Pending edits (member corrections awaiting global approval). Admin now has a **Course data** card. One row per library course: linked clubs ("No club" flagged), hand-corrected marker, when GolfCourseAPI last answered and the last attempt's outcome, when the stored data was last compared with the provider and whether that review is pending/dismissed/applied with the change count, and member corrections awaiting global approval with the age of the oldest. A summary line gives the totals and a button opens Courses to act. Default filter "Needs attention": pending updates, pending corrections, failed/drifted last attempt, never verified, or no club.

## 197.2.261003 — Harness binds OS-assigned ports (fresh-database CI fix)

197.1's fresh-database rebuild failed in GitHub with `listen EADDRINUSE :::54612`: the harness's stub provider port was already taken on the runner, where the Supabase CLI's Docker stack also listens and whose port set moved between CLI versions. The local replay runs on plain PostgreSQL and cannot see that stack, so this class of failure is invisible to it; fixed port numbers had already collided once before (54321/54322). The harness now binds both stubs to port 0 and passes the OS-assigned ports to the monitor and the sync. Reproduced locally by occupying both former ports and running the harness: exit 0.

## 197.1.261003 — Course ownership follows the club links, not the legacy group_id

Production, 2026-10-03: the scheduled freshness sync failed on Banks (Forsgate) with "course not found". The row exists; `favorite_courses.group_id` is a legacy column that club delete/merge sets to NULL, while courses are shared records attached to clubs through `group_courses`. Every freshness function since 0124 derived the owning club from that column, so a null-group course could not be recorded, reviewed, dismissed or applied, and the error text was false.

## 197.0.261002 — Course update queue: every club, reopens on new changes, one server-side apply

On 2026-10-02 the scheduled sync flagged three courses and the Courses "Needs review" section showed one. The section (195.0) queried only the ACTIVE club's courses; the other two were pending in other clubs the same admin runs. Reading the code for the fix exposed two more defects: a review once dismissed or applied never returned to pending when the provider changed the course AGAIN (0124), and "Update stored course" was a client-side table write that RLS allows only to the app admin — it worked for the app admin and failed silently for any other club admin.

## 196.3.261002 — "Last verified" relative wording counts calendar days

The course view said "Last verified against GolfCourseAPI Oct 1 (today)" on the morning of Oct 2: the date was the local calendar day, the word was a rolling 24-hour window, and a course verified at 22:17 the night before satisfied both. The relative label now counts calendar days from local midnight, the same clock the date uses, so it reads "Oct 1 (yesterday)", then "3 days ago", "2 weeks ago" (from 14 days), and plain days again past 60. Regression test fixes the exact case and runs in New York, UTC, Tokyo and Honolulu; the old implementation fails it.

## 196.2.261002 — Freshness sync runs from any working directory (fresh-database CI fix)

196.1's fresh-database rebuild failed in GitHub inside the harness's `freshness` mode: `ci/test_fresh_db_rebuild.sh` works from a scratch directory (`cd "$TMP"` for the Supabase CLI), and `course-freshness-sync.mjs` resolved `lib/course-diff.ts` and `npx tsc` against the current directory. From `/tmp`, `npx tsc` fetched an unrelated registry package named "tsc". The local replay had never changed directory, so it could not reproduce this.

## 196.1.261002 — The monitor verifies the course library, not a fixture file

The daily GolfCourseAPI check now reads its set from `favorite_courses` (every non-deleted course with a provider id) at the start of each run, so it follows what members save: add a course to the library and it enters the rotation; delete it and it leaves. `golfcourseapi-golden.json` is no longer the source of truth — it survives only as the harness's stub data. Each course costs ONE request (the detail lookup; the search step is gone), so the budget rises to eight courses a day: a 20-course library is re-verified every three days, a 50-course one every week, inside the 35/day shared with the app.

## 196.0.261002 — Device liveness heartbeat; scheduled course-freshness check; bet-stale notice names the money

**Migration 0166.**
- *Heartbeat.* `scoring_devices.last_seen_at`; the primary's existing 20-second check now refreshes it. A device whose holder has been silent for six hours takes the lease without a prompt and the result carries `superseded: true`; the client treats that like a takeover (starts from server scores, archives any old local outbox, never replays it). A live holder fences exactly as before; explicit takeover is unchanged. Six hours covers a phone scoring offline through a full round; yesterday's laptop never prompts today's phone.
- *Scheduled freshness.* `record_course_freshness_internal` is now the ONE body; `record_course_freshness` (member, unchanged gate) and new `record_course_freshness_system` (service_role, by provider id) both call it. The daily monitor saves each detail payload it already fetched and `ci/external/course-freshness-sync.mjs` diffs it against the stored library course with the app's own `lib/course-diff.ts` (compiled with tsc, @/ alias patched) and `lib/course-normalize.ts` — extracted byte-for-byte from `/api/courses/route.ts`, which now imports it. Changes land as `pending` with the same admin notification and the same Courses "Needs review" entry, with no extra provider requests. Workflow step runs even when the contract step failed.

## 195.1.261001 — Rebuild assertion fixed against the real chain; local full-chain replay added

195.0's fresh-database rebuild failed in GitHub at `ci/assert-notifications.sql`: `settlements.event_id` is NOT NULL since 0121 (money Buckets), and the assertion had only been executed against a fixture modelled from the 0001 baseline. Three real-schema facts were missing from that fixture: `settlements.event_id`, `favorite_courses.user_id` NOT NULL, `friction_items.signature` NOT NULL. The assertion now seeds the club's General bucket and passes event ids, user ids and signatures; the fixture was corrected to match; the file starts with its own cleanup so a crashed run cannot poison the next.

## 195.0.261001 — Notifications say what happened; course changes reviewable in Courses; member sign-up dates in Admin

**Notifications (migration 0165).** All 23 notifications were audited and rewritten to carry the specifics. Database writers: member joined now names the person (email prefix when the profile has no display name yet — the trigger fired before the name existed, hence "A new golfer"), the club, and whether they are new to BNN; added-to-game names the organizer, course, format, code and the player's tees/CH; game final gives the player's own gross and net, position by net for individual formats, "thru N" for a partial card, and points at the app for team results (the match rules are not re-implemented in SQL); bets name the winner and the amount owed or won, with the pot in the detail; charges name the payer, description and club; payments name the payer and method; tee times carry course, date, times, poster and deadline; reminders carry the in-count and who is playing; the course-change notice names the course and summarises the diff, with the per-tee list in the detail; the data-integrity notice names the first two flags (a BEFORE INSERT trigger on notifications enriches the 0092 sweep's message). Client-side messages (club request, added/removed from club, club approved/declined, handicap set, scores edited with the exact holes changed, course restored, game handicap set, removed from game) name the acting person. A `detail` column holds the second line and the Notifications screen shows it. The client's duplicate "added to game" message was removed; the trigger's is now the detailed one. The bet notification moved to a deferred constraint trigger so it sees the payers and shares written after the expense row; bet shares no longer also produce a generic charge notice. `create_notification` gains `p_detail`; the 5-argument overload is dropped (PGRST203).

## 194.0.261001 — Course API ledger made honest; silent same-device resume; "last verified" on courses

**Course API monitor (migration 0164).** Production ledger showed 17 of 18 golden courses as `error` / "claimed, awaiting result" across four runs (9/28-9/30), and the 10/01 scheduled run printed "Nothing due: all 18 fixtures were verified within the last 7 days" and went green. Cause, reproduced on a real Postgres: `claim_course_api_checks` decided freshness from `last_checked_at` alone, so a claim placeholder left by a run that died mid-flight counted as a verification for a week. The CI assertion file masked it by flipping `last_status='ok'` by hand between simulated days.

## 193.2.260930 — CI-only posting fixture correction (UNVERIFIED candidate)

The fresh-database handicap-posting fixture now calls begin_game_score_write(gid,0) before both scored-player INSERT sites. New games start at version 0; primary-device and reset guards stay enabled. The isolated PostgreSQL runner also executes migration 0161 and the actual posting fixture alongside 0162/0163. Application behavior and all migration bytes are unchanged from 193.1.

Reproduced the original BN163 failure, then passed the corrected 48-case posting matrix and reset/setup assertions locally. Complete GitHub fresh Supabase reconstruction and CI must rerun on the existing draft PR before any merge or deployment.

## 193.1 reset fencing — UNVERIFIED candidate

Per-game scoring_version and versioned player/stat/Alternate Shot RPCs fence pre-reset writes. Reset locks serialize writes and resets. Testing requirement copied into APP_RULES.md. Required automated release gates have not yet completed; do not deploy.

## Release 193.0

One primary scoring device per account across personal rounds and games (including Ryder Cup games). A second instance can view and explicitly transfer control. Staging requires migration 0162; reload both devices online after upgrading. See TEST_PLAN_193.0.md for phone/desktop and offline gates.

## 192.20.260930 — Fresh-database CI correction

Changes a CI permission probe to direct current-caller privilege verification and captures server diagnostics on rebuild failure. No new migration; 0161 unchanged. See RELEASE_VERIFICATION_192.20.md. Bundle assumes 192.19. GitHub/staging confirmation remains required.

## 192.19.260930 — Game recovery/posting candidate

Game score recovery now keeps offline corrections/deletions/stat edits pending until confirmed. Migration 0161 preserves manual game handicaps and their source/audit snapshots when posting rounds. See RELEASE_VERIFICATION_192.19.md for proof and staging checks. Changed-files bundle assumes 192.18; production remains deferred.

## 192.18.260930 — New-round payload hotfix candidate

Follow-up migration 0160 fixes UUID conversion of the unused id="" field sent for new rounds. See RELEASE_VERIFICATION_192.18.md. Supersedes 192.17; this changed-files bundle assumes 192.17 is already present.

## 192.17.260930 — Personal round persistence candidate

Round editor now uses migration 0159 for atomic saves/discards. Historical edits are local until explicit Save changes. See RELEASE_VERIFICATION_192.17.md; this candidate is not cleared for deployment.

## 192.16.260929 — Security candidate

New migration 0158 enforces profile privilege boundaries on inserts and updates. See RELEASE_VERIFICATION_192.16.md for evidence and outstanding release gates. This package is not yet cleared for production.

## 179.7.260902 staging corrective — integration VAPID wiring

The multi-session team competition is now called **Ryder Cup** throughout the interface. The Games screen explains the difference between a one-round Game and a multi-session Ryder Cup. Games launched from a Ryder Cup session begin with Group Results, money-game participation, and hole contests off; organizers can opt into them afterward. No migration is required beyond 0143.

## 179.4.260902 staging candidate — weighted Cup outcome clarity

Weighted Cup standings now use golf-style quarter fractions, identify when a team can only share rather than win outright, and state Team Singles clinch requirements in match points. Long Singles matchup names wrap on the running board. No migration is required beyond 0143.

## 179.3.260902 staging candidate — Cup schedule and clinch contract

Cups now plan every session before play: match count, points per match, halved-match split, and the overall tied-Cup rule produce a locked total-points denominator. Standings distinguish projected from secured points, show what each side needs, and declare a clinch only against that locked schedule. Migration `0143_competition_schedule_contract.sql` is required before Staging browser validation.

## 179.1.260901 — Cup staging package correction

The 179.0 staging package omitted the updated shared `lib/game-create.ts` contract. 179.1 restores that file plus its test and adds a guard so Cup session organizer opt-out cannot drift from `tournaments.tsx`. No database change.

## 179.0.260901 staging candidate — Ryder Cup-style Cups
Cup creation is atomic at the database boundary: the event and its persistent A/B roster are created together, with active-club membership and team identity validated before commit.


BNN can now organize a multi-session two-team Cup inside the Games area. A Cup keeps a persistent roster/team assignment, launches ordinary Four-Ball / Alternate Shot / Team Singles games as sessions, and aggregates their live and decided match points into one event score. Migration `0142_team_competitions.sql` is required in Staging before browser validation; this candidate is not Production-deployable until the full release gate passes.

## 178.26.260830 — Staging integration reset-count fix

- **NO migration.** Fixes the PR-only real Staging integration harness after the Alternate Shot reset test crashed after 60 successful checks.
- Root cause: Supabase `select(..., { count: "exact", head: true })` intentionally returns `data = null` and exposes `count` on the response object. The test wrapped that response in `expectNoError()`, whose contract returns only `result.data`, so `afterAltReset` became `null` before `.count` was read.
- The reset verification now keeps the full Supabase response, asserts the query itself succeeded, then reads `response.count`. Assertion count is unchanged.
- Added a permanent integration source-contract check preventing this exact response/data confusion from returning.
- Audited the rest of `ci/integration/staging.mjs`: this was the only `head:true/count` query incorrectly passed through `expectNoError`; the cleanup count query already retains the full response correctly.
- No application behavior, scoring logic, database schema, or migration file changed. Production 0140/0141 remain byte-identical to staging.

## 178.25.260830 — Production migration-parity URL hardening

- **NO migration.** CI-only release-candidate hardening after the production PR exposed a malformed PostgREST request (`PGRST125 Invalid path specified`).
- `ci/check_live_migration_parity.mjs` now accepts either a Supabase project base URL or a copied `/rest/v1` endpoint, canonicalizes it to the project origin, strips query/hash fragments, and rejects unrelated paths with a precise configuration error. This prevents accidental `/rest/v1/rest/v1/...` requests while preserving the same service-role authentication and ledger comparison.
- The migration-parity source contract now permanently requires URL canonicalization and canonical REST endpoint construction.
- No application behavior, scoring logic, database schema, or migration file changed. Production 0140/0141 remain byte-identical to staging.

# Fairway Card — Web App

A golf score tracker your friends sign into with Google. Tracks scores hole by
hole, computes course handicap and Stableford points, and shows stats (GIR,
fairways hit, putts, penalties) — with each person's rounds private to them.

You don't need to read or edit any of this code. The files below are here so
the app can be deployed. Your job is just the click-through steps your guide
walked you through (GitHub → Google sign-in setup → Vercel).

## Current game-management behavior

The organizer Game Control Center uses one central transition policy for changes after scoring starts. Safe metadata stays editable; score reinterpretations require an explicit confirmation; structural changes that would rewrite who played whom or delete played golf are blocked. Scored-player tee/handicap edits are treated as whole-round corrections and preserve gross scores.

On an 18-hole course, Manage Game → Format also lets the organizer change an unscored game among 18 holes, Front nine and Back nine without rebuilding its players or competitive setup. The choice locks visibly after scoring and becomes editable again after Reset Scores.

System Admins have a separate Games oversight directory for finding and inspecting any Game without joining its club or roster. Ordinary organizers may delete only uncompleted Games. Completed Games and Ryder Cups containing completed play require a System Admin; own-ball personal rounds remain in history, while Alternate Shot shared-ball rounds are removed with their Game.


## Create Game convergence (staging development)

Create Game is being converged onto the same five-section mental model as Manage Game: Game → Players → Format → Teams & Groups → Review. The work is staged on the staging branch so the existing production Create Game path remains stable until the full flow is complete and end-to-end validated. Stage 3 now supports draft-time tee inheritance: individual override → flight tee → game default tee, resolved into explicit player tee/rating/slope snapshots at creation.

## What each part does (for the curious — optional)

- `app/page.tsx` — top-level app entry/composition; feature screens live under `components/`
- `app/auth/callback/route.ts` — handles the moment Google sends a user back after sign-in
- `lib/golf.ts` — the golf math (handicap, Stableford, GIR/fairway/putt stats)
- `lib/courses.ts` — course normalization, identity, group-library, and custom-course helpers
- `lib/supabase.ts` — the connection to your database
- `components/ui.tsx` — shared visual pieces (the scorecard, stat tiles)

## The two settings it needs

When you deploy on Vercel, you'll paste in two values (from your Supabase
project) as "Environment Variables":

- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your Supabase Publishable key

That's it. Everything else is automatic.

## Courses

This version does NOT use GHIN (that requires per-user logins that don't work
for a shared public app). Courses come from a live search of golfcourseapi.com
(~30,000 courses); anyone can also add their own course by copying the
par/rating/slope off the physical scorecard — saved for reuse and shareable
within a group. Always confirm a course's details against the card in your cart;
members can correct a course's pars/rating/stroke index and save the fix.

## Running it on your own PC first (optional)

If you ever want to preview locally before deploying:
1. Install Node.js 20.9+
2. `npm install`
3. Copy `.env.example` to `.env.local` and fill in your two Supabase values
4. `npm run dev`, then open http://localhost:3000

## Create Game setup

Create Game uses the Lean Create flow: **Game → Players → Format → Review**. Advanced teams, matchups, foursomes and tee groups are completed in Manage Game after the core game is created. The Create Game format selector uses the same concepts as Manage Game: Match = Individual/Team, Four-ball = 2 v 2 Match/Team vs Team, and Skins = Individual/1:1 Teams/2 v 2 Best-ball.

## UI conventions
- Six-hole segment breakdown reuses the Group Results grid format (Player / Thru / segment columns / Total) for consistency.

- **Minimum font size: 11px.** Never use a `fontSize` below 11 anywhere in the app (readability floor). If space is tight, shorten the label instead of shrinking the type.
