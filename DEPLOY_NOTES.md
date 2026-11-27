## 212.134.261126 — CI fix for the 0241 assertion; the Profile's unsynced-scores notice opens the game and names the holes

GitHub's database lane failed on 212.133 at ci/assert-my-data-exports.sql:52 — "server closed the connection unexpectedly" — the Supabase stack's Postgres backend closed the connection during the assertion's anon block, which switched the session to `anon` with a bare top-level `set local role anon;`. No other assertion file does that: ci/assert-anon-boundary.sql checks anon by privilege, ci/assert-draft-private.sql switches inside a DO block via execute. The local chain (plain PostgreSQL 16) ran it fine, which is why it was not seen before hand-off.
- ci/assert-my-data-exports.sql: anon (and members' write privileges) are now checked with has_table_privilege / has_function_privilege — no role switch. Negative-tested (granting anon select fails it).
- ci/check_recurrence_guards.py gains K: a top-level `set role anon` in any ci/assert-*.sql fails the guard (negative-tested). Lesson → guard.
**Profile → the unsynced-scores notice (owner, Nov 26: "that should be clickable to take you to the game directly").** Each item is now a button: "Saturday Stableford · #481207 · Amit: 2 holes not yet synced · holes 3, 7 · Open ›" — the holes whose phone entry differs from the server's copy are named, and tapping opens the game; opening the scorecard is what sends the entries (the outbox runs there). lib/sign-out `unsyncedWork` items carry `gameId` and `holes` (lib/draft `pendingHoleNumbers` — the one rule; `rowPendingHoles` is its length); components/sign-out-row renders them on the head-to-head row's standard; ProfilePanel passes `onOpenGame` through. Tests: lib/sign-out (45), lib/sign-out-row-render (2).
**What "not yet synced" means, written down (docs/sql/inspect_unsynced_game.sql, read-only, for the owner's two staging games).** The game room keeps, per player row THIS phone scored, a backup (the phone's entries) and a watermark (the server's copy as last confirmed). A hole is pending when they differ on strokes, putts, fairway, penalties or sand. The outbox resends pending entries only while the scorecard is open on the PRIMARY scoring device and the game still accepts scores — so a never-confirmed entry stays pending for good when the game ended first (ended cards refuse writes), another device became primary, or the scoring version moved on. A confirmed entry never goes pending again (a later correction on the server is taken on the next open). The other direction matters too, and the cold review corrected the first draft of this note on it: on a still-active game, opening it from the primary phone RESENDS a pending entry, so the phone's value wins over an organizer's later correction or the staging randomiser — pending work is the phone's unfinished business, not a record of the server. "Sync now" on a phone that is no longer the scoring device now says so instead of doing nothing. And the backups belong to the PHONE, whoever the player is: a keeper scoring the group holds one per player, which is why other players' unsynced scores appear on the keeper's Profile and hold the keeper's sign-out (game 341750). The script shows the server side per player so it can be compared with the holes the notice names. Product question left with the owner: when a game is ended, pending entries that can never upload should probably be archived and cleared rather than flagged forever; and whether a pending entry should ever overwrite a server correction on an active game.

Deploy: code only (0241 before the code where not yet applied). Staging check: Profile → the amber notice → tap an item → the game opens.

## 212.133.261126 — Head-to-head records open their games; "Email me my data" under Profile

Owner (Nov 26): "we should make head to head records clickable that shows the summary of the game that created the record (lost 4&3 to x on Nov 3rd at Francis Byrne)"; "implement … download my data and put that under profile with an email to the registered address". (His correction on the way: the round detail's "Post to GHIN" panel already exists — the proposed email block was withdrawn.)

**1. Head-to-head & partners (Profile).** Every row is tappable: it opens the matches behind the record, newest first, each as "Lost 4&3 · Nov 3 · Francis Byrne" (partners' lines add "with …"), and tapping a match opens that game's recap; the Back from the game returns to Profile. lib/match-outcomes: outcomes now carry the course; `H2HRow`/`PartnerRow` carry `matches` (`RecordMatch`); `recordMatchLine()` is the one line format. The rows themselves (W/L/H, the partnership rate, the best partner) are unchanged.
- The cancelled-games question: there is no cancelled state — a game is active, ended or deleted, and the record counts only ended games with decided matches — so a surprising entry is an ended-but-abandoned game or one the daily job completed. Now the member can open it and see. A "Void this game" for organizers remains the owner's call.
- Test: lib/head-to-head-render (7, +4): hidden until tapped; the line reads as the owner asked; tapping opens that game; tapping the row again closes.

**2. Your data (Profile → YOUR DATA).** "Email me my data": the member's rounds, holes and games as three CSV files — rounds.csv (one row per round: date, course, tee, rating and slope, par, gross, to par, course handicap, net, Stableford points, differential, adjusted gross, putts, penalties, GIR, fairways, source and game code, club), holes.csv (one row per scored hole: par, stroke index, yardage, strokes, to par, strokes received, net to par, putts, fairway, penalties, greenside bunker) and games.csv (one row per club game played: code, name, date, course, format, players, status, your result, your gross, your match results) — emailed to the ADDRESS ON THE ACCOUNT, never one typed in (the request carries no address; the route reads the recipient from the session). Excel-friendly: a UTF-8 byte-order mark, CRLF, YYYY-MM-DD dates, quoting only where needed. Only the member's own data; opponents' and partners' names in match results only; nothing from Money. Test clubs' games are left out as everywhere in stats.
- **Migration 0241_my_data_exports.sql:** the ledger (user, when, to, status, counts, error) — members read their own rows; only the server writes; `my_data_export_next_allowed(user)` is the once-a-day rule (successful sends only), used by both the route and the card. Security contract: +1 policy (own rows, select), +1 grant (authenticated select) — the snapshot diff is exactly those seven lines; registered in the applied-check (0185–0241), MIGRATIONS.md and both fresh-database scripts.
- app/api/my-data/route.ts: GET reports the state for the card (address, next allowed, last send, whether mail is configured); POST verifies the signed-in caller, enforces the day, loads the member's rows with the service client (every row, paged), builds the files, sends from the round-email Gmail sender with the three attachments, records the ledger row; a mail failure is recorded as failed (and does not consume the day) and reported honestly; without the mail keys (staging) it says so with a 503 and sends nothing.
- components/your-data.tsx: the card — the address it will go to, the button (disabled with the reason when not allowed or not configured), "available again …" for the day, "Last sent … to … · N rounds, M games". The card sits above Sign out. Help gains "How do I get a copy of my data?" and "Where can I see the games behind my head-to-head record?"; AUTO_BEHAVIORS lists the export among explicit-tap actions.
- Tests: lib/my-data-export (15: CSV mechanics, both rounds' figures against the app's own functions, holes per row with received strokes and net, the game rows, no Money); ci/test-my-data-route.cjs (12, in the suite: the actual route — signed out 401, account address only, three attachments, ledger row, 429 within the day, failure recorded, 503 without keys, GET state, and the route reads no recipient from the request); ci/assert-my-data-exports.sql (own rows only; no member insert/update/delete — negative-tested with an opened policy; the day rule ignores failed attempts; anon has nothing); lib/your-data-render (6: the card's states and a tap).

**The cold review (docs/REVIEW_BRIEF.md) and what it changed.** The review read the verification logs before the author did and found the bar had NOT passed: 0241 had not registered my_data_exports.user_id in the account-merge registry (0190; the fresh chain stopped at assert-account-merge), the table was missing from ci/public_tables.json, the export read a round's stored course_handicap directly (the two handicap guards), and the Profile return path changed a literal the lifecycle guard pins. All four fixed; the bar then run to completion and every log read. It also found the route did not check account status (a pending or banned account could use the shared Gmail sender) and that failed attempts were unthrottled — the route now refuses any account that is not active/unbanned (the canonical rule), writes the ledger row BEFORE sending ('sending' holds the day, so two taps cannot both send), and a failed attempt holds 15 minutes. Worst case, written down: one email a day to the member's own address from an active account; nothing else reachable. Also from the review: one handicap rule for the whole export (rounds.csv's course handicap and net now come from chBasis like holes.csv's received strokes); games.csv consistent by format (shared-ball formats carry the team result and team, never a personal gross; match lines only for ended games); the card's dates in local time; the email no longer claims to be "everything"; an always-true test assertion fixed; the recipient test now checks the full to/cc/bcc set and that POST takes no request; partners' lines and newest-first ordering tested. Not taken: concurrency beyond the write-first ledger (good enough for one member tapping twice); the GIR/fairway attempt counts in rounds.csv (holes.csv has them per hole).

Full suite, lint, all guards, the application lane, the update and diagnostics lanes, the fresh-database chain (0001–0241 with every assertion file and the security contract) and the clean-extract preflight pass — run to completion after the review, every log read.

Deploy: apply migration 0241 on staging, then the package; on production, 0241 (after 0238–0240) before the code. Staging sends no email (no mail keys), so the card shows the button disabled with "Email isn't set up on this server (staging)"; the real send is checked on production with the owner's own account. Staging check: Profile → Head-to-head → tap a name → tap a match → the game opens → Back returns to Profile.

## 212.132.261126 — iOS 26's blurred top edge; the cold review's sign-out corrections; the review brief as a standing step

Owner (Nov 26): "the top border is blurred in the app … I have noticed this in production as well … figure out why this is happening in the first place"; keep the independent reviewer on security, integrity, display consistency, workflow, and compliance with every documented ground rule; "yes go ahead and fix all of this".

**1. The blurred top edge (installed app, iOS 26).** Not the app's CSS — nothing in BNN draws a blur. The app ran with `apple-mobile-web-app-status-bar-style: black-translucent`, which puts the page UNDER the status bar; since iOS 26 the system fills that strip and roughly 45–60pt below it with its Liquid Glass scroll-edge effect, so the top of whatever sits first (the staging frame; in production the logo card and the club chip) is smeared. It appeared in production without a code change because the phones updated. No CSS or meta switch turns the effect off.
- app/layout.tsx: `statusBarStyle: "default"`. The web view starts below the status bar; iOS paints the bar from `theme-color` (#0E3B2E, the app's green, so it looks the same); no page pixels sit under the glass. `viewport-fit=cover` stays for the home-indicator inset. When installed, `env(safe-area-inset-top)` becomes 0; the viewport rule (installed → layout viewport, lib/viewport-height.ts) is unaffected, and ci/check_shell_geometry.py gains the "iPhone 15 Pro Max, 212.132" profile (top inset 0) — passes.
- **Caveat the owner must know:** iOS reads this value once, when the icon is added to the Home Screen, and caches it. An existing install keeps the blur until the icon is deleted and re-added; the browser tab (most members) gets it on the next load. The on-device proof is the standing one: re-add the staging icon, look at the top edge, and read Admin → Diagnostics VIEWPORT DIAG (appH_var = innerHeight, navBottom = innerHeight).
- Honesty note: one PWA maintainer reported the band persisting after this change; others report it gone. On-device is the only proof.

**2. Sign-out, corrected (from the independent review of 212.130).** Four gaps between the sheet's promise and the code, each now closed and tested (lib/sign-out.test.ts 26 → 35):
- The saved-score verification's "Recovery copies" (`bnn_verified_score_recovery:*` — a member's overwritten local scores, which the app tells them stay available) were removed by sign-out. They are now kept, like the scoring archive.
- An outbox saved before the account was identified (`bnn_device_scores::<token>:…`) was listed as at risk, then removed without being archived. Any outbox whose identity is not the signed-out member's is now kept.
- If the recovery archive could not be written (a full phone — the very case of 212.130 §3) the member's outbox was removed anyway. Now the archive is written BEFORE the sign-out call (it is non-destructive), and if it fails the member is asked a second question, still on the app's own sheet: sign out anyway and the scores stay on this phone and reappear at the next online sign-in here — which they do, because the outbox AND the device-owner marker are kept (the cold review of this release found that keeping the outbox alone left it unreachable: the next sign-in minted a new token). Nothing is toasted after the sign-out, when the screen that shows toasts is gone. Profile → "Download saved scores" no longer depends on writing the archive first (it threw on exactly that phone and the tap did nothing): the file is built from the live keys plus the archive.
- A legacy, unprefixed score key (pre-outbox) is treated as the signed-in member's: listed, archived, and kept on the full-phone path.
- The paused-account screen now mounts the Toaster and ConfirmHost, so its sign-out question and errors use the app's own sheet rather than the browser's dialogs (APP_RULES popup rules; found by the review).
- The sheet listed another account's pending scores as "will not resume" although they are kept. The sheet now lists only the signed-out member's own items and says that the other account's are kept; the Profile row likewise.
- ci/check_sign_out_contract.py now holds the keep-rules and the new order (scan → ask and archive → await → clear; nothing toasted after the clear), and its "every auth.signOut() is inside the flow" rule is whitespace-insensitive over the file and also catches aliases, bracket access and any local-storage sweep outside lib/sign-out.ts (negative-tested with a two-line call). lib/sign-out.test.ts: 42.

**3. The "phone nearly full" notice actually shows.** The first failed cache save usually arrives while the page's own files are loading, before Home's Toaster exists, so 212.130's notice was dropped. components/toast `notifyInfoInApp()` holds an in-app notice until the Toaster mounts (never a native alert); test lib/held-notice.test.tsx (5).

**4. Housekeeping from the reviews.** ci/check_test_discovery.py now counts only scripts REACHABLE from `test`, `guards`, `ci:app`, `ci` or a workflow (a script nothing runs no longer counts), and covers ci/test-*.cjs|mjs and ci/check*.py as well (invoked by a reachable script, a workflow or a ci/*.sh, or named as optional with the reason — three are). That found two passing guards no script ran (authorization hardening, mobile fit — now in `npm run guards`) and one asserting an argument removed in 183.0 (ci/check_trifecta_scoring_argument.py — deleted; the three "failures" it reported were correct calls). A one-line guard holds the status-bar value. SeasonStandings: the duplicate scope-reset effect was removed (club-hub already keys the component by club). A stale file reference in lib/season-rounds fixed. 185 lib test files, none orphaned.

**5. The review brief — docs/REVIEW_BRIEF.md.** (HANDOFF.md carries the new standing rules.) The standing step: every drop is reviewed cold before hand-off — data loss, security and integrity, correctness (one rule, one implementation), display consistency against DISPLAY_RULES, workflow, compliance with APP_RULES / DISPLAY_RULES / AUTO_BEHAVIORS / SECURITY_CHECKLIST / the HANDOFF standing rules as its own severity-ranked section, and tests that do not test — reported as a ranked table with EXECUTED / SOURCE-INSPECTED / MODELLED labels; the author assesses, the owner decides scope. This release was itself reviewed cold before hand-off (see the entry's closing line).

Reviewed cold twice. The first pass found the two full-phone gaps and the paused-screen dialogs above (fixed). The second pass found that writing the archive before the sign-out meant three FAILED sign-outs (offline, "Sign out anyway" each time) pushed earlier recovery entries — another member's included — out of the 3-entry archive: a failed sign-out now puts the archive back exactly as it was (test: three failures, archive unchanged; lib/sign-out.test.ts 44). It also found the full-phone question over-promised: the kept scores come back only if no other device has scored for the member since (the server's rule, 0166); the wording now says so and points to Download saved scores otherwise. And a pre-existing crash it made reachable: on a phone still full, the device claim's own archive write threw and the claim aborted on every launch ("Could not change or restore this scoring device") — the claim now completes and leaves the old outbox in place. Two guard gaps closed (an alias of the auth object or a destructured signOut; a guard invoked only from a shell script nothing runs). Left for the owner: the saved-score Recovery copies carry no user id and are never trimmed, so on a shared phone the next member can see the previous member's copies in the review screen; and a normal sign-out still removes the device-owner marker, so signing back in on the same phone within six hours asks "Make this device primary?" — both pre-existing. Full suite, lint, all guards, the application lane, the update and diagnostics lanes, and the clean-extract preflight pass.

Deploy: code only (no migration); the drop DELETES ci/check_trifecta_scoring_argument.py (the full-tree routine handles it). On production, 0238 → 0239 → 0240 still apply once if not yet applied. Staging check: delete the staging icon from the Home Screen and re-add it; the top edge should be crisp and the status bar the app's green; VIEWPORT DIAG as above. Profile → Sign out behaves as in 212.130.

## 212.131.261126 — The remaining six review findings: unsubscribe asks first, standings errors per tab, summaries instead of holes, two member-write doors closed, the orphaned test runs

Owner (Nov 26), on the six findings left after 212.130: "yes go for it".

**1. Unsubscribe-on-GET (P2).** Opening the email's "turn off" link wrote the preference at once; mail scanners and link previews fetch links in incoming mail, so a member on a work address could be opted out of round emails without tapping anything.
- app/api/round-emails/unsubscribe/route.ts: GET shows a confirmation page with one button and changes nothing; POST — the button, or a mail client's RFC 8058 one-click (`List-Unsubscribe=One-Click` posted to the link URL) — makes the change. Both kinds (round summaries, club reports) and the forged-token refusals as before.
- app/api/round-emails/route.ts: every email (round, club report, team round) now also carries `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so Gmail's and Apple Mail's own unsubscribe buttons keep working with the POST route.
- Test: ci/test-unsubscribe-route.cjs (12; in the suite) executes the actual route — GET asks and writes nothing (negative-tested: the old route fails it), button and one-click write exactly one row, another member's token and an empty post are refused, and the sender's headers are present on all three email kinds.

**2. The sticky standings error (P2).** `SeasonStandings` kept one error for both tabs: a failed Rounds load hid the Club games already on screen, and a retry could not clear it.
- components/season-standings.tsx: an error per tab, shown only on its tab, with a **Try again** that clears it and loads again. A `loaders` prop is the test seam (held in a ref, so an inline object never re-runs the loads).
- Test: lib/season-standings-screen (18, +5): Club games load → Rounds fails → back on Club games the standings are still there → Rounds still shows its error → Try again loads (negative-tested against the old component).

**3. Standings hole-by-hole (P1 in the review, a contract fix in practice).** The owner's rule for the Rounds tab is "aggregates and ranking only, no hole-by-hole"; 0237 returned every sharing member's hole rows to any club member and the phone aggregated them.
- **Migration 0239_club_round_standings_summaries.sql:** `club_round_standings_data` returns ONE SUMMARY ROW PER COMPLETE 18-HOLE ROUND — par, gross, putts (null unless every hole has them), net birdies, net eagles, longest par-or-better run, plus the round's member, date, course and course handicap — and never holes. The stroke allocation for net birdies is `club_round_strokes_on_hole()`, lib/golf allocateStrokes written in SQL (hardest hole first by stroke index, wrapping; the handicap rounded once, JavaScript-style; a plus handicap taken from the easiest holes). Same authorisation as 0237/0238 (SECURITY DEFINER, member-only, sharing members, final rounds of the UTC year, nothing for a test club). Less data over the wire on every open.
- lib/season-rounds: `summarizeRound()` is the same arithmetic in TypeScript, kept as the oracle; `roundsStandings()` now takes summaries (the per-member averages, bests, floor and same-day collapse are unchanged). The ten engine tests run through summarizeRound.
- **One rule, two languages — guarded three ways.** ci/assert-club-round-standings.sql checks the SQL allocation against a table generated from allocateStrokes (eleven handicaps including -3, 10.5, -10.5, 19, 40) and two fixture rounds against literal figures; ci/test-rounds-summary-parity.cjs (in `npm run guards`) regenerates that table from the TypeScript and summarises the same two fixtures, failing when either side drifts (negative-tested: a changed allocation rule, and `round()` in place of JavaScript's half-up, both fail). The assertion also fails if the response carries `holes`, `strokes` or `hole_number` anywhere (negative-tested against 0238's body).
- Not changed, by the owner's standing rule for the tab: every round a sharing member logs counts, at any course.

**4 and 5. Two member-write doors (P1 and P2 in the review; both need a hand-crafted database call against the member's own data).**
- **Migration 0240_hole_parent_and_penalty_confirmation_guards.sql.** (a) `guard_posted_round_holes` checked only the NEW parent on update, so `update holes set round_id = <my personal round>` moved a hole out of a posted card, which kept its posted total — confirmed on the real schema before the fix. A member can no longer change a hole's round at all (the app never does), and the posted check runs against both parents; admin and server paths unchanged. (b) `rounds.penalties_tracked` was a plain column under the own-round policy (the posted-round guard leaves it out on purpose), so a direct write skipped `set_round_penalties_tracked`'s completeness and snapshot review and could put legacy zeros into the penalty averages. A new INVOKER trigger refuses a member's change of the flag unless the RPC has marked the transaction for that round (`set_config('bnn.penalty_confirmation', …, true)`), and refuses a member's insert with it true; the RPC body is otherwise 0236's; the server-side invalidation on score edits is untouched.
- Tests: ci/assert-posted-rounds.sql — three re-parent cases (posted→personal, personal→posted, personal→personal) refused and the posted card still has 18 holes (two were ALLOWED before 0240); ci/assert-penalty-tracking.sql — a direct `true` and a direct `false` refused, an unrelated own-round write with the flag unchanged still works, an insert already confirmed refused, every 0236 path as before (negative-tested with the trigger dropped). Security contract: unchanged (no new privileges).

**6. The orphaned test (P3).** lib/release-check.test.tsx (colour-token contrast contract, btn() roles, backdropDismiss — 22 assertions) existed but no script ran it. It now compiles with the screens suite and runs in `npm test` (it passes).
- **Guard:** ci/check_test_discovery.py (in `npm run guards`): every lib/*.test.ts(x) must be executed by some package.json script, and every test listed in tsconfig.screens.json must be run; a retired test is deleted, never left behind. Negative-tested (removing the two new test steps fails it). 184 test files, none orphaned.

Also in this release: the assertion-count baseline records the new suites (sign-out, release check, season standings screen 18).

Full suite, lint, all guards, the application lane, the fresh-database chain (0001–0240 with every assertion file, the security contract and the harness), the update and diagnostics lanes and the clean-extract preflight pass.

Deploy: apply migrations 0239 and 0240 (in that order) on staging, then the package; on production, 0238 → 0239 → 0240 before the code (0237 first if it was never applied). Staging check: Club tab → Rounds tab shows the same ranked members as before (0239 applied and summarising); open a round email's "turn off" link — a page with one button, nothing changes until it is tapped.

## 212.130.261125 — Three review findings: sign-out can no longer lose scores, the December 31 standings boundary, and a full phone no longer stops an online start

Owner (Nov 25), on the external review's findings: "i agree we need to fix the sign out and dec 31" and, once the service-worker change was explained in plain terms and checked against the code, "yes do all of them together".

**1. Sign-out (was P1: "Signing out can permanently discard unsynced scores").** Both Sign out buttons (Profile; the paused-account screen) called `clearAllLocalState()` — every `bnn_*` key, the recovery archive and other identities' score outboxes included — and only then `supabase.auth.signOut()`, un-awaited. A sign-out that failed (offline, the default global scope returns an error and keeps the session) had already deleted the phone's unsynced scores.
- **lib/sign-out.ts** — the one flow, `signOutSafely`: (1) `unsyncedWork()` scans the phone for scores that exist only there, under ANY identity and runtime token — game scores with holes past the server watermark, team score edits, a personal round with scores and no server acknowledgement, unsaved round edits — named by game, code and player; (2) if any, the app's own sheet lists them and the member must choose **Sign out anyway**; (3) the sign-out is awaited — an error leaves the phone untouched and says so; (4) only then is the member's pending work archived (`bnn_scoring_recovery_v1`, which sign-out never removes) and local state cleared, SCOPED to the signed-out identity: another identity's outbox and the archive stay. `clearAllLocalState` is retired (removed).
- **components/sign-out-row.tsx** (Profile): when unsynced work is found the row says so above the button and offers **Download saved scores** beside it. The paused-account button runs the same flow.
- Decision taken for the owner (open question from the review): sign-out with pending work is not hard-blocked — the member is told what would be left behind and chooses; a recovery copy is kept on the phone either way.
- **Guard:** ci/check_sign_out_contract.py (in `npm run guards`): no `clearAllLocalState` anywhere; every `auth.signOut()` in the app is inside the flow (the Google account switch excepted — it signs straight back in); the flow keeps its order (scan → await sign-out → archive → clear) and its exemptions; the test is wired. Negative-tested (a button put back on the old pattern fails it).
- **Test:** lib/sign-out.test.ts (26) — the three cases the review's harness showed being deleted (a pending personal round, another identity's pending game score, the recovery archive) each survive; a declined question changes nothing; a failed sign-out changes nothing and tells the member; a confirmed one archives once, then clears mine and keeps the other identity's; nothing pending → no question.

**2. December 31 (was P2: "the Rounds standings year filter drops timestamped December 31 rounds").** `rounds.played_at` is a timestamptz (0001); 0237 compared it with `<= make_date(y, 12, 31)` — midnight. The app writes the date alone and the game stamp (0045) writes a DATE, so those rows sit on midnight and were fine; a row carrying a time (older rows stamped `default now()`; the Home fallback that stamps `new Date().toISOString()` on a round with no date) fell out of its year on December 31, and the comparison depended on the session's zone. Season Wrapped and the year-end standings run on December 31.
- **Migration 0238_club_round_standings_year.sql:** the year is the UTC calendar date of `played_at` — the date the app itself reads from the value (`String(played_at).slice(0, 10)`) — in a half-open range `[Jan 1, Jan 1 next year)`, evaluated with an explicit zone so no session setting can move it. Date-only rows are unchanged; a timestamped December 31 round is now in its year. Nothing else in `club_round_standings_data` changes (SECURITY DEFINER, member-only, sharing members, final rounds, no test clubs; same grants). Registered in the applied-check (0185–0238) and MIGRATIONS.md.
- Not America/New_York, which the first plan said: `at time zone 'America/New_York'` would move every date-only round (midnight UTC) back to the previous evening, and a January 1 round out of its year. The local fresh-database chain runs in America/New_York and Supabase in UTC, which is why the fixture uses explicit UTC instants.
- **Test:** ci/assert-club-round-standings.sql — a member "Edge" with rounds at 2026-12-31 23:30 UTC, 2026-01-01 00:00 UTC, 2026-12-31 00:00 UTC (date-only), 2027-01-01 00:00 UTC and 2025-12-31 23:59:59 UTC: 2026 holds exactly the first three, 2027 only the fourth, 2025 only the fifth. Negative-tested against 0237's body in both a New York and a UTC session (each drops a different boundary round). The Club games tab is unaffected (`games.played_at` is a DATE).

**3. Service worker (was P2: "cache quota failure can stop an online app from loading").** `public/sw.js` served a script or stylesheet by fetching it and AWAITING `cache.put` before handing it to the page — the navigation path two lines above already saved its copy in the background ("cache quota cannot block a fresh page"). On a full phone the save threw `QuotaExceededError`, the response was rejected, and an online restart failed to load a chunk. Now the fresh response is handed over at once and the copy is saved in the background, its failure reported to the phone diagnostics like the navigation path's. Offline readiness is unchanged: the offline shell is `cacheShell`'s job (install and every navigation), not this line's, and old caches are already pruned (bnn-cleanup-shells).
- **Notice** (components/phone-diagnostics PhoneDiagnosticsRecorder): the first `QuotaExceededError` cache failure in a session shows, in the app only (never a native alert on a public page), "Your phone is nearly out of storage, so BNN may not open without a connection until some space is freed. Saved scores are not affected." The app cannot free a phone's space; it can only say.
- **Tests and guard:** ci/test-automatic-worker.cjs — an uncached script on a full phone still reaches the page and the failure is reported; with room, the copy is still saved (negative-tested: the old worker line throws "quota" here). ci/check_pwa_update_contract.py gains "fresh script/stylesheet survives a cache quota failure" and forbids the awaited put.

Not done, by design: the rest of the review (club standings' hole-by-hole shape, the posted-hole guard, penalty confirmation, the sticky standings error, unsubscribe-on-GET, the orphaned release test) waits for the owner's call on scope and sequencing.

Full suite, lint, all guards, the application lane, the fresh-database chain (0001–0238 with every assertion file, the security contract and the harness) pass locally.

Deploy: apply migration 0238 on staging, then the package; on production, 0238 (and 0237 if not yet applied) before the code. Staging check: Profile → Sign out with nothing pending signs out as before; score a hole offline in a game, go to Profile → the amber line names the game and the Download button appears; Sign out → the sheet lists it, Cancel keeps you signed in; Club tab → Rounds tab still shows the ranked members.

## 212.129.261117 — Rounds list: the score and points in a results column

Owner (Nov 18): "the better way would be to show the score 90 +19 on the right and then the stableford points below it, so we have more room for the round description on the left".

- components/rounds-list RoundRow is now the same two-column grid as the Games list (212.128): the description (course · tee, GAME badge, date, rating/slope, holes, GIR / FW / putts) on the left with the full width it needs; a fixed 96px results column on the right with the gross score (Georgia 20/800, the list-card headline figure) and to-par (14/700), "thru N" beneath for a partial round, and the Stableford points chip beneath that. The stats nudge runs the full width underneath.
- Content unchanged: the screens test (67 checks — every round shows its gross, readable contrast) passes as before. Gallery 13-rounds-list re-rendered; before/after attached.

Full suite, lint, all guards, the application lane, and the diagnostics and chart lanes pass (the known machine-only redirect test aside; the chart lane's intermittent tooltip wait recurred once under load and passed when rerun alone).

Deploy: code only. (0237 from 212.117 still applies once, before this code, on production.)

## 212.128.261117 — Games list: a dedicated results column, and every format's final result checked

Owner (Nov 18): "much cleaner and neater if the results are shown for complete games on the right with a dedicated margin"; "have you gone through all game formats to come up with the desired final result?" — not systematically before this release; now done (matrix below).

**Layout.** A finished game is a two-column grid: the description on the left, a fixed 96px RESULTS column on the right. The headline (place, margin, or "W-L-H" over the record) sits at the top; each match's own result sits level with its line; lines with no result of their own (your gross line, the opponents) run the full width.

**Every format, its final result:**
- Stableford / stroke play (gross or net): your place among finishers ("T2nd of 8"); a no-show says so; an incomplete card says why there's no place.
- Match play, singles: "Won 3&2" / "Lost 2 up" / "Halved", v the opponent. Team match play (two teams): plus "Team · Reds  Won 3½–1½".
- Best ball (best-ball or Shootout): your match with margin, v the opponents · with your partner; with two teams, the team score too.
- Trifecta: "W-L-H" over the record, one line per match (Singles / Four-ball v …, its result in the column), and the team score.
- Skins: your skins (holes won, never money); team skins (1-v-1 and 2-v-2): the team's total, your share in the column.
- Scramble and alternate shot (shared ball): the team result and your team — never a personal score (shared-ball rule).
- Open games: no result; draft badge as before. Every game shows its code.
- New in lib/game-list-summary: teamResultLine (the same team standings the game screen shows — lib/game-results singlesTeamStandings, foursomeTeamStandings, trifectaResults); no-show handling. Not shown by choice: segment (sixes/nines) winners and side contests — available if wanted.

Tests: lib/game-list-summary (28 — adds the two-team score for best ball and trifecta, and the no-show). Gallery 81 re-rendered. Full suite, lint, all guards, the application lane, and the chart and diagnostics lanes pass (the known machine-only redirect test aside).

Deploy: code only. (0237 from 212.117 still applies once, before this code, on production.)

## 212.127.261117 — Games list cleanup: no repeats, match margins, a readable trifecta record, a code and result on every game

Owner (Nov 18), on 212.126: titles that already say the format, course and date shouldn't repeat them; trifecta "W-L-H and the result underneath … what did I win and what did I lose?"; "a final game with no game code or result — why not?"; "Won 3&2 or Lost 2up instead of Won / Lost".

- **No repeats.** The meta line adds the format, course and date only when the title doesn't already say them (titleMentions): format synonyms (best ball / four-ball, stroke play / medal, alternate shot …), course names with or without "Golf Course / Country Club / GC / CC", dates as "Nov 15", "November 15", "11/15" or "11-15". An auto-named game ("Stableford / Course / Date") shows just the player count; a custom name ("Saturday Game") gets all three.
- **Match margins.** Every match outcome carries its margin from the scoring functions (lib/match-outcomes: matchStatus / fourballStatus / altShotStatus / computeTrifecta "result", compacted: "3&2", "2 up"). One match reads "Won 3&2", "Lost 2 up" or "Halved", with a line naming the opponents (and your partner in best ball).
- **Trifecta.** "W-L-H" captioned over the record ("2-0-0"), and one line per match: "Singles: Won 2&1 v Amit Sud", "Four-ball: Won 2&1 v Amit Sud & Vikram Rao · with Nihar Shah".
- **Every finished game has its code and a result.** 212.126 hid the code on finished games (my choice) and showed no result for formats without a single place — skins and undecided matches — which is the game the owner saw. The code is back on every row; skins show your skins (a count of holes won, never money; team skins as the team's total with yours beneath); an incomplete card says "Your card wasn't completed, so there's no place"; an undecided match says "No match was decided".

Tests: lib/game-list-summary (23 — redundancy for auto, custom and partial names; course suffixes and format synonyms; places; best ball and match play margins with opponents and partner; trifecta caption, record and one line per match; skins; incomplete card; open game; scramble; your line last; margin compaction; no money). Gallery 81 re-rendered with an auto-named Stableford, a custom-named trifecta, match play, skins and an open game. Full suite, lint, all guards, the application lane, and the chart and diagnostics lanes pass (the known machine-only redirect test aside).

Deploy: code only. (0237 from 212.117 still applies once, before this code, on production.)

## 212.126.261117 — Games list: a richer row for every game

Owner (Nov 18): "under Games — right now we just list the game name and the club played — we should add some more description like how many players, once the game is FINAL, the person score and stableford points, differential, perhaps some summary stats".

- **Every game:** format · number of players · course, and the date once FINAL (an open game keeps its join code).
- **Once FINAL, on the right:** your result — your place among the finishers in Stableford and stroke play ("2nd of 8", "T2nd of 8" for a tie), your match outcome in best ball and singles match play (Won / Lost / Halved), your record across a trifecta's matches (W-L-H 1-1-0). Skins show no single place.
- **Once FINAL, beneath:** your own line from your posted round for that game — gross (to par) · Stableford points · differential · net birdies — the Rounds tab's figures (lib/golf strokesOf, diffOf, stablefordDisplay, roundDifferential; net birdies off the round's stroke allocation).
- Rules honoured: no money anywhere in the row; scramble and alternate shot show the team result and your team, never a personal score or differential; the list only shows games you play in. List-card idiom (title 15/700, one headline result 14/700, meta 12 sage, 13px 16px padding — one off-scale padding retired).
- **Built on what exists:** lib/game-list-summary (pure; places from the player-scoring ranking, outcomes from lib/match-outcomes, team results from lib/team-rounds); components/game/game-list loads players, your posted rounds and their holes once after the games arrive, and a failure there leaves the plain row. GameRow is its own component (rendered by the design gallery: 81-games-list-before / -after, sample games).
- Guards: the recorded-round course-handicap read is registered (as for the Rounds standings); the rounds read is declared bounded (your own round, at most one per game shown).

Tests: lib/game-list-summary (13 — meta line, places and ties, best-ball outcome, trifecta record, skins none, open game, scramble team result only, your line's gross / points / differential / net birdies, no money). Full suite, lint, all guards, the application lane, and the chart and diagnostics lanes pass (the known machine-only redirect test aside).

Deploy: code only. (0237 from 212.117 still applies once, before this code, on production.)

## 212.125.261117 — CI fix: the confirm-sheet fallback calls the global dialog functions

GitHub's application lane failed on 212.124 in ci/test-personal-round-editor.cjs: "Not implemented: window.confirm", then the save didn't happen.
**Cause.** When no sheet host is mounted, askConfirm / askText (and the toast) fall back to the native dialog. 212.122/124 wrote that as window.confirm / window.prompt / window.alert. The round-editor test runs in jsdom, which does not implement window.confirm, and supplies its answer through the global confirm — which the old code (a bare confirm()) used. In a real browser the two are the same function, so members were not affected; the fallback now calls the global (globalThis.confirm / prompt / alert), identical in the browser.
**Also fixed:** ci/check_match_length_management_182_0.py quoted the un-awaited setup guard; updated to the awaited form (the gate is unchanged).
**Why it slipped:** the release checks run locally were the suite, the guards and the chart/diagnostics lanes — not the application lane (npm run ci:app). Every lane in .github/workflows/ci.yml is now part of the pre-release run (database aside, which needs Postgres and runs only on GitHub). ci:app passes in full here except the known environment-only redirect test.

Deploy: code only.

## 212.124.261117 — Presentation D1 + D2: no native pop-ups left anywhere in the app

Owner (Nov 17): "do both D1 and D2 show me before and after".

**Built.** askText (components/confirm) — the app's own replacement for prompt(): a sheet with the question, the detail, a text field and Cancel / the action; resolves the text, or null on Cancel, exactly as prompt() did. questionFrom turns a plain-sentence question into title + detail (the first sentence is the title; a blank line or further sentences become the detail, paragraph breaks kept) and names the button after a leading destructive verb (Reset, Remove, Suspend, Delete …, in red); askConfirm and askText use it for every string question.
**Migrated (129 sites, 20 files).** D1 — Manage Game and setup (components/tournaments: 16 questions, 41 errors), scorecard take-over, round editor and round setup, scoring device, side contests, tee times, round detail, course history, groups, competitions, feedback, the course picker, scramble settings. D2 — admin (components/manage 31, admin-players 10, pending sign-ups, club requests, account gate, admin courses). Questions → askConfirm, typed inputs → askText, errors → notifyError, notices → notifyInfo.
**Safety.** Every function that became async was audited against 212.123: the two whose results are used — the Manage Game setup guard allowSetupChange and confirmPastDate (round editor, round setup) — now return Promise<boolean> and all 32 of their call sites await them (the compiler does not flag an un-awaited `if (!guard())`, so each was checked). Contract and sandbox tests updated to the awaited forms: check_game_setup_policy_contract (31 links), check_setup_rules_server_parity (14 rules), test-game-reset, test-game-tee-options (161 assertions), scramble screens (51).
**Guard.** ci/check_native_dialogs.py reached zero and now BANS confirm()/alert()/prompt() in the app (the two host fallbacks excepted).
**Tests:** lib/confirm-sheet (11: question sheet, sentence splitting, destructive-verb button, typed input returns text / null, initial value). Gallery 79 (Manage Game reset) and 80 (admin suspend with a typed reason); before/after rendered. Full suite, lint, all guards and the browser lanes pass.

Deploy: code only.

## 212.123.261117 — Presentation B and C: one square control for choosing a view, the Personal bests and Money fixes, and the type, spacing and list scales

Owner (Nov 17): "i think i like square buttons better than rounded pills"; "keep going on B … do this and C together".

**B.**
- **Segmented** (components/ui) — the one control for choosing a view or a sort: square buttons (radius 6, 12px, 8px 12px), the chosen one gold with green 700 text, the rest sage on greenLight — or on greenMid when the control sits on a card (onCard), so unchosen buttons still read as buttons. Used for the dashboard range (Last 5 / Last 20 / Season / All — the model the owner liked), the Season standings sort (was rounded pills) and the admin friction tabs (was rounded pills). Semantics: a tablist of tabs; the analytics and chart browser tests now select them by role tab.
- **Personal bests card (Home):** its rows were a table with Georgia figures — the standings mismatch. Rows now follow Data rows: labels 13/700 cream in a 156px column (no wrapping), figures sans 14/700; the hero "78" stays Georgia (a display numeral).
- **Money headings:** five section titles in Georgia 17/800 (Guests, Aggregate Club-level Balances, Untangle payments, Settle up, Activity log) are now the Eyebrow every other section uses. The gold money totals stay Georgia (money is a game surface).

**C.**
- **Type scale** (DISPLAY_RULES Part 5, ci/check-design-scale.py): seven text steps 11 · 12 · 13 · 14 · 15 · 20 · 22, display numerals 24 and up. They already carried 92% of text; the in-between sizes (16, 17, 18, 19, 21) are frozen per file and retire as screens are touched. Nothing resized.
- **Spacing scale:** eight paddings drawn from use — 4px 10px · 6px 12px · 8px 12px · 8px 0 · 12px 14px · 13px 16px · 11px 20px · 16px. The rest frozen per file; moved only when their screen is re-rendered, never in a bulk sweep.
- Design-scale baseline now: 0 radius, 558 padding and 139 font-size uses off-scale, none new allowed.
- **List idiom guard** (ci/check_list_idiom.py, in npm run guards): avatars only 22 (inline chip), 28 (data row), 32 (list card), 48/64 (profile hero), and no serif person names inside lists; 29 legacy sites frozen per file.

Before/after rendered (Personal bests card, dashboard range, standings sort). Full suite, lint, all guards and both browser lanes pass.

Deploy: code only.

## 212.122.261117 — Presentation A: the app's own confirm sheet replaces the browser's pop-ups (member-facing screens)

Owner (Nov 17): "how the app looks and presents is super high on the priority list" — start with A.

**Why.** 171 native confirm()/alert()/prompt() calls. On a phone each is a grey system box headed with the web address ("birdienumnum.vercel.app says…") on every Delete, Remove, Discard and error — off-brand, and it reads like a fault.
**Built.** components/confirm.tsx — askConfirm({ title, message, confirmLabel, danger }) returns Promise<boolean>, rendered by one ConfirmHost (mounted beside the Toaster in Home) as the standard BottomSheet: the question as the title, the detail beneath, Cancel and a confirm button (red text for destructive ones). A new question cancels an unanswered one. If no host is mounted it falls back to the native dialog, and the toast now does the same, so nothing is ever silently skipped.
**Migrated (member-facing):** components/game/scoring-views (matchups start-over, the setup-policy confirmations — now awaited — remove foursome, errors), components/money (close event, unmark payment, every error and notice), components/home (delete a game round, discard unfinished rounds, delete an unfinished round, every error and notice). Errors to notifyError, notices to notifyInfo. 42 sites; 129 remain (tournaments, admin and other screens — release D).
**Guard.** ci/check_native_dialogs.py (in npm run guards): the 129 legacy sites frozen per file in ci/native_dialogs_baseline.json; counts may only go down, a file at zero can never gain one. ci/check_game_setup_policy_contract.py updated to the awaited gates (still gated); ci/test-round-recovery.cjs sandbox given notifyError/askConfirm (58 assertions pass).
**Tests:** lib/confirm-sheet (5: shows title and message, yes closes, no closes, a new question cancels an unanswered one). Gallery 78-confirm-sheet; before/after rendered. Full suite, lint and all guards pass.
Owner preference recorded for release B: square buttons over rounded pills (the shared segmented control will be square, and the standings sort pills will follow).

Deploy: code only.

## 212.121.261117 — Lists across the app: two idioms, written down and applied

Owner (Nov 17): "do it now, consistency is important and ultimately what users see — show me what you find, before and after mockups."

**Found.** Lists come in two shapes, and the inconsistencies sat within each: (1) ROWS INSIDE A CARD — admin analytics users (34px avatars, 14/500 names), the Cup roster pick rows (30px, 14/800); (2) LIST CARDS, one card per item — the Players admin (40px avatar, body-size name, 12px 16px padding), club-members admin (48px avatar), competition names 15/800, tournament names body-size/800, the Rounds list's to-par at body size beside a 20px score, team-round results 14/800. The Rounds list, team rounds and Your courses otherwise already followed the card idiom.
**Rule (DISPLAY_RULES "List cards — one card per item", beside "Data rows"):** title 15/700 cream, meta 12 sage, padding 13px 16px, 32px avatar for a person, at most one headline figure on the right (a score Georgia 20/800; a result phrase or to-par sans 14/700). Rows inside a card follow Data rows (13/700, 11 sage, figures 14/700, 28px avatars). Pick-control rows use Data rows.
**Applied:** components/manage (analytics users → data rows; Players admin and club-members admin → list cards, 32px avatars, 13px 16px padding), components/competitions (Cup roster names 13/700, 28px avatars; competition titles 15/700), components/tournaments (tournament titles 15/700), components/rounds-list (to-par 14/700; team results 14/700). The design gallery gains 13-rounds-list. Before/after rendered for the Rounds list, team rounds, Cup roster and Your courses (unchanged). One off-scale padding retired (the design-scale baseline lowered). Full suite and all guards pass.

Deploy: code only.

## 212.120.261117 — One standard for data rows: the Club tab's tables brought into line

Owner (Nov 17): "this is basic display stuff … there needs to be consistency. Look at the font for the members table below as well. Audit it now and fix it."

**Audit.** The app had no written standard for data rows; each table was built to its author's taste. On the Club tab: the stats rows 12px; the standings (212.119) 12px with 22px avatars; head-to-head cells 13px regular; the members list body-size names at 800 with 40px avatars and 12px meta. Avatar sizes across the app's lists run 20–48px.
**Standard (DISPLAY_RULES "Data rows — one standard"):** outside a live game surface, every list or table of members, players or figures uses: names/labels 13px/700 cream (800 for the viewer's own row), captions and counts 11px sage, figures sans 14px/700, avatars 28px, an Eyebrow heading, 1px separators with 8px padding, pills at 4px 10px. Georgia numerals stay on game surfaces and hero tiles. (Weights are 500/700/800 only — a guard enforces it, and caught a 600 on the way.)
**Applied to:** components/season-standings (names 13/700, avatars 28), components/club-engagement (format rows and scoring labels 13/700, counts 11), components/groups MEMBERS list (names 13/700, avatars 28, meta 11), components/head-to-head (names 13/700, figures 14/700). Admin tables (components/manage) and the game surfaces are untouched. Tests: standings (13), groups (10) pass; the full suite, the design-scale, weight and contrast guards pass.

Deploy: code only.

## 212.119.261117 — Season standings on the Club tab's idiom (the font and size mismatch)

Owner (Nov 17, two staging screenshots): the standings card next to the club stats table — "completely lost the consistency".

**Why.** The display rule "Georgia for numerals" is the GAME surfaces' idiom (leaderboards, recap, money, share card). The Club tab and the stats cards (components/club-engagement) use a compact idiom: Eyebrow headings, 12px rows, sans 14px/700 numerals with 11px captions, 22px avatars. The standings card was built in the first idiom beside a card in the second, so it read a size larger and in another face. The heading itself was already the shared Eyebrow.
**Fix.** The card restyled to the Club tab's measurements: tabs and pills 11–12px on-scale paddings, rows 12px (cream 500, bold for the viewer), counts 11px sage, figures sans 14px/700 (sage when unranked), avatars 22px, the note 11px. DISPLAY_RULES gains "Which idiom, where": a new card takes its neighbour's idiom; Georgia numerals stay on game surfaces and hero tiles. Tests unchanged (13 screen checks pass); gallery 60/62 re-rendered; the design-scale and contrast guards pass.

Deploy: code only (0237 from 212.117 still applies once).

## 212.118.261117 — CI fix: the 0237 assertion test's fixture

GitHub's database lane failed on 212.117 in ci/assert-club-round-standings.sql: the test inserted club memberships without group_members.email, which is NOT NULL. The migration (0237) applied cleanly and the function ran; only the test fixture was wrong. Fixed to insert the email, as ci/assert-club-isolation.sql does. No app change; migration 0237 is unchanged (apply it once, as for 212.117).

## 212.117.261117 — Season standings: the Rounds tab, the Profile switch, and the refinements from the real data

Owner (Nov 17–18): "2 tabs — one for games and one for individual rounds"; aggregates and ranking only, no hole-by-hole; the switch in Profile, on by default; top 5 with the rest behind Show all; unranked figures shown; top-3s only with five or more finishers.

- **Migration 0237_club_round_standings.sql:** profiles.share_rounds_with_club (default true) and club_round_standings_data(group, year) — SECURITY DEFINER, since holes are otherwise readable only by their owner: returns sharing members' FINAL rounds of the year with their holes, only to a member of that club, nothing for a test club, 42501 to an outsider. Registered in the security contract, the applied-check (0185–0237), the migration ledger and MIGRATIONS.md. Test: ci/assert-club-round-standings.sql (the sharer's round is returned with its hole; a non-sharer's is not; last year's and an in-progress round are not; an outsider is refused; flipping the switch makes a round appear) — in both fresh-database runs.
- **Rounds engine (lib/season-rounds):** from the club's real 2026 export — 18-hole rounds only; a member's rounds on the same course and day collapse to one (three such duplicates in the data); putts rank only members whose counted rounds all have 18 putts; five rounds to be ranked; ties share the place. Scoring averages to par (gross, and net off the round's recorded course handicap); net birdies and eagles off the round's stroke allocation (lib/golf allocateStrokes, as the Rounds tab); best gross / net; most birdies in a round; longest run at gross par or better; rounds logged. The reads guards record the recorded-round exemption (ci/check_course_handicap_reads.py ROUND_FILES, ci/check_handicap_single_source.py). Test: lib/season-rounds (10).
- **The card (components/season-standings):** tabs Club games / Rounds (the Rounds data loads on first open, one RPC); TOP 5 for the chosen metric with the viewer's row if outside, "Show all N (M with fewer than 5 games/rounds)" opens the rest; an unranked member's figure shows in sage with no place; a tapped row shows every number; the Rounds note says who it covers and where the switch is. Games engine: a top-3 counts only with five or more finishers. Tests: lib/season-standings-screen (13).
- **Profile → "Include my rounds in the club standings"** (components/player-card ShareRoundsToggle, beside the card-visibility control; standard btn() so the contrast guard passes): club games always count; this covers rounds the member logs — results, not scorecards.
Real-data note (from the export): the Rounds tab will rank eight members this year (Amit 31 rounds, Karan 13, Ashutosh 11, Probir 9, Jigar 8, Gaurav 6, Nihar 6, A Masud 5); most members' logged rounds are their club games — which is why the count is on every row.

Deploy: apply migration 0237, then the package. Staging check: Club tab → Rounds tab shows the eight ranked members with those counts; Profile → the switch off → your rounds leave the tab; back on → they return.

## 212.116.261117 — Season standings: the club's order of merit, one table sortable nine ways

Owner (Nov 17): a season leaderboard, variant A after mock-ups ("there are so many ways to slice the club data"); only data that exists in the app ("this app might not be the primary app used by all club members") — nothing index- or personal-round-based.

- **Engine (lib/season-standings):** ENDED club games in the four own-ball formats — Stableford, stroke play, best ball (four-ball) and trifecta; skins, scramble, alternate shot and the Cup excluded; members only; test clubs never reach it. Per player: games; **wins** (an individual first place OR a won best-ball / trifecta match — aggregated, the owner's rule); top-3s; match record W–L–H; **average Stableford points computed from the hole scores for every own-ball game** (one yardstick across formats); best gross and best net; net birdies and eagles; segments won; side contests won; standout features. **Five games to be ranked; ties share the place** (1, 1, 3); below the floor a player is listed, unranked, with no average. Every figure comes from the helpers the game screens use (positions, points, match outcomes, segments, standouts, the course-handicap accessor — the reads guard caught a direct read during the build).
- **The card (components/season-standings) on the Club tab** above the latest report: pills to sort by wins, average points, best gross, net birdies, match record, top-3s, games, segments won, contests won; the viewer's row highlighted; a tapped row shows every number. Loads the club's year with paged reads and one batched contests query.
- **The quarterly report** carries a standings snapshot for its period from the same engine (top five by wins), with a line in the email pointing to the full table — one source for the numbers the two share. Its own awards are unchanged.
Tests: lib/season-standings (15: which games count, wins aggregated, three matches a head across best ball + trifecta, gross from hole scores, contests credited, segments, standouts, birdies, ties 1,1,3, the floor, low-first sorting); lib/season-standings-screen (7: default sort, the viewer's row, re-sorting by pill, the detail on tap, ranked vs unranked). The design gallery renders the real card (60); the overflow guard passes.

Deploy: code only. No migration.

## 212.115.261116 — @supabase/ssr 0.5.2 → 0.12.7 (the auth-cookie library), on its own

Owner (Nov 17): "make sure the current version of supabase and vercel (both free versions) support the upgrade and then proceed". Confirmed from the package: 0.12.7 needs only supabase-js ≥ 2.114 (we run 2.119) and cookie 1.x (Node ≥ 18; we run 22). Vercel's free plan runs Node 22; Supabase's free plan is the hosted auth service every version of the library talks to over the same API. Nothing blocks it.

**What the library does:** stores the signed-in session in browser cookies and reads it back; BNN uses it in three places — the browser client (the app), a read-only server client in API routes (reads the session, never writes cookies), and the sign-in callback route. **What changed between 0.5 and 0.12** (its release notes): cookie-chunk encoding reworked in 0.6 and later reverted after breaking loosely wired server-side integrations; a cookies.encode option (0.8); a token-refresh race fixed (0.8.1); the 0.12 line is cookie-handling bug fixes (deduplicated server writes, domain-scoped deletion, PKCE verifier flushing). BNN's server side only writes cookies at sign-in, so its exposure to the 0.6-era breakage is small — but verified, not assumed (below).
**One code change:** lib/supabase.ts typed the client as ReturnType<typeof createBrowserClient>, which with 0.12 collapses to `any` (8 implicit-any errors in the pages that subscribe to auth state); the client is now typed directly as SupabaseClient. No behaviour change.
**Verified on the new version:** types, lint, the suite (447,399 checks, 115 suites), the guards (security posture included), the chart / analytics / diagnostics lanes, the build.

**Deploy: on its own, after 212.114 is in production** (so a sign-in problem, if any, points at one change). **Staging pass, sign-in focused:** sign in on 212.114 → deploy 212.115 → reopen WITHOUT signing in: the session must carry over; then sign out and in again; fully close and reopen the installed app and confirm you stay signed in; open the line-up and live links signed out; send a push to yourself. Worst case for a member if a stored session can't be read: one sign-in prompt; nothing else is affected.

## 212.114.261116 — The skipped-hole check for personal rounds; the standouts heading names its basis; the safe dependency batch

Owner (Nov 17): "do the code items and dependency batch in this next release".

- **Skipped-hole check for PERSONAL rounds** (owner: "why wouldn't it fire for an individual round as well?"): the Rounds editor uses the shared entry card (ScoreEntryCard), which now runs the same rule as the group card (lib/hole-skip; here "the group" is just the card's holes). Tapping a still-unscored hole that isn't the next expected one asks "Hole 3? — Hole 2 hasn't been scored yet", with "Score hole 2" / "Score hole 3"; the editor's own Next never skips, so only a tap is checked. Tests: lib/hole-skip (14): the ask, the switch, the continue.
- **Standouts heading names its basis** (owner, Nov 15, option 1): "STANDOUT ROUNDS · best against the field (8+ scored), on a course that played N shots hard" with eight or more scored; "· best against their own handicap (fewer than 8 scored, so not against the field)" below — card, share image and email. The 8-player switch stays, as decided. Tests in lib/recap-additions (25).
- **Dependency batch (same-major updates, proven by CI):** Next 16.3.8 → 16.4.6, React / React DOM 19.2.8 → 19.3.1, supabase-js 2.108.1 → 2.119.0, Playwright 1.62.1 → 1.65.1, eslint-config-next 16.3.0 → 16.4.6, @types/react and @types/react-dom to 19.3.0, the testing-library packages. package.json minimums lifted to match; the lock file pins them. Everything ran on the new versions: types, lint, the suite (447,399 checks, 115 suites), the guards, the chart / analytics / diagnostics browser lanes, the build.
Not taken (each its own decision and staged release): @supabase/ssr 0.5 → 0.12 (auth cookies), Node 22 → 24, TypeScript 5 → 7, ESLint 9 → 10, jsdom 25 → 31, web-push 3 → 4.

Deploy: code only. No migration. GitHub's CI runs `npm ci`, so it installs exactly the lock file's versions.

## 212.113.261116 — Housekeeping: the root cleared of records and stale copies; history archived and kept out of the package

Owner (Nov 17): "it feels like this app is carrying a lot of bloat which we should clean up from time to time"; chose archive-and-exclude over deleting.

- **54 per-release records** (RELEASE_VERIFICATION_*, RELEASE_CONTENTS_*, PRODUCTION_HANDOFF_*, the manifests, the release-verification/ folder) moved from the root to docs/history/releases/. Nothing in ci/, scripts/ or the workflows reads them.
- **DEPLOY_NOTES.md keeps 212.x** (199 KB); the 815 KB of entries before 212.0 are archived to docs/history/DEPLOY_NOTES_through_211.md with a pointer at the foot of the live file. The version ledger and verify_release read only the newest entries.
- **Four stale duplicates deleted from the root** — test_fresh_db_local.sh and test_fresh_db_rebuild.sh (the real ones are in ci/), sw.js and app-version.json (the real ones are in public/). All four differed from the real files and nothing referenced them.
- **ci/check_scoring_integrity_181_12.py retired**: the one incident check nothing runs (the other two incident-named checks, 181_13 and 182_0, are live guards in package.json and stay).
- **docs/history/ never ships:** excluded from the deploy (.vercelignore) and from the hand-off package. The rules are in APP_RULES.md ("Housekeeping").
Result: root files 119 → 61. No code change; every guard and test unchanged.

Deploy: code only (no runtime change). No migration.

## 212.112.261116 — The CI failure on 212.111: version-date drift between package.json and the stamped build

GitHub's "application" lane failed on 212.111 in ci/test-phone-diagnostics-browser.cjs: the worker answered 212.111.261115, the test expected 212.111.261116.

**Cause.** The version's date segment is AUTO-STAMPED at build time to the US/Eastern date (scripts/write-version.mjs); that is the version the app and the service worker carry. package.json's date is hand-typed. 212.111's date was typed as 261116 at 03:37 UTC on Nov 16 — still Nov 15 in New Jersey — so the build stamped 261115. The test compared the worker (stamped) with package.json (typed) and failed.
**The fragility it exposed.** Two browser tests used package.json's version as "current": the phone-diagnostics check, and the update-redirect test, which also uses it to rewrite sw.js when it simulates an upgrade. Any build on a different Eastern day from the typed date fails the first and breaks the second's simulation. That is also why the update-redirect test failed on the development machine on the untouched 212.108 last week (typed 261114, built on Eastern Nov 15) — wrongly put down to the Chromium build at the time.
**Fix.** The phone-diagnostics test now compares the worker with the STAMPED version (lib/app-version.ts, which the writer produces); the update-redirect test is unchanged — its scenarios pass on GitHub (the 212.111 run shows them PASS) and it serves its own fixture versions. Rule: package.json's date is the Eastern date of the day the version is cut; the build stamps the real date; tests compare against the stamped one.

Deploy: code only (a test). No migration.

## 212.111.261116 — Group card columns in the foursome's order (the trifecta swap); a skipped hole asks before scoring

Owner (Nov 16): "while scoring the trifecta game today the order of players in the scorecard swapped the position between Probir and me in the group card"; "put in a check / warning to prevent a score being entered when a hole is being skipped".

- **Column order (components/game/scorecard-views):** for four-ball and trifecta the card put pair A then pair B, but within a pair it kept whatever order the player rows arrived in — and the rows are reloaded as scores sync, with no ordering asked of the database, so two players on the same pair could swap columns mid-round. Each side now follows the FOURSOME's stored order (set by the organizer, fixed for the round). Every format without its own rule (stroke play, skins) is now alphabetical instead of row order, for the same reason. Test: lib/card-column-order (3): trifecta and four-ball columns identical whatever order the rows arrive in; stroke play alphabetical. Negative-tested.
- **A skipped hole asks first (lib/hole-skip, the card):** the expected next hole is the one after the group's last scored hole, wrapping 18 → 1 (a shotgun start on 10 works). Opening a still-unscored hole that isn't the expected one, while the expected hole has no score from anyone in the group, shows "Hole 3? — Hole 2 hasn't been scored yet. You're probably on hole 2." with "Score hole 2" (opens hole 2 instead) and "Score hole 3" (continues; not asked again for that hole). No warning when nothing is scored yet, when the opened hole is already scored (an edit), or when anyone in the group has scored the expected hole. Test: lib/hole-skip (11): the rule including shotgun and wrapped runs, and the screen (tap hole 3 after hole 1 → the ask; "Score hole 2" opens hole 2). Negative-tested.

Deploy: code only. No migration.

## 212.110.261114 — The Summary filter (dropdowns in the app's field style, Reset / Apply / X); the line-up title's doubled date; a description for the live link

Owner (Nov 14): "look at the filter in the main screen and how it chooses the courses and tees — make it conform to the display rules at BNN. there should be a clear way to reset the filters and dismiss the popup"; "fixing the line up description which includes the date twice"; the live link description.

- **Summary filter (components/analytics-filters):** dropdowns kept (owner: a list of every course "doesn't make sense" past a few), in the app's own field style — inputStyle and the uppercase FieldLabel every other select uses — each course option with its round count ("Oak Hollow · 3 rounds"), the tee dropdown only once a course is chosen (a note when no tee names were recorded). The footer changed: "Clear filters" only cleared the draft (two taps to clear, and it looked like nothing happened); now **Reset** applies no filter at once and closes, **Apply** commits and is live only when something changed, the **X** dismisses without applying. Tests: lib/summary-filter (9); the analytics browser scenario (85 assertions) updated to the new footer with every behaviour check kept; the gallery renders both states (75, 76).
- **Line-up title:** an automatic game name already ends with the date ("Stableford / Oak Hollow / Nov 14, 2026"), and the title appended "Sat, Nov 14, 2026" after it. The title adds the date only when the name carries none (nameCarriesDate, matched by shape so differently set-up phones work). A typed name without a date still gets it.
- **Live scores link:** it had no server-side metadata, so chat previews showed nothing useful. app/live/[token]/layout.tsx now gives it a title and description in the line-up's shape: "Live scores · <game> · <date unless the name has it>" / "<course> · N players · <format> — the scorecard and leaderboard as they happen." (after the end: "<game> · final"). Tests in lib/lineup-meta.
- ci/check_gallery_overflow.mjs honours PLAYWRIGHT_CHROMIUM like the gallery script (the development machine's Chromium layout changed; the GitHub install is unaffected).

212.109 was the first cut of the same work with the courses as a list of option rows, superseded the same day (a list doesn't scale past a few courses); 212.110 is the dropdown form. Nothing from 212.109 shipped.

Deploy: code only. No migration.

## 212.108.261114 — approved Summary filters and analytics follow-ups

Use the owner-approved three descending horizontal lines beside the time-range controls; green without a course/tee filter and yellow after Apply. Popup criteria are course and dependent tee only. Remove the round-length selector while keeping raw nine-/eighteen-hole comparisons separate. Partner table and highlighted record now rank by qualified points rate, not accumulated points. Fairway/GIR peer verdicts require five rounds plus fifty recorded opportunities. Penalty averages/trends/coaching use explicitly confirmed complete cards; legacy/default zeros remain unknown. Round-detail confirmation is acknowledged, reversible and invalidated by later score/penalty edits.

Migration 0236 required. All earlier SQL migrations remain byte-identical. Includes all 212.102–107 work relative to the reported production 212.101 baseline; verify actual applied migration IDs before any production SQL. See ANALYTICS_212.108.md and RELEASE_VERIFICATION_212.108.md. Native staging/production gates remain required; no production approval or merge has occurred.

## 212.107.261114 — analytics quality and repeat use

212.106 GitHub CI is green per the owner. This candidate implements the approved analytics cleanup in the existing screens: missing-handicap net awards, complete putting samples, established-index trends, separate raw 9/18-hole comparisons, course/tee/length scope, prior-period Insights, tied personal bests, per-stat evidence and bounded peer proxies, scope-aware AI, consistent admin populations, mature activation/retention cohorts, cleanup-stable game lifecycle counts, observed feature/repeat/reminder outcomes and visible error/retry/freshness states. See ANALYTICS_212.107.md for definitions and preserved contracts.

Migration 0235 required; all earlier migration SQL remains unchanged. Full local release evidence is recorded in RELEASE_VERIFICATION_212.107.md. Native GitHub/Supabase CI, Vercel staging and the existing production data-profile review remain external release gates. This is not production approval.

## 212.106.261114 — scheduler permission-test correction

Staging test candidate. Native GitHub/Supabase CI and Vercel staging validation remain blocking release gates; this is not production approval.

The concurrency helper directly updated provider-owned cron.job to pause and restore the daily job. Supabase rejects both writes, producing the two errors in the reported CI failure. Replace both writes with cron.alter_job, restore the original enabled state independently of fixture-cleanup success, and verify restoration. Extend the existing recurrence guard to reject direct scheduler metadata writes, including multiline SQL.

Local evidence includes the full 232-migration chain and a restricted non-superuser reproduction: the old helper fails with the two reported errors; the corrected helper passes actual competing sessions with initially enabled and disabled jobs; an injected setup failure remains a failure and restores the scheduler. These checks supplement the native Supabase gate.

No additional migration. All existing SQL migrations, including 0234, and application behavior source remain byte-identical to 212.105. Generated version metadata advances to 212.106. Analytics is paused and no analytics changes are included. See RELEASE_VERIFICATION_212.106.md.

## 212.105.261114 — fresh-database permission-test correction

The new daily stale-game test attempted to call EXECUTE-revoked maintenance as an authenticated member. This repeats the Supabase-image crash pattern documented in 208.4 and HANDOFF.md. Replace that call with has_function_privilege(current_user, ...), preserving the real timestamp-tampering and admin/member RLS checks. Add all seven private maintenance helpers to the existing central privilege assertion. Extend the existing recurrence guard with app-role direct-call detection and nine executable canaries.

No application behavior, scoring rules, migration SQL, database grants or policies change. Migration 0234 remains byte-identical to 212.104; no additional migration is required. The full source includes all 212.104 functionality. The screenshot proves a lost backend connection in the app-role DO block; confirming the native supautils crash signature requires the expanded database diagnostics. Hosted GitHub/Supabase and Vercel staging checks remain release gates.

## 212.104.261114 — Daily stale-game maintenance

- Migration 0234 replaces app-open maintenance with one server job at 4 a.m. Eastern, rescheduling the same named daily job across DST without changing other jobs' timezone.
- Delete genuinely empty games seven Eastern calendar days after the later of creation/play date. Preserve Test clubs, future games, financial/contest records, posted rounds and Cup schedules (unlink the empty session game only).
- Complete scheduled 9/18-hole individual or canonical shared-ball cards after 24 hours without scoring; guests count and explicit no-shows are excluded. Existing posting/handicap rules remain authoritative.
- Send one existing in-app game notification to the organizer for inactive partial cards after 48 hours. New scoring resets the review flag; partial scores remain unchanged.
- Retain completed/failed daily run counts and bounded technical details; reuse Operations for schedule/result visibility. Remove the old Home sweep calls and browser execution grants.
- Track actual score changes; optional stats do not restart the timer. Existing unfinished cards receive an installation-time grace baseline because older personal/initial-insert score timestamps were not recorded reliably.
- Reuse the existing personal-round finish helper for complete saved 9/18-hole plans. No deletion of personal rounds. Source migration and rollback/concurrency assertions run in both fresh-database gates.
- Includes the 212.102 tee fix and 212.103 yellow recovery-panel consolidation. No dependency update.

## 212.103.261114 — One yellow round recovery panel

- Reuse the yellow Resume design for local-only, server-only and matching local/server unfinished rounds.
- Match with existing stable round/draft-session identity; distinct rounds remain separate. Prefer local draft for Resume, preserving unsynced scores.
- Keep Mark complete/Delete/Discard all under Round options. Pending local changes route completion through the existing scorecard save flow.
- Clear matching local recovery only after successful completion/deletion; bulk discard clears only draft IDs returned by the server.
- No migration, dependency update or stale-game automation change. Includes 212.102 tee correction.

## 212.102.261114 — Organizer saved-tee selection

- Use the same validated library/saved-player tee options for displaying and saving individual tee selections.
- Keep library precedence, optional yardages, setup confirmations, handicap calculation and reload behavior.
- Show a recovery message if a requested tee is unavailable; exclude missing/non-finite/non-positive rating or slope.
- No database migration, dependency update, course refresh overwrite or stale-game policy change.

## 212.101.261113 — readable diagnostics and retained update results (candidate)

- Add an expandable, readable device summary: installed app, actual controlling-worker version, waiting-worker state, latest/last-known release, last version-check timestamp/result and diagnostic-storage status. Opening queries the worker without activation; Refresh summary rechecks version/worker. A mismatch/no reply is reported without guessing its cause. Available at the existing member, sign-in and Admin diagnostics entry points.
- Preserve verified update success/failure as Last update attempt in settings and diagnostic exports after the eight-second success banner expires. Keep bounded metadata in this tab's session storage for up to seven days; restores do not replay the success banner. Download/installation, activation and restart failures have distinct recorded phases. Only the actual running version verifies a requested restart. Existing pending-update policy, retry, no forced reload, protected reconnect and score preservation remain.
- Add a 500-character optional What went wrong? field. It appears only in the manually exported JSON as userDescription, never in automatic events or device storage, and resets on panel remount/reload. Whitespace/control characters are normalized. Explicitly warn that typed context is included verbatim and should exclude sensitive information. Share/cancel/download/failure/retry behavior remains.
- Give the signed-out screen its own vertical scroll container so expanded diagnostics and sign-in remain reachable inside the app’s locked body. Keep the context field in the standard app font.
- No database migration, dependency, scoring, service-worker cache/activation-policy, API or Vercel protection change. This full-source candidate requires external CI/Vercel and the same open physical-phone 212.100 → 212.101 banner/update/retained-score test before production approval. See RELEASE_VERIFICATION_212.101.md.

## 212.100.261112 — exportable phone diagnostics (candidate)

- Add automatic, local support history for startup/focus/background, connectivity, authentication outcomes, update/worker transitions, first-party/Supabase HTTP status/timing/correlation, save queues/acknowledgements, held/failed score sync, local backup outcomes, device-role/storage failures, sampled realtime state and unexpected browser errors. No request/response bodies, authentication headers, cookies, query strings, names or score values are collected.
- Export structured JSON from More → App version & updates, Admin → Diagnostics, or the sign-in screen. Use the phone share sheet when available and a download fallback otherwise; busy, cancellation, failure and retry are explicit. Export is user-initiated and never automatically uploaded. Existing score-recovery exports and opt-in legacy tools remain separate.
- Bound evidence to 150 events / 48 KiB of text per session, four sessions, seven days. Storage denial/quota falls back to memory without deleting scores. Account-bound history is filtered on export; sign-out clears diagnostic memory/history with existing local-state cleanup. Timeline entries retain their original app version across upgrades. Reports include origin/backend origin, build, UA/time offset, actual controlling-worker version, install/cache/asset-failure metadata, viewport and notification-permission snapshots, registration states and shell-cache versions; stored backup counts are explicitly not an unsynced-score verdict.
- Instrument existing save helpers without changing arguments, callback order, write payloads, queue rules, acknowledgement/rollback behavior or results. Do not export the old raw save trace because it contains player names/scores; bridge only fixed categories/reasons/error codes. Realtime observation is read-only sampling, not channel/message logging.
- Add privacy/persistence/transport tests, 116 executed baseline/current save scenarios, export UI outcomes, real-browser version/worker/history/quota tests, and read-only worker status checks. Preserve 212.99 redirect/cache safeguards and all prior update/recovery tests. No database migration, dependency, authorization, scoring-calculation or deployment-protection change.
- Limits: records start after this version loads; they cannot reconstruct the original 212.97 incident, inspect HttpOnly authentication cookies or expose hidden cross-origin redirect headers. HTTP 200 alone is not a successful business action. Full local/external validation status: RELEASE_VERIFICATION_212.100.md. Production remains pending external gates and physical phone export/update checks.

## 212.99.261112 — preserve redirects during app navigation (candidate)

- Correct the worker regression introduced in 212.84: forward navigation redirect responses to the browser before considering saved-HTML fallback. A deployment sign-in redirect must not be replaced by the old app. Preserve explicit update activation, normal successful navigation, offline scoring and all saved data.
- Refuse to cache followed redirect responses or unmarked 200 login/error pages as an offline application shell. A non-visible RootLayout marker identifies BNN HTML before cache admission. Redirected or HTML sign-in responses cannot count as downloaded JS/CSS assets; an incomplete shell retains the old offline copy. Keep existing version/access diagnostics and the explicit recovery route; no new automatic navigation, sign-out, storage cleanup or protection bypass.
- Permanently execute historical/current worker redirect comparisons for 301/302/303/307/308 and same/cross-origin destinations. Add same-installation 212.98→candidate→next-fixture update tests, normal navigation and explicit reconnect recovery, cross-origin login/non-excluded callback, repeated access loss, server/offline failure and retry, verified target version and draft preservation.
- Add handler-model checks for opaque/status redirects, followed-login cache safety and outage fallback. Existing older-window, active-entry, missing-asset/cache-quota and stale-page/retry tests remain mandatory. No database migration, dependency, scoring, chart or CI workflow change.
- The original phone's 302 is observed, but its initiating session event and Safari's 20-redirect chain remain unresolved. This candidate does not silently renew Vercel access or deliver code to an installation whose downloads are denied. Use the owner's working 212.98 installation for physical same-installation validation. Do not count a new shortcut as a passing update test.
- Local validation and remaining external gates: RELEASE_VERIFICATION_212.99.md. Not approved for production while GitHub/Vercel/protected-iPhone checks are pending.

## 212.98.261110 — protected-deployment update recovery (candidate)

- Keep deployment protection enabled. Detect denied/redirected version requests, HTML responses, malformed data, server errors and timeouts; report the last attempt and distinguish a failed check from a version never checked. Explicitly send same-origin cookies and inspect redirects without silently following a deployment login.
- Show an access-recovery banner and Reconnect to app link after a denied/redirected check. Recovery is explicit navigation through /auth/deployment-access, which existing workers already exclude from offline fallback. Vercel still authenticates before the route executes; the route only redirects to a fixed same-origin Home path after access. No token or deployment-protection bypass is introduced.
- Keep normal update activation explicit. Reconnection warns to save current input before navigation; persisted scores/drafts are not deleted. No automatic sign-in navigation or forced reload is added. Recovery cannot promise to renew an authentication session silently.
- Add real-browser protected-gateway simulation with actual worker and recovery route: blocked metadata, no background redirect, explicit login, HTTP-only session, fixed return, successful check and preserved drafts. Add access/error/retry UI scenarios. No migration, dependency or scoring change.
- Full-source candidate. Live protected staging and installed-iPhone validation are required before claiming recovery works in the user's installed environment. A pre-fix installed client does not yet contain the recovery link; the initial protected delivery/reauthentication remains an external validation step. See RELEASE_VERIFICATION_212.98.md.

## 212.97.261109 — reliable chart touch selection and CI interactions (candidate)

- Use click-triggered tooltip selection for touch input inside the existing dismissible profile/admin chart frames; retain hover for mouse input. Close remains explicit and the next deliberate point tap reopens the tooltip. Hybrid mouse/touch changes work in the same mounted chart. Existing dashboard default tooltips, chart values, axes and 20% recent-form calculations are unchanged.
- Replace arbitrary screen-coordinate second taps with locator-based taps that re-scroll and wait for stable geometry. Wait for committed fixture renders and visible outcomes rather than assuming that 80/120ms is enough. Preserve the full chart matrix and close/reopen assertions; also verify new-point content and touch→mouse→touch transitions.
- A slower-browser reproduction failed before the correction and passed focused tests at normal, 4× and 8× CPU slowdown afterward. No test was skipped or retried until green. Full-source candidate; no migration or dependency change.
- The phone report of installed 212.95 not detecting staging 212.96 remains a separate investigation. User-supplied live metadata confirms staging 212.96; an unauthenticated external request redirects to Vercel login, which does not establish the phone's authentication state. No updater policy, cache deletion or automatic reload change is included.
- See RELEASE_VERIFICATION_212.97.md for executed validation and remaining external gates.

## 212.96.261109 — recent-form charts and independent CI lanes (candidate)

- Use a 20% latest / 80% prior-state recent-form line on dashboard scoring form and all 15 clickable performance trends. Keep individual rounds as visible green/red dots, a cream recent-form line and gold overall-average reference. Add a selected-point highlight and date/course/value/baseline tooltip context.
- Show the latest five tracked rounds and compare against the preceding five only with ten eligible observations. Percentage summaries pool recorded opportunities; percentage recent form decays successes and opportunities separately at the same 20% rate. Missing observations never become zero or age the trend. Existing per-round sources, eligibility, range selection and higher/lower rules remain.
- Percentage rate baselines intentionally change from mean-of-round-percentages to pooled hit/opportunity rates. Round dots still show each round's own result. The line is display-only and does not feed handicaps, results or persisted scores. Player-card, season-story and admin charts retain their distinct calculations.
- Run database reconstruction/parity, application checks, chart browser tests and production compile independently in CI. Preserve the required verify name; it fails closed unless every applicable prerequisite succeeds, including staging integration for staging-to-main PRs. Keep all existing commands/tests and local npm run ci. Serialize automated/manual staging integration without cancelling active cleanup.
- Install only Chromium headless shell in the two new browser lanes; retain installed-browser failure behavior. Cache Next build intermediates and upload per-lane timings for measured follow-up. Runtime savings remain unmeasured until GitHub runs; no migration or dependency update.
- Full-source candidate; see RELEASE_VERIFICATION_212.96.md. External GitHub, fresh database, staging, Vercel and phone gates remain pending.

## 212.95.261107 — responsive charts and readable axis labels (candidate)

- Apply the approved chart design: Recharts automatic Y-axis width, responsive month/year labels for longer histories, and explicit separation between labels from opposite axes. Keep one observation per round, the existing rolling-average calculations and the >30-round dense-view transition.
- Fit Season Wrapped charts to their host. Use the same responsive chart rules on dashboard differential/stat trends and admin weekly charts. Dense admin counts remain available in dismissible tooltips; top-of-bar values remain only where a responsive width/glyph budget fits them.
- Render player-card form with Recharts, readable 11px labels, captions aligned to plot edges and a distinct flat-series scale label. Preserve the original form values and average-relative colours. A slightly taller label row preserves plotting height.
- Share existing tooltip close/remount behavior without changing default dashboard tooltip formatting. A 2px chart-edge safety margin and tiny inward endpoint-label shifts accommodate SVG/DOM glyph measurement rounding. New player/admin tooltips stay closed until deliberate interaction after dismissal, including touch.
- Add real-browser bounds, within-axis and opposite-axis clearance tests, responsive round trips, tooltip reopening, invalid-date fixtures and historical calculation/render differential checks. Extend the font guard to cover SVG font attributes.
- Correct a pre-existing route-test fixture that used the UTC day instead of the club report’s Eastern day near midnight; server behavior is unchanged.
- Full-source candidate. No migration, schema, scoring, handicap, score-saving, membership, report-cadence or update-policy changes. esbuild is a development-only dependency for the browser regression fixture. See RELEASE_VERIFICATION_212.95.md; external release gates remain pending.

## 212.94.261106 — gross and net club scoring (candidate)

- Show Gross and Net side by side, with separate eligible-hole counts and percentages. Labels are Eagles+, Birdies, Pars, Bogeys and Doubles+. No personal names or rankings.
- Use existing full course-handicap statistics basis for individual cards and saved team-handicap rules for shared cards. Respect manual/scratch/plus/nine-hole snapshots. Unknown or invalid handicaps do not become scratch; incomplete allocation data is excluded and disclosed. No net-eligible holes displays dashes.
- Shared team holes count once; existing gross/participation/course/format totals and 30/90/YTD behavior remain unchanged. Historical personal-round reads include existing saved handicap fields; no schema change.
- Share the existing gross category classification with Net, including zero/negative net outcomes. Existing gross hole inclusion and classifications are preserved by differential tests. No game-result, handicap computation, score persistence, report cadence, permissions or updater-policy change.
- Full-source candidate; see RELEASE_VERIFICATION_212.94.md for executed/modelled checks and pending external gates.

## 212.93.261106 — readable club dates and explicit member total (candidate)

- Show club play periods as Oct 8 – Nov 6 rather than ISO dates. Include years on both ends when a range crosses a year boundary. Format civil dates consistently in every viewer time zone; date/query boundaries are unchanged.
- Label the existing membership tile Total club members. Preserve the current active non-support member count, independent of the play window; keep invitations separate. Include the actual membership summary in the candidate preview instead of omitting it.
- No aggregate/scoring, period selection, endpoint, membership permission, report-cadence, dashboard or updater changes. No migration or dependency change. Full-source candidate; see RELEASE_VERIFICATION_212.93.md.

## 212.92.261106 — club play periods and aggregate engagement (candidate)

- Add Last 30 days, Last 90 days and Year to date using US Eastern calendar dates. Update all club play totals together; keep app-open activity explicitly separate.
- Add repeat-player count (2+ distinct qualifying rounds), completed-game format mix, recorded holes and gross eagles/birdies/pars/bogeys/doubles+ totals. Reuse the existing gross scoring buckets. Shared Scramble/Alternate Shot holes count once per side; personal game posts do not count twice. Missing par is disclosed and excluded from score classification.
- Keep details expandable/collapsible inline, no Activity tab, no player names or performance rankings in the aggregate section. Keep the published report, member directory/phone/profile/Say hi, club permissions and actual Settings invitation controls.
- Remove the redundant Invite members shortcut from the club header. Club name remains cream.
- Owner selected shorter dashboard copy to fit one line: “Stats: 5 rounds · WHS index: best 8 of 20” (round count changes with selection). Sage text, 11px minimum; no scoring/index calculation change.
- No migration, report-cadence, dependency, scoring persistence or updater-policy change. Full-source candidate; executed/modelled evidence and pending external gates: RELEASE_VERIFICATION_212.92.md.

## 212.91.261106 — simplify Clubs and expose the published report (candidate)

- Remove the Activity tab. Members and Club settings remain; member search/filter state survives the round trip.
- Expand/collapse course rankings inline in the existing engagement summary, without changing the selected section. Reset expansion on club change.
- Show the latest published club report directly in Members, with its actual period label, existing expand action, distinct loading/absent/error states and Retry. Do not duplicate it in Settings.
- Existing reports are scheduled July 1 (January–June) and October 1 (July–September); no monthly schedule is added or implied. Production schedule/publication status has not been checked here.
- No SQL, report-generation, scoring, engagement-counting, authorization or updater behavior changes. Full-source candidate; see RELEASE_VERIFICATION_212.91.md.

## 212.90.261106 — one club member directory (candidate)

- Combine Players and Clubs into a Clubs hub with Members, Activity and Club settings. Keep legacy Players links and Admin shortcuts working.
- Retain player cards, contact links, handicap editing and club role/removal actions. Add search and member/admin/invited/missing-handicap filters.
- Summary counts current members, members who opened BNN within 30 days, and invited players (club admins) or club admins (members). Exclude support memberships from directory counts; app opens are explicitly not club participation. Unknown activity is labelled.
- Paginate memberships/profile reads, reset per-club state on switching, preserve rows on read failures and show Retry. Reject failed role/removal writes before success side effects; club deletion is unavailable when membership reads fail.
- Activity shows only a saved report; absent reports and failed reads have distinct empty/error states. No sample report, report-generation job, SQL migration, scoring or updater changes.
- Live 30-day engagement: qualifying member rounds, participating members, courses, participation percentage and the three most-played courses. Includes finalized club-linked personal rounds and shared-ball participation; game-posted rounds count once. Club-member-authenticated read-only endpoint returns aggregates only. No published report required.
- Full-source candidate. Local/external evidence: RELEASE_VERIFICATION_212.90.md.

## 212.89.261102 — consistent match result cards (candidate)

- Keep team names and players in Four-ball/Alternate Shot; reuse the Trifecta row to emphasize the leading side and show the official closeout. Existing detail toggles remain.
- Keep Trifecta thru counts on one line and allow long names to wrap. Singles final ties show Halved on both sides with Final beneath the hole count; live neutral display is unchanged.
- Label Team Skins best-ball pairs with their team names; skins totals/carries remain unchanged.
- Preserve the original Scramble layout: white match title, gold result at roster size, leading roster gold, each player and team handicap listed once. Field leaderboard unchanged.
- No scoring-engine, persistence, updater, database or member-description changes. Full-source candidate; external gates remain required. See RELEASE_VERIFICATION_212.89.md.

## 212.88.261102 — portable CI browser discovery (candidate)

- Fix update browser tests throwing ENOENT when /opt/pw-browsers does not exist on GitHub Actions. Use the Playwright-installed browser by default when no local provisioned binary exists; preserve PLAYWRIGHT_CHROMIUM override precedence.
- Add launch-policy regressions for CI/local/override/stale installations and genuine failures. Browser tests still run and still fail if Chromium cannot launch.
- No app update-policy, scoring, draft, membership copy or database changes. Version metadata bumped consistently. Full-source ZIP; see RELEASE_VERIFICATION_212.88.md.

## 212.87.261102 — keep the update prompt until applied (candidate)

- Remove Later/Dismiss from pending updates. Update now is the only banner action; old session dismissal flags are ignored.
- A fresh server check confirming a withdrawn release clears obsolete failure feedback; a later new release restores the prompt.
- Keep failure and retry feedback visible. Confirmed success remains visible briefly, then clears automatically after8seconds; expiry can never hide a pending release.
- Explicit activation, no unfinished-round gates, fresh online navigation, stored scores/drafts and worker compatibility are unchanged from212.86.
- No migration or capability-description changes. Full local verification and external gates: RELEASE_VERIFICATION_212.87.md.

## 212.86.261102 — explicit update banner (candidate)

- Workers download in the background and wait for explicit activation, preserving older production pages that reload on controllerchange. Existing production SKIP_WAITING messages remain supported, without score-state checks.
- Restore a dismissible new-version banner and Settings Update now action, with one shared status. No unfinished-round gate.
- Version checks run on startup/reconnect/focus; numeric version ordering prevents requesting an older release.
- Explicit update rechecks the server, requests the worker update, and navigates with a fresh URL. A restart target survives reload; success requires the running version to meet that target. Errors/timeouts identify the installed version and allow retry.
- No forced reload on deployment/focus/controller change, no score/draft deletion or automatic uploads. Member capability descriptions remain as212.85, pending owner review.
- No migrations. Actual iPhone/staging verification remains required. See RELEASE_VERIFICATION_212.86.md.

## 212.85.261102 — refresh what members can do (candidate)

- The shared in-app capabilities list and both downloadable one-pagers now include Scramble, Alternate Shot, Ryder Cup events and round recaps.
- Help's Formats answer covers all8 supported game types, with new Scramble and Ryder Cup guidance; Games with friends no longer implies only Stableford/match play.
- Course-correction wording reflects per-club changes before global approval. Offline wording describes saved scores and reconnection rather than guaranteeing that scores can never be lost.
- Add a supported-format coverage guard to local CI and the one-pager workflow, plus a release checklist requirement to refresh member guidance with future features.
- Quiet automatic updates unchanged. No banner, migration, email send or email schedule. Full codebase delivery; see RELEASE_VERIFICATION_212.85.md.

## 212.84.261101 — automatic updates (candidate)

### Behaviour changes
- Supersedes212.79–212.83 update deferral: background installation is automatic, and a fresh open/refresh loads current server code. No manual Update button, update banner, round-completion gate or correction checklist.
- An already-open document keeps running; no focus/controllerchange/deployment reload is added. Returning to a suspended window does not restart the game. The new worker may activate/change controller, but the new page does not reload itself on that event.
- No game/round data is deleted, discarded or automatically uploaded. Normal score saving, pending uploads and single-primary-device controls remain unchanged.
- Complete offline shell dependencies are cached before root HTML is committed. Old assets are retained while other documents may need them; cache errors do not prevent successful online navigation.

### Delivery and checks
- Full codebase ZIP; no database migration. Recap-stat fixes retained. Settings shows current/deployed versions and explains next-open behavior; earlier recovery copies remain exportable.
- Actual212.83-worker upgrade, new-version transitions, legacy/sleeping and active windows, unsaved entry, offline-before-first-refresh, draft/outbox survival, cache pruning and API bypass are exercised in Chromium. Fault-injected worker checks cover missing assets/cache quota failures. See RELEASE_VERIFICATION_212.84.md for final results and live staging gates.

## 212.83.261101 — open the item that needs correction (candidate)

- Warning titles and saved-score reviews link to their exact game or personal-round ID and show the source club. Covers player-score backups, team drafts, tracked games and personal rounds/edits.
- Club names come from authenticated record joins, persisted item metadata or matching boot-cache club IDs; unknown club is labelled unknown, never substituted from the current picker.
- In-app taps resolve access and select the source club before opening the game/round. UUID links support TST test-game codes. Copy/open links also resolve on startup, before automatic resume. No changes to existing six-digit game links.
- Repeat navigation remounts the game/editor so stale component state cannot keep the prior item open. Update-details sheet closes on a correction link. Missing/offline/inaccessible records show an explanation without modifying saved scores.
- No migration. Full source ZIP; staging/GitHub and affected-iPhone checks remain external gates. See RELEASE_VERIFICATION_212.83.md.

## 212.82.261101 — verify saved scores and resolve update warnings (candidate)

- Home/start/focus/update checks verify pending player-score backups against authenticated, RLS-protected Supabase reads; up to four checks concurrently, bounded reads, no automatic uploads.
- Matching current-version scorecards refresh their local sync confirmation; real differences, missing/hidden rows, offline failures, malformed data and reset versions remain protected.
- Settings shows current-version success independently of pending scoring. Verify saved scores shows per-field scheduled-position differences and identifies player/game.
- Explicit completed-game Use database version re-reads both sides, requires the same review, no mounted editor and only one service-worker window; archives the old scores before replacing the local backup. No database writes. Recovery copies can be downloaded; export before sign-out/site-data clearing. Active games cannot use this path.
- No database migration. Full codebase ZIP. Run staging integration and GitHub CI, then check the actual iPhone flow; local evidence in RELEASE_VERIFICATION_212.82.md.

## 212.81.261101 — validate recap stats from saved scorecards (candidate)

- Fairways use canonical hit/miss/left/right values, require a valid entry on each scheduled par-4/5 and preserve explicit all-miss zero. Fixes false 0-of-14 tie in game 947286.
- Putts require nonnegative integer values on scheduled holes only. Extra slots cannot qualify a missing hole or inflate the total; recorded zeros remain valid.
- Bounce-back tiles retain each player's actual birdie/eagle and preceding double/triple/higher score and hole numbers.
- Labels describe par-or-better streaks, birdies-or-better counts, exact best-net-hole results and the score-entry time window honestly.
- App net-birdie/eagle positions preserve golf-style ties; email includes every player tied at the fifth-place cutoff.
- Canonical string-valued fixtures replace Boolean fairway mock data. New real production-data fixture (identity UUIDs sanitized) verifies recap/app/share/email values.
- No score/data mutation, migration, update-policy change or stale-game auto-ending change in this stats release. Stale-game investigation is separate and read-only.
- Full source delivery; evidence and staging checklist in RELEASE_VERIFICATION_212.81.md.

## 212.80.261101 — actionable update results and dismissal (candidate)

- Fix the silent Updating -> banner loop: the worker returns accepted/refused results with blockers. Missing acknowledgement, installation/download errors and restart timeout have explicit feedback; no navigation bypass of a waiting worker.
- One shared update controller for banner and Settings. Success is reported only after the installed version matches the requested target after reload.
- Dismiss hides the notice for that release, including later passive checks/reopens. Settings remains available; a different release can announce itself.
- Live local checklist identifies games by name/code, personal rounds by course/date, pending rows by player/count, failed local checks and other-tab refusals. Instructions preserve drafts and say to continue playing rather than end a live game for an update.
- Existing update protection, handicap fix and scoring calculations retained. No migration or obsolete-file cleanup.
- Full source ZIP; local/staging/GitHub evidence in RELEASE_VERIFICATION_212.80.md.

## 212.79.261101 — defer app updates during scoring (candidate)

- Active game/personal-round sessions hide update controls and defer update-driven reloads, including after navigation away.
- Pending score/stat/deletion outboxes and failed local storage prevent updates after the game ends. No database or scoring-rule change.
- Worker activation requires acknowledgements from every open window. Unknown/legacy/frozen tabs veto; no timeout may be interpreted as completion.
- Settings uses the same policy. Deferred controller-change reload runs only after protection clears.
- First rollout: already-open older clients lack the responder, so close all BNN tabs/windows after finishing and syncing, then reopen to install. No forced update during play.
- Full source ZIPs from this release; obsolete-file cleanup is deferred.
- Verification and outstanding staging/GitHub checks: RELEASE_VERIFICATION_212.79.md.

## 212.78.261101 — manual-handicap comparison correction (candidate)

- Fix recap/field comparisons reading missing Handicap Index as zero. An explicit zero remains valid.
- A manual course handicap uses a game-specific equivalent index: `(manual CH - (saved rating - saved par)) * 113 / saved slope`. It takes precedence over a recorded index for this comparison only. This estimate is not written to profiles or used to replace the manual scoring handicap.
- Without a numeric manual override, use the recorded game-row index. Without a usable comparison basis or saved rating/slope, omit that player's differential comparison. A manual override without enough tee/course data is unavailable rather than compared against a conflicting recorded index.
- Keep existing 18-hole/full-card eligibility, field thresholds, adjusted-gross calculation, format scoring, net scores, team handicap totals and points rules. The 9-hole scoring/override rules remain unchanged; no new 9-hole standout conversion is introduced.
- Shared highlight builder feeds app recap, share image, emails, club reports and admin Standout watch.
- No database migration or stored-data rewrite. All 212.77 fixes remain present.
- Regression examples use Rajat/PJ's reported CH/rating/slope with **assumed saved par70**; the scored cards in the regression are synthetic, not the latest production game. Latest game-specific totals still require saved game data.
- See RELEASE_VERIFICATION_212.78.md. Candidate is not declared deployable until required checks pass.

## 212.77.261030 — agreed audit fixes (candidate; not deployment-ready)

- Settlements require the caller to be an active member of the payment's club, preserving party/admin authorization and historical counterparties.
- Participants cannot clear ended cards. Organizer correction/reset and administrator paths remain authorized.
- Public scoring retains manual course-handicap source across scoring adapters. The organizer notice explains hole count and separate format allowance.
- New reports use registered user IDs and current readable profile names; historical game rows and published reports remain unchanged. Unavailable profiles keep the saved name; failed profile reads stop generation.
- Migration: `0233_club_score_and_report_contracts.sql`. Staging first. See `RELEASE_VERIFICATION_212.77.md`; remote gates remain required.

## 212.76.261030 — One source for a live player's course handicap; the handicap audit (index, tees); audits 3–7 (names reach games, Cup points on the recap)

Owner (Oct 30, after 947286): "shouldn't the handicap be derived from one place for all calculations and displays? … is it worth doing an audit?" Yes; and the index and tee rules confirmed as designed.

**The audit of 31 direct reads of a stored `course_handicap`:** 12 are a posted ROUND's snapshot (correct, kept: round detail and editor, round prep, the round maths, personal bests, season summary, badges, the round fingerprint); 4 were stale-prone DISPLAYS of a live player — the leaderboard label (212.75), the organizer panel's "course handicap N · plays M" line, its group list, the setup summary; 9 were PRESENCE checks reading the stored number; 3 are deliberate reads of the stored / previous figure (the manual editor's starting value, the "was N" message, the row passed into the accessor). The public line-up and team balancing already computed correctly.
**Now:** `courseHandicapOf` and `hasCourseHandicap` (lib/game-shape, beside the scoring basis) serve every label, summary, line-up, balance and presence check — the scoring basis, rounded for display. The stored number is written by joins, tee changes and overrides, and read only as a round's snapshot. **Guard:** ci/check_course_handicap_reads.py fails on any other read (it catches the old leaderboard line when put back). **Round-trip test** (lib/course-handicap-one-source, 6): join → override 13 → clear → a stale row from the old code → a tee change → no handicap; at every step the leaderboard label, the organizer line, the setup summary, the accessor and the scoring basis agree. With the old leaderboard line restored, two steps fail.
**Audit 1 — handicap index:** no game screen reads the profile's index; every game read uses the row, filled from the roster at creation or by the organizer; the creator's index at Create writes back to the profile. The running index is never used by a game. Working as designed.
**Audit 2 — tee rating and slope:** scoring reads the row's snapshot (9 reads, under the accessor); the live tee table serves only the tee picker's options (merged with row snapshots), the scorecard's yardages and setting a tee (which refreshes the row); the daily freshness check reports and never touches game rows. Consistent; now written down in APP_RULES.md ("Handicap figures — where each one comes from").
**Audits 3–7 (owner: "proceed with the audit for 3-7"):**
- 3 course par and holes — CLEAN: every read (223) uses the game's own copy; the live course serves only the tee picker and yardages.
- 4 names and avatars — INCONSISTENT, fixed: an avatar change reached the profile, every game row and the club memberships (set_my_avatar); a NAME change updated only the profile, so every game kept the old name on the leaderboard, recap and emails. **Migration 0232:** set_my_display_name mirrors set_my_avatar (the profile and every game row, finished games too); the Profile's name save calls it. Test: ci/assert-name-change.sql (the profile and both game rows carry the new name; another member's row untouched). The security contract snapshot records the one new grant.
- 5 stored totals — CLEAN: posting sums the holes, the repost reuses it, the personal editor lets the server recompute.
- 6 money postings — CLEAN by construction: "stale" means posted nets differ from the live nets, so an organizer correction after the end flips it.
- 7 Cup standings — INCONSISTENT, fixed: the Cup page and the email score each session at its points per match; the recap scored every match as 1 point (a 2-point session read "1–1" on the recap, "2–2" on the Cup page), and only scramble sessions used the session score at all. buildRecap takes the session's points (the card and the email sender pass them from the Cup data they already load) and applies them to every team format. Test: a four-ball session at 2 points a match reads 2–2.
Also carries 212.75 (clearing an override stores the derived figure) and its repair script (docs/sql/repair_derived_course_handicaps.sql, one-time).

**Deploy: apply migration 0232** (after 0231; "Run without RLS"), then the package; the repair script once, if not yet run.

## 212.75.261030 — Clearing a course-handicap override left the old number behind (production game 947286)

Owner (Oct 30): on 947286, Ankur Tiku (index 13, course handicap 18 on his tee) showed CH 18 on the group card but CH 13 on the leaderboard, after an override of 13 had been set and then cleared.

**Cause:** clearing an override set the row's source back to "derived" but left the manual number in `course_handicap`. The group card recomputes the figure from the index and tee (18); the leaderboard prints the stored number (13). The two screens read the same row two ways and the clear left it inconsistent.
**Fix:** clearing now stores the DERIVED figure in the row (the same formula a join or a tee change uses), so every screen agrees. The save is a pure helper (lib/manual-handicap: manualHandicapPatch) — tested: clearing stores the derived figure; setting stores the manual number, who and when; clearing with no tee data stores no figure. The 0153 rules test (lib/manual-handicap.test.ts) is unchanged.
**Repair for rows already in that state:** docs/sql/repair_derived_course_handicaps.sql — step 1 lists every derived row on an unended game, for a player with no scores yet, whose stored figure differs from the derived one (expect Ankur on 947286: 13 → 18); step 2 corrects them. Run on production, "Run without RLS".

Deploy: code only, plus the repair script once.

## 212.74.261029 — The recap's field line on one line; the Cup roster row with avatars, 10+ characters of the name, short team labels

Owner (Oct 30): "the round summary Field Average needs to fit on one line, maybe call it Field Avg (net), and can do out / in"; "the selector for the Ryder Cup must show the avatar picture and keep at least 10 characters before the name is truncated. Instead of spelling out the full team name, truncate them to the first few letters"; variant C of the personal bests card (already in 212.73).

- **Field line:** "Field avg (net) 70.8 (−1.3) · out 35.3 (−0.8) · in 35.5 (−0.5)" — one line (never wraps; ellipsis if a phone is narrower still), on the share image, in the app and in the email.
- **Cup roster row:** the member's avatar (initials when none); the name column never narrower than 10 characters; the team buttons carry a short label — the name itself up to 7 characters, otherwise the first four letters of its first real word ("Americas" → "Amer", "The Magnificent Eagles" → "Magn", "Hawks" stays) — with the full name as the button's title. The design gallery renders the row with avatars and long names; the overflow guard passes.
Tests: lib/cup-roster-row (5): the short labels, the avatar, the 10-character minimum, the buttons' labels and titles; lib/recap-additions (22): the field line's wording and that it is one line, in the app, the share and the email.

Deploy: code only.

## 212.73.261029 — GitHub's CI fixed (the overflow guard finds Chromium); personal bests: the dashboard card and the celebration

**The CI failure on 212.72** (owner, Oct 30): ci/check_gallery_overflow.mjs looked for Chromium at /opt/pw-browsers — the development machine's pre-provisioned path, which GitHub's runner doesn't have. The guard now uses Playwright's own Chromium when nothing is pre-provisioned, and names the fix plainly if neither exists; the workflows (ci.yml and staging-integration.yml) install it (`npx playwright install chromium --with-deps`) after `npm ci`. The guard itself is unchanged in what it checks.

**Personal bests** (approved Oct 23; the design chosen Oct 30 from three rendered mock-ups: variant C). From a member's finished rounds, exactly as the dashboard loads them (test clubs never post rounds, so none of theirs count): lowest gross, lowest net, best Stableford, most birdies in a round, best nine (front or back, or a nine-hole round), fewest putts (when every hole has them), longest par streak (3+). Eighteen-hole rounds set the round bests; nine-hole rounds set only "best nine"; in-progress and deleted rounds set nothing. Each best knows the round it came from, the best it beat ("beat your 81 by three shots" / "your first"), and whether it is NEW (set within the last 30 days).
- **The dashboard card** (above Recent rounds): the latest new best as a hero — "78 · New lowest gross · Oak Hollow · Blue · Oct 25 · beat your 81 by three shots" — and the rest as rows with a NEW tag where earned; with nothing new in 30 days, rows only. Tapping a best opens that round. The card is absent until the member has a full round.
- **The celebration:** a gold "🏆 New personal best" box at the top of the game recap (the app view, the viewer's own; never on the share image) and at the top of the round-summary email (the recipient's own), each line naming the best, the value and what it beat. lib/personal-bests-load: one loader for the card, the recap and the email.
Tests: lib/personal-bests (16) — the engine on synthetic rounds (which best, which round, what it beat, 9-hole and in-progress rules, NEW within 30 days, the bests one round set, the beat lines), the card (hero / rows-only, tap opens the round), the email box. The design gallery renders the real card (53-pb-card-real); every gallery screen passes the overflow guard.

Deploy: code only. Staging: the dashboard shows the card from your real rounds; end a game whose round beats one of your bests and the recap shows the gold box.

## 212.72.261029 — Recap's field total, the live link's form, the Cup roster's width (and a guard against sideways overflow)

Owner (Oct 29, staging 212.71): "the Field avg dropped the total, i only see front and back"; "the live scores link should have the same format" as the line-up link; "Ryder Cup Roster Selection does not fit in the width of the phone screen. This breaks the display rule we already have in place".

- **Field average total:** it only showed with 8+ finishers (an older rule) while the new net nines show from 2 — so smaller games lost the total. Now the total shows whenever the nines do (2+ finishers). lib/game-highlights test updated (7 players: a field average; 1 player: none).
- **Live scores link** in the same readable form as the line-up link ("…/live/oak-hollow-oct25-k7m2px"); the server already resolved the slug for the live page (get_live_scorecard accepts it), so this is the app's link only. The long private token is never shown. Test: lib/share-links-form (2); the draft-games links test updated.
- **Cup roster selection** ran off the phone: each row holds the name, "In" and two TEAM-NAME buttons, and the buttons never shrank. The row is now its own component (CupRosterRow): the name truncates, the two team buttons share the remaining width and truncate, so a row is never wider than the phone.
- **The guard the rule needed:** ci/check_gallery_overflow.mjs — every design-gallery screen is laid out at 390px and the right edge of every element is measured (a clipping frame hides sideways scroll, so content, not scroll, is what's checked); any screen wider than the phone fails. The Cup roster joins the gallery with long team names — with the old buttons it fails at 540px. Runs with the guards.
Also answered: the game recap in the app is on the Play tab of every ended game, for everyone who can open the game — every player and their clubmates, not only the organizer.

Deploy: code only.

## 212.71.261029 — The game recap: segments, side contests in the email, stats and streaks, standouts on the share; no money anywhere

Owner (Oct 29): segments were missing from game 494730's summary; "lets exclude money from all summaries period"; stats tiles and streaks; the share image is one phone screen (today's card, 943px, is the limit — "flex the amount of people to show in Net birdies … to top 3 if we need space (or eliminate it entirely)"); standout rounds bump the net birdies; the field average as "Field average (net) · 73 (+1) · front 36 (E) · back 37 (+1)"; the toughest / easiest holes say who made par or better. Iterated on rendered mock-ups (the design gallery: lib/recap-mockups), every format reviewed on its own card.

**Modified, not rebuilt** — the recap engine (lib/game-highlights, lib/game-recap-sections), the body (components/game/recap-body), the card and the round-summary email:
- **Segments** — Stableford and stroke play, following the game screen (sixes unless set to nines or off): on the share a line ("Sixes · 1–6 Raj 14 · 7–12 Nihar & Amit 13 · …", or "<name> swept all three"), in the app a box, in the email a section. Points or net strokes; never money.
- **Side contests** — now in the email too (one shared loader, lib/contests loadContestLines, for the card and the sender).
- **Stats and streaks** — fewest putts, most fairways, longest par streak, a bounce-back birdie (a birdie straight after a double): only stats the field entered. The app and email show every one; the share keeps the NOTABLE ones (putts ≤ 30, streak 5+, fairways 10+, any bounce-back), two at most, in the tile grid. Shown for team formats too ("shows who really played well").
- **The share image** — net birdies top 3; standout rounds take net birdies' place when there are any; tighter rows in the leaderboard and net-birdies boxes; "Tied at the top" dropped when it repeats the headline; toughest and easiest on one line with par-or-better counts. Heights (the 943px limit): Stableford / stroke 844–866, match 897, four-ball 894, alternate shot 844, skins 883–913, Cup session 955, trifecta 995 (accepted: its six results).
- **Field average (net) · 70.8 (−1.3) · front 35.3 (−0.8) · back 35.5 (−0.5)** — net nines (new: frontBackNet) against each nine's par; app, share and email.
- **Trifecta** had no results table (in v1.0 either): now its six contests — two singles and the four-ball per foursome — ordered by the winning side.
- **No money in any summary**: the card's "Winnings posted in Money" line removed; the email never had it.
Reviewed and unchanged: match play, team match play, four-ball, alternate shot (no individual stats, by the shared-ball rule), the three skins styles, scramble (field and team v team — drives not shown, by decision), the Ryder Cup session card (the Cup standing box).
Tests: lib/recap-additions (20) — segments (sixes, nines in net, off), stat tiles (entered only; notable on the share, two at most), the net nines adding to the field average, the share's field and hole lines, segments line vs box, contests line, standouts in net birdies' place and top 3 without, the app's box and tiles, the email's sections, NO money in app / share / email, trifecta's six results; negative-tested. Every existing test passes unchanged.

Deploy: code only.

## 212.70.261029 — The App Testing club's games don't exist for stats (migration 0231)

Owner (Oct 29): "exclude all matches played by the app testing group — that is literally meant for testing only, all stats in that club must be excluded like they don't exist."

**Where they were counted.** Test clubs (groups.is_test, 0106) never post rounds, so everything built on the Rounds table — the Rounds tab, handicap index, trends, profile stats, standout checks, badges — already left them out, and the admin analytics honour the flag. Two readers are built on the GAMES themselves and had no filter: head-to-head / member insights (every ended game the member played, across clubs) and Season Wrapped (matches, "played with most", team rounds). And a test club's quarterly report could be emailed.
**Now:** one shared rule (lib/test-clubs: the test clubs' ids, and "drop their games") applied to head-to-head and Season Wrapped — and to be applied to every game-based stat that follows (personal bests, streaks). Migration 0231: due_club_report_emails skips test clubs.
Tests: lib/test-clubs (2); ci/assert-test-clubs.sql — a test club's report is never emailed, a real club's is; negative-tested. Full migration chain + every assertion pass on local PostgreSQL 16.

**Deploy: apply migration 0231** (after 0218–0230; "Run without RLS"), then the package. Head-to-head and Season Wrapped recompute on open, so test-club games vanish from them immediately.

## 212.69.261028 — The Ryder Cup session walkthrough: Eagles v Hawks, 5 a side, through the real Create screen

Owner (Oct 28): "simulate a Ryder Cup with 10 players 5 a side … two teams Eagles and Hawks". 212.68 left the Cup-aware hint and the planned-match line untested; now the Create walkthrough runs that exact session.
A four-ball session planned as 2 matches, the Cup's seed with 5 Eagles and 5 Hawks: one step; the Players hint reads "Eagles 5 · Hawks 5 — … Eagles: untick 1 (4 play); Hawks: untick 1 (4 play)"; one sit-out unticked a side → "Eagles 4 · Hawks 4 — 2 matches of pairs"; the Teams step's team card is LOCKED ("The Cup set the sides …", no Edit names, no Start over, every side button disabled, Eagles / Hawks shown); Build even groups; Review shows "2 of 2 planned ✓"; Create game is ONE save with the Cup's name and team names, 8 players with their sides, 2 foursomes and side contests off; the game is linked to the session only if still unlinked. 154 checks in the walkthrough; the v1.0 parity check unchanged at 32 of 32.

Deploy: code only (tests).

## 212.68.261028 — Ryder Cup sessions in the one-step Create flow, checked field by field against the v1.0 record

Owner (Oct 28): sessions plug into the one-step Create; the Cup's sides locked; sit-outs unticked on the Players step for every format (a scramble session keeps its team size); a planned-match check on Review; the link to the session with v1.0's safety; side contests off; straight to the scorecard.

**Create for a session:** Course → Game (format fixed by the session) → Players (every Cup member on their side, pre-ticked; the hint reads the sides — "Eagles 5 · Hawks 5 — a 2 v 2 session needs the same number a side in pairs: Eagles: untick 1 (4 play); Hawks: untick 1 (4 play)") → Teams (the Cup's sides, names and colours shown on a LOCKED team card — no picking, renaming, balancing or Start over; then the captain's choices: the 2 v 2 groups and first drivers, the trifecta pairings, the singles matchups, or the scramble teams built within each side at the session's team size, side v side) → Review (the usual lines plus the session's planned matches: "2 of 2 planned ✓", or amber "1 match — the session planned 2") → Create game: one save that carries every player's side (a scramble's too — Cup scoring reads it), then the link to the session exactly as v1.0 made it (only if the session is still unlinked; otherwise the game is removed again and the organizer told), then the scorecard.
**The record corrected on the way** (212.67's transcription): v1.0 built a session's rows with side contests OFF (bets false); and a session is played 4 a side, so the session scenarios gained an eighth member (Dev Kapoor) in place of the absent guest — v1.0's record with 7 would have stored a 2 v 1 group that Cup scoring skips. Every club record is byte-for-byte unchanged; the three records (Create, structure, server equivalence) agree.
**The v1.0 parity check now runs all 32 scenarios** — the 26 club formats and the 6 sessions, each driven through the real Create screen with the Cup's seed — and compares the game row, every player row, teams, groups, foursomes, matchups AND the session link with v1.0's record: 32 of 32 match. It caught two gaps while the step was built: a Cup scramble sent no sides (Cup scoring needs them), and the session rows' bets.
Not yet under test: the Cup-aware Players hint's wording and the planned-match line (the record has no planned count) — covered by the staging check below.

Deploy: code only. Staging: open a Cup session → Create game: the locked team card, the groups, Review's planned-match line, Create game, then the Cup page shows the session linked.

## 212.67.261028 — Ryder Cup sessions: the v1.0 snapshot, before any change to their flow

Owner (Oct 28): sessions should plug into the one-step Create — and, after this week, no flow changes without a v1.0 yardstick first.

**Recorded, exactly as v1.0's Create handles a Cup's seed** (transcribed from the code, not from memory): the game named "<cup> · <session>", the Cup's team names, Team match on (a singles session is a team match), side contests off, the Cup's scramble team size in "match" mode, each row already on its Cup side (participantTeams), no guests; afterwards the game linked to its session (competition_sessions.game_id, only if the session is still unlinked — otherwise the game is deleted again) and the organizer landing in Manage Game (matchups for singles, groups otherwise). Six scenarios — four-ball, trifecta, alternate shot, singles, scramble in teams of 2 and of 4 — join the three records: ci/golden/create-behaviour.json (32 cases), the structure record in ci/assert-structure-behaviour.sql (31; a session's rows arrive with their sides, so the organizer never sets teams there — the fixed names skip the absent guest), and the server equivalence test ci/assert-create-game-complete.sql (31 cases: one call stores exactly what the two steps store). Every pre-existing record is byte-for-byte unchanged.
No behaviour change in this release: sessions still take the old route (Create → Manage Game). Next: the session Teams step in one-step Create (the Cup's sides locked; groups, first drivers, matchups or scramble teams chosen there; one save, the link, the scorecard), and the v1.0 parity check extended to the six session scenarios so the new route is checked field by field against this record from its first build.

Deploy: code only.

## 212.66.261028 — The v1.0 parity check: every golden scenario, driven through the real Create screen, compared field by field

Owner (Oct 28): "When we started this project we took a snapshot of what the existing workflow and output looked like and the goal was to compare this to the new workflow and output. I want to ensure this has been done thoroughly and completely for all scenarios."

**What existed.** The snapshot (212.38–212.40): v1.0's Create step recorded for 26 scenarios (ci/golden/create-behaviour.json — every format combination, nine-hole, four-player, captains, team-size variants), v1.0's Manage Game structure step recorded for each (ci/assert-structure-behaviour.sql), and a proof that the one-call save stores what the two steps stored FOR THE SAME INPUTS. What was never done: driving the new Create SCREEN through the scenarios and comparing what it sends — where both of this week's bugs lived.
**Now (lib/one-step-v1-parity.test):** for every golden scenario the REAL Create screen is seeded with the scenario (its format replayed through the same rules the golden used, the golden course and roster, and the golden line-up choices — RED v BLUE, groups 1 and 2, the four matchups, first drivers, the trifecta swap, scramble teams in roster order — as a saved draft), resumed, walked through its line-up step as an organizer would (so its effects run), and the real Create game button pressed. What it sends is compared FIELD BY FIELD with v1.0: every game column (code and id aside), every player row, and teams, groups, foursomes and matchups by player name. The scenario v1.0 refused (split skins above four players) must be refused with nothing saved. Any difference fails CI naming the scenario and the field.
**Result: 26 of 26 match v1.0** — after one fix it found: v1.0's Create refused split skins above four players; the one-step save had no such rule and would have created the game. It does now. Negative-tested: with the 411862 bug (the scramble suggestion storing foursomes) reintroduced, 10 scenarios fail; an earlier version of the check that opened straight on Review missed it, which is why every scenario now walks through its line-up step.
What it proves: for every scenario the project snapshotted, the new screen's draft-to-save path produces the same stored game as v1.0's two steps. What it doesn't: it seeds the line-up rather than clicking every editor control; the editors are shared components covered by the Create walkthrough and Manage Game's tests.

Deploy: code only.

## 212.65.261027 — v1.0 parity, every format: best-ball team skins is a 2 v 2 game (teams + foursomes), not matchups

Owner (Oct 27): "Have you checked other game types to see where 2.0 might differ from 1.0? Focus on what the code displays in both versions for each game type."

**Method.** The game room displays only the game's data, so for every format the question is whether v2.0's one-step Create SENDS the same structures v1.0's two-step flow stored. The game row comes from the same payload builder in both; the structures from the same builders (four-ball foursomes, trifecta's swap, alternate shot's first drivers, scramble teams, match-play matchups — the code Manage Game used, moved verbatim); the 0219 equivalence test proves the save stores what the two steps store for the same inputs. So the risk is where Create CHOOSES a different structure — the class of the 212.64 bug. The walkthrough now captures the real save payload for every format (WALKTHROUGH_DIR/payloads.json) and asserts the structures.
**Found: best-ball team skins.** v1.0 had two team-skins styles — head-to-head (teams + 1 v 1 matchups; Stroke play → Skins → Team skins) and BEST-BALL (teams + 2 v 2 foursomes, built in the scorecard's own 2 v 2 setup; Match play → Team → Skins). v2.0 routed both through the match-play Teams step, so a best-ball team skins game would have been created with 1 v 1 matchups and NO foursomes — a different game from v1.0's. Now best-ball team skins takes the four-ball-family Teams step (team card, 2 v 2 groups that are the matches, the four-ball field-size rules) and stores teams + foursomes; head-to-head keeps teams + matchups. Two type-keyed decisions learned the shape: the groups builder's 2 v 2 path and the groups→foursomes derivation (so Manage Game → Groups for a best-ball skins game now offers the same 2 v 2 builder four-ball has).
**Every other format matches v1.0** (payloads checked): Stableford / stroke play — no teams, matchups or foursomes; individual skins — the same; individual match play — matchups only; team match play — teams + matchups; four-ball — teams + 2 v 2 foursomes + groups; trifecta — the same with each foursome's `swap`; alternate shot — the same with each side's first driver; scramble — its teams as foursomes + groups. Post-creation the only v2.0-specific things on screen are the new organizer features (correct scores, take over scoring) and, when groups are used in match play, the match-by-match card labels (212.62).
Tests: the Create walkthrough gains both team-skins styles (146 checks) and asserts, for every format, the structures the save carries (teams, matchups, foursomes). No migration.

Deploy: code only.

## 212.64.261027 — The double view in match play: foursomes stored where v1.0 never had them (migration 0230 repairs existing games)

Owner (Oct 27, staging game 411862, screenshots): the Strokes section showed the singles matchups AND "MATCH 1 / 2 / 3" boxes laid out as 2 v 2 team matches (MEET v ZOOM per group) — "shows groups and match which has the same data twice … This was certainly not the behavior in v1.0."

**Verified from the code.** The Create screen's "suggest balanced scramble teams from the groups" step was written when scramble was the only one-step format outside the four-ball family, so its condition was "one-step and not four-ball family". When match play, skins, Stableford and stroke play joined the one-step flow (212.58–212.59) it ran for them too, built scramble-style "teams" from the organizer's groups, and the save sent them as FOURSOMES. The game room draws foursomes as 2 v 2 team-match boxes — hence the second structure on top of the real singles matchups. v1.0 never stored foursomes for these formats (its save sent none), and the one-step save stores only what it is given, so the game room code is unchanged: the data was wrong. (My earlier explanations — groups, labels — were wrong; the owner's screenshots settled it.)
**Fixed:** the scramble suggestion runs for scramble only; the save sends no foursomes for match play, skins, Stableford or stroke play. **Migration 0230** clears the foursomes already stored on such games (the 2 v 2 best-ball team-skins variant — teams and no 1 v 1 pairings — keeps its foursomes). After it, 411862 shows the singles matchups only, as v1.0 did.
Tests: the Create walkthrough asserts the save carries NO foursomes for all five shapes (140 checks); negative-tested — with the old condition the save carries "Match 1" foursomes for match play and "Team 1" for skins, exactly the bug. Full migration chain + every assertion pass on local PostgreSQL 16.

**Deploy: apply migration 0230** (staging first is fine here — it is a data repair; production has no such games yet, but apply it there too in order after 0218–0229), then the package.

## 212.63.261027 — v1.0 parity after creation: groups are optional again for Stableford, stroke play, skins and match play

Owner (Oct 27): "see how we showed the pairings and scorecards in the prior set up (v1.0) and then compare that to version 2.0 … There shouldn't be a difference once the game has been created."

**The inventory.** The game room is driven by the game's data, so a difference after creation can only come from data v2.0 creates differently. Element by element (group buttons, the "who's keeping this group's card?" prompt, scorer notices, a card per group vs one card, the Strokes card, the match / skins / four-ball / scramble views): every changed element traced to ONE cause — 212.61 made groups REQUIRED above four players for Stableford, stroke play, skins and match play (individual and team). In v1.0 those formats went straight to the scorecard (Stableford / stroke) or to the matchups (match play) with everyone keeping their own card; groups were for organizers who wanted one person keeping a foursome's card (Manage Game → Groups). Forcing groups put every such game into group-card mode: group buttons, scorer prompts, a card per group — the confusing screen on staging game 411862. The four-ball family and scramble are unchanged (their groups ARE their matches in both versions); the 0219 equivalence test already proved the one-step save stores the same data as v1.0's two steps.
**Now:** groups are OPTIONAL again for those formats — the Players hint says "everyone keeps their own card; groups are optional (3 groups of 3 or 4 if you want one scorer per group)", Review shows "Groups: None — everyone keeps their own card", and Create game goes to the same scorecard v1.0 did. Kept from 212.61 / 212.62 for organizers who DO use groups: the builders (Randomize groups now works in Create; "Build groups — two matches each"), groups must be complete and sized 2–4 once used, a matchup can't be split across groups, and in match play a group is named by its matches with the card laid out match by match.
Tests: the Create walkthrough (135) — six-player Stableford and individual match play reach Review with no groups, as in v1.0; the builders, Start over, the complete-once-used rule and the one create call as before. No migration.

Deploy: code only.

## 212.62.261027 — Match play in the game room: everything by match, not by group

Owner (Oct 27, staging game 411862): "in team matches (individual) once the game has been created, it should just show the matches, and not the groups anymore. what matters is match 1 or 2 etc. the app shows your group, other group and then match 1 and match 2. also the way my group is being shown is confusing".

**What was shown.** The same four players three ways: the scoring groups ("Group 1", "Group 2" — now always present, since Create requires groups), the Strokes card with "YOUR GROUP / OTHER GROUPS" (which for match play were your match and the others, mislabelled), and the match list.
**Now, in match play, everything is organised by match.** The group is only who keeps the card, so it is NAMED by its matches: the group buttons and the card read "Matches 1 & 2" or "Match 3" instead of "Group 1". The card's columns are ordered by match — opponents side by side — with a MATCH 1 / MATCH 2 tag over each pair and a divider between matches. The Strokes card says "YOUR MATCH / OTHER MATCHES". Every scoring message follows ("Take over scoring for Matches 1 & 2", "You're keeping score for Match 3"). Nothing changes underneath: a card per group, one scorer per group, the match list as before.
Tests: lib/match-card-layout (5) — columns ordered by match, a tag over the first column of each match only, opponents side by side, a divider between matches, the card named by its matches. No migration.

Deploy: code only.

## 212.61.261027 — Groups are required above four players; a unit moves as one save in every format

Owner (Oct 27): "make sure this logic works for other formats as well … go through all formats"; "why are groups optional? if there are 10 players playing stableford don't they need to be grouped into foursomes?"

**Groups required.** Stableford, stroke play, individual skins and individual match play: once there are more than four players, Review needs everyone in a group, groups of 2 to 4 ("Put everyone in a group — 6 players still without one"; "Group 1 has 5 players — groups are 2 to 4"); four or fewer play as one group and need nothing set ("One group (4 or fewer)"). The Players hint says what's needed ("10 players make 3 groups of 3 or 4"). Match play keeps its rule that a matchup's two players share a group, and the Review's Matchups and Groups lines now each report their own status. The four-ball family already required its 2 v 2 groups; scramble's teams are its groups.
**Building groups.** Individual formats: "Randomize groups" in Create now makes balanced threes and fours (guests with their sponsor) — the same rule as Manage Game; it did nothing in Create before. Match play: "Build groups — two matches each" seats the matches two to a group (an odd count leaves one twosome).
**The unit audit, every format.** Scramble: a team IS a group (saved whole). Four-ball, trifecta, alternate shot: a group is the 2 v 2 match itself; a player moves between slots one at a time, by design. Match play and team match play / team skins: the matchup is the unit — in Create it now moves in one draft change; in Manage Game it moves in ONE server call (set_tee_groups) instead of one call per player, so a failure can't leave half a match moved. Individual formats: the unit is the player.
Tests: the Create walkthrough runs Stableford and individual match play with six players — Review blocked until everyone is grouped, Randomize groups → two groups of three, Build groups → the three matches seated two to a group, Start over, Review ready (135 checks). lib/groups-unit-move (4): moving a matchup in the groups builder is one save with both players when a unit save is offered, and member by member otherwise. No migration.

Deploy: code only.

## 212.60.261027 — Match play in Create: a matchup moves as one unit; Start over for matchups and groups; a split match blocks Review

Owner (Oct 27, testing 212.58/212.59): "If I create a singles match and then assign that match group 1, and subsequently change it to group 2, it only moves 1 player instead of the paired matchup … I cannot clear it out or fix it"; "the teams button is yellow but review is green"; "There is no start over button for build balanced matches or groups".

**The bug.** The groups builder already treats a matchup as the unit — moving a match sets each of its two players' group in turn. Create's draft handler rebuilt the line-up from a STALE copy on each call, so the second player's move overwrote the first's: one player moved, the match was split, and nothing could put it right. (In Manage Game each call saves to the server, so both land.) Now every draft change — team, group, slot moves, Start over — is applied to the LATEST line-up, so a matchup's two players move together.
**Review.** Groups are optional, but a matchup's two players must be in the same group (or both ungrouped): "Raj Mehta and Karan Patel play each other, so they belong in the same group." — so a split match now turns the step and Review amber instead of leaving Review green while the Teams step showed a problem. (In the step bar the CURRENT step is gold and a visited, complete step is green; before this release the split groups didn't count as a problem, which is why Review stayed green.)
**Start over:** the matchups builder offers "Start over" (clears every matchup, and so the groups built from them) in Create; the groups card offers Start over for match play too — it was hidden there with the Randomize button, which stays hidden because shuffling individuals would split matches.
Why it was missed: the walkthrough built the matchups and checked Review, but never assigned a match to a group, never moved one, and never checked the step colours — and I had reused the generic groups builder without checking what the unit of a group is in match play. Tests now: the Create walkthrough puts a match in Group 1, moves it to Group 2 and checks BOTH players moved, both Start over buttons, Review ready with the match grouped, and Start over clearing the groups (130 checks); negative-tested — with the old handler the move leaves the match split and Review blocked. No migration.

Deploy: code only.

## 212.59.261027 — Phase 4 complete: Stableford and stroke play in the one-step Create flow — every format is one step

Owner (Oct 24–25): a game is created only when fully set up. With Stableford and stroke play, every club format now goes through the one-step flow (scramble 212.41, the four-ball family 212.43, match play and skins 212.58). Ryder Cup sessions keep the old flow.

**Create:** Course → Game → Players → Groups → Review. The step is named for what it holds — "Teams" when there are teams to pick, "Matchups" for individual match play, "Groups" for Stableford, stroke play and individual skins. Groups are optional (the Players hint says so: "4 players — groups are optional"); Review shows "Groups: Not set (optional)" or "2 groups"; flights work as before (the shared payload). Create game → one call → the scorecard. The step bar has five steps for every format from the start (the default format, Stableford, is one-step), so it never changes shape mid-way.
Tests: the Create walkthrough gains two shapes (Stableford, stroke play — 16 checks) and reads the step names (Teams / Matchups / Groups); 125 checks in all. No migration.

Deploy: code only.

## 212.58.261027 — Phase 4 part 2: match play and skins in the one-step Create flow

Owner (Oct 24–25): a game is created only when fully set up. Scramble (212.41) and the four-ball family (212.43) went first; now MATCH PLAY (individual and team) and SKINS (individual and team 1:1) — the 2 v 2 team skins variant is reached through four-ball and was already one-step. Ryder Cup sessions keep the old flow.

**Create:** Course → Game → Players → Teams → Review. On the Game step the "Team match" / "Team skins" switch stays, but team names and colours move to the Teams step (as for four-ball). The Players hint reads the count ("4 players make 2 matches"; "— one player has a bye"; "two teams of 2, with 2 matches"; an odd team field: "can't split into two equal teams"). **The Teams step**, by shape: individual match play — the matchups builder (the scorecard's own 1 v 1 builder, "Build balanced matches", every change into the draft), then groups (optional); team match play and team skins — the compact team card (teams, names, colours, Balance by handicap, Start over), the matchups across the teams, then groups; individual skins — groups only. **Review** is blocked until everyone is on a team (team variants), the teams are the same size, every player is paired (an odd individual field: one bye) and each matchup pairs one player from each team; it shows Teams, Matchups ("2 matches") and Groups ("Not set (optional)"). Create game → one call (create_game_complete, with the matchups and team places) → the scorecard. A draft left mid-way comes back with its matchups.
Tests: the Create walkthrough gains 28 checks across the three shapes (individual match, team match, individual skins): step bar, the Game step names teams later, the Players hint, the right builders on the Teams step, Review blocked before teams / before matchups, Review ready, Create enabled, one call with 2 matchups and 4 team places (team match) or none. Its click helper now prefers an exact label ("Team" the format vs the "Teams" step). lib/one-step-create: matchLineupProblem, the hint. No migration.

Deploy: code only.

## 212.57.261027 — Permission audit, part 4: posted rounds and profile flags match the app (migrations 0228, 0229)

Owner (Oct 26): "its fine do a full audit — lets do this the right way". Part 4 (outside games) begins with the table rules.

**The inventory.** Outside the game tables only seven tables take direct writes from a signed-in member: clubs (admins), membership and invites (admins; a creator seats themselves), the course library (any member adds; admins change), Ryder Cup competitions (their creator or a club admin), the activity log (by meaning, already reviewed) — all matching their screens — and ROUNDS and HOLES. Everything else (profiles, Money, tee times, badges, notifications, devices) is written through functions only.
**Found.** The rounds and holes rules let a player update ANY column of their own rounds and holes directly — the hole-by-hole scores, totals and course handicap of rounds posted from games, which feed their stats, trend and handicap index. The app never offers that: a posted round is corrected through its game (212.54), and the app's only direct writes to a player's own rounds are logging one (a gross score), soft-deleting one and saving its analysis.
**Migration 0228:** for a round with a game behind it, its player may change deleted_at and ai_analysis directly and nothing else, may not delete it, and its holes are read-only to them. Personal rounds (no game) are untouched. Club admins keep Manage's round editing (a round's handicap). Server paths — posting at the end, the organizer's re-post, personal-round saves — are unaffected: the two rules run as the writer (SECURITY INVOKER), which is how a direct write by the signed-in role is told apart from a server function. System admins and maintenance unaffected.
Tests: ci/assert-posted-rounds.sql — 13 attempts (totals, handicap, date, soft-delete, analysis, delete, hole change/add/delete, personal round change/delete, club admin's handicap edit, club admin's hole edit) plus the server path (end the game → round posted; correction + re-post → round updated). Negative-tested — without 0228 it lists the seven gaps by name. (The first run caught that the rules, written as the database owner, never saw a direct write — hence INVOKER.) Full migration chain + every assertion pass on local PostgreSQL 16.

**Part 4b — profiles (migration 0229).** The profile guard already locks identity, the owner / admin flags, banned and the account status (checked: a member can't give themselves admin), and the editor's own fields stay the member's. Two flags were open: is_test (a member could mark themselves a test account and drop out of stats and club reports) and deactivated (a system admin's action in Manage; the join page lets a member reactivate themselves). Now is_test changes only through a system admin; deactivated can be set only by a system admin (anyone may clear their own). Test: ci/assert-profile-flags.sql (7 attempts; negative-tested).
**Part 4, the rest — consistent with the screens, no change:** clubs (admins), membership and invites (admins; a creator seats themselves), the course library (members add; admins change), Ryder Cup competitions (creator or club admin), Money (any member adds an expense; only its creator or a club admin changes it; settlements by the parties), tee times (creator or club admin; RSVPs by members), notifications (create_notification: a game's organizer to its players, a club admin to members, oneself; send_nudge: same club, labelled, 140 characters, one per 6 hours per recipient), events and guests. The notify_* functions are triggers and can't be called directly.

**Deploy: apply migrations 0228 and 0229 to production FIRST** (after 0218–0227; SQL editor, "Run without RLS"), then staging, then the pull request. Then check_what_is_applied.sql: 0185–0229 all "applied".

## 212.56.261027 — Permission audit, part 3: who may change a score matches the app (migration 0227)

Owner (Oct 27): in a team match a non-scorer "can also enter their own stats for a team match when they are not a scorer — like FW hit, putts, S / penalty etc. They cannot edit their score."

**Found.** The app locks each row's score to whoever OWNS it, but the server only checked table rules: a non-scorer's own score sent through the app's own scoring route was ACCEPTED (and so was the organizer's save of a score another group's scorer owned, and a group member's score for a guest in a group with a scorer). Reachable only by using one's own login outside the app.
**Migration 0227** makes the server match the app's ownership exactly: a change to a row's scores (or clock) is accepted only from the row's owner — the organizer while they hold the group (0226); else the group's scorer; else the whole-game scorer; else the player keeps their own card (a guest's card: the players in the guest's group; and the organizer). Stats — putts, fairways, penalties, sand — stay the player's own, as before. Scramble and alternate shot are untouched (their team-score functions already decide who may score a team); an ended game is decided by 0222/0225. The refusal says who keeps score ("Sam Lee is keeping score for this group — only they can change its scores. You can still enter your own stats"; the organizer is told to take over the group's scoring first).
No app change: the app never sends a score for a row it doesn't own.
Tests: ci/assert-score-owner.sql — 21 attempts across four situations (a group scorer; the organizer's hold; a whole-game scorer; nobody keeping score): non-scorer's own score refused, own stats allowed by both routes, the scorer scores the group and its guest, the organizer can't override another scorer (and can when holding the group), the whole-game scorer scores everyone, guests only by their group; negative-tested — without 0227 it lists the four gaps by name. Full migration chain + every assertion pass on local PostgreSQL 16.
**Part 2 (direct saves to the other game tables) — already consistent, now pinned** in ci/assert-game-permissions.sql: games are written directly by the creator only; team scores and side contests have no direct writes at all (functions only); a new permissive write rule on those tables fails the test until reviewed.

**Deploy: apply migration 0227 to production FIRST** (after 0218–0226; SQL editor, "Run without RLS"), then staging, then the pull request. Then check_what_is_applied.sql: 0185–0227 all "applied".

## 212.55.261027 — The organizer can take over any group's scoring during the round, and hand it back (migration 0226)

Owner (Oct 27): "allow the organizer to jump in and take over scoring, the existing scorer is notified but doesn't need to give permission, and then I can hand the scoring back to anyone else who is a member of the group and chooses to score". (Option 1; option 2 — correcting after the end — shipped in 212.54.)

**On the Group Card** (any group, during the round): the organizer sees "Take over scoring for Group N" — a confirmation names the current scorer ("… they'll be told, no permission needed"). The group's scorer steps down and gets a notification ("<organizer> took over scoring for Group N … You can still enter your own stats"). While the organizer holds it: they keep every score in that group; its players can still enter their own stats; nobody in the group is offered "I'll keep score" (and the server refuses it) — the group's players see "The organizer is keeping score for Group N"; the group buttons show it as covered and the card names "<organizer> (organizer)". "Hand back scoring" (with a confirmation) notifies the group's players that the card is open; anyone in the group can then tap "I'll keep score". One scorer per group at a time throughout. Not on an ended game (the organizer corrects scores directly then).
**Migration 0226:** games.organizer_scoring_groups (the groups the organizer holds — a group's scorer is otherwise a player IN it, and the organizer usually isn't); organizer_take_group_scoring / organizer_release_group_scoring — organizer only; claim_group_marker refuses while the organizer holds the group.
Tests: ci/assert-organizer-group-scoring.sql — a player can't take over or hand back; the organizer takes over (once, even if asked twice); the old scorer steps down and is told exactly once (non-scorers aren't); the old scorer can't grab it back; the organizer's score saves; the hand-back tells both players; a member then keeps score; not on an ended game; negative-tested (without the hold the old scorer grabs it back). The score-recovery test runs the REAL lock check: in a held group the organizer may save its rows and its own players may not. Register: both functions classified (organizer). Guard: the take-over / hand-back controls and the held-group lock. Full migration chain + every assertion pass on local PostgreSQL 16; permission contract updated.

**Deploy: apply migration 0226 to production FIRST** (after 0218–0225; SQL editor, "Run without RLS"), then staging, then the pull request. Then check_what_is_applied.sql: 0185–0226 all "applied".

## 212.54.261027 — After the game ends, the organizer can correct any score; rounds re-post when they confirm (migration 0225)

Owner (Oct 27): "once the game has ended and marked as such, the ability to edit any score and logged accordingly, with the changes flowing through" — and the posted rounds should "Ask the organizer to confirm the re-post". (Taking over a group's scoring mid-round — the owner's option 1 — follows next.)

**How it worked before.** The server already let the organizer save any score — but the app had no way to: scores are locked to whoever keeps that group's card; "Take over scoring" doesn't override a group's own scorer, and "I'll keep score" only works for your own group. And once a game ENDED, the 0222 late-score rule refused every score, the organizer's included.
**Now.** On an ended game the organizer sees "Need to fix a score? → ✎ Correct scores". While it's on, the Group Card unlocks for the organizer only — any group, any player, finished groups too, scramble and alternate-shot team scores as well — and "Done correcting" locks it again. Every hole changed is logged automatically (score audit: old, new, who, when — Manage Game → Score history). After a correction, a prompt appears: "Scores were corrected after the game ended … Re-post rounds" — on confirmation every player's posted round is updated from the corrected card (an update, never a duplicate). Posted Money winnings already show their own "Review & re-post" when a score changes.
**Migration 0225:** the late-score rule exempts the game's ORGANIZER (and system admins); a score from any other phone is still refused (BN164); setup on an ended game stays locked for everyone. games.scores_corrected_at (set when an ended game's scores change; maintenance doesn't) and games.rounds_reposted_at; repost_game_rounds(game) — organizer only, ended games only.
Tests: ci/assert-setup-locks.sql — a PLAYER's late scores refused (own card through the app's route, scramble team score); the organizer corrects a card, a card with stats and a scramble team score; logged under the organizer; noted for the re-post; a player can't re-post; the organizer's re-post is recorded after the correction; negative-tested (without the exemption the organizer is refused). Register: repost_game_rounds classified (organizer). Guard: the correction controls — organizer only, after the end, card unlocked only while correcting, re-post behind its confirmation. The score-recovery test runs the REAL lock check with the switch: while correcting, a row another scorer owns is open to the organizer; switched off, it's locked again (the first CI run caught that its sandbox didn't yet supply the switch). Full migration chain + every assertion pass on local PostgreSQL 16; permission contract updated (repost_game_rounds).

**Deploy: apply migration 0225 to production FIRST** (after 0218–0224; SQL editor, "Run without RLS"), then staging, then the pull request. Then check_what_is_applied.sql: 0185–0225 all "applied".

## 212.53.261027 — Permission audit, part 1: what a player can change on player rows matches the app (migration 0224)

Owner (Oct 26): "its fine do a full audit — lets do this the right way". Part 1 of 4 (players' own rows; then every direct save by role, the scoring roles, and clubs / membership / Money / tee times / profiles).

**Found.** Table rules let more than any screen offers: "edit own scores" let a player change ANY column of their own row — handicap index, course handicap, tee, team, group, no-show, name, bets, even the guest flag; "join as self" accepted any values; a player could delete their own row; group players could add and remove guests. Reachable only by using one's own login outside the app; the handicap part moves net results (and so bets).
**The app lets a non-organizer do exactly four things to player rows:** join a game (own row: name, avatar, the game's tee, an empty card); fill in their OWN handicap and tee while it is missing ("Complete your setup") — never change one already set; score their card and correct their group's entries incl. guests (the owner's "player card" decision); set their avatar and take the scoring roles. **Migration 0224** makes the server match: anyone other than the organizer (or a system admin) can change scoring fields only, plus those two app flows; handicaps, tees, teams, groups, no-show, flights, names, bets and guests are the organizer's; only the organizer removes a player or guest. Deleting a WHOLE game (every player — e.g. a Ryder Cup session) stays with the functions that do it and their own checks. Maintenance without a signed-in caller is unaffected. (0221/0222 are WHEN; this is WHO.)
Checked the app side: its only direct player-row saves by non-organizers are joining and completing a missing setup — both allowed and tested; the scoring views' team picker is unused; the organizer console was already organizer-only.
Tests: ci/assert-game-permissions.sql gains 10 direct saves (player vs organizer) + "complete your setup" + joining with/without pre-set fields; negative-tested — without 0224 it lists every gap by name. Three older tests brought in line, each explained: the 0194 guest-scoring test now writes a scoring field (scored_by) rather than a guest's handicap; the policy-review test expects only the organizer to add or remove guests; a scramble test's setup step drops its leftover signed-in identity. Full migration chain + every assertion pass on local PostgreSQL 16.

**Deploy: apply migration 0224 to production FIRST** (after 0218–0223; SQL editor, "Run without RLS"), then staging, then the pull request. Then check_what_is_applied.sql: 0185–0224 all "applied".

## 212.52.261027 — Game setup is the organizer's (and system admins'), not every club admin's; who-can-do-what is tested (migration 0223)

Owner (Oct 26): "a club admin can save a game's teams and groups even if they are not a part of the game? that doesn't make sense" → "Organizer + system admins only (match the app)", and "audit 'who can do what' and add it to the sync check".

**The audit.** The app shows Manage Game only to the game's creator. Six server rules also let ANY active admin of the game's club act — even one not playing and not the creator — though no screen ever offered it: saving the line-up (apply_game_structure), saving groups (set_tee_groups), sending a draft (announce_game_players — added in 0219 on the same pattern), turning a player's bets on or off (set_player_bets), side contests (is_game_organizer: create, change, delete, void), and seeing a draft (drafts_private). Everything else that changes a game already allowed the creator only; the tee-time link checks the TEE TIME's admin, as it should; club admins keep their club powers (members, the Money tab, tee times).
**Migration 0223:** all six become organizer + system admin — each function its current definition with only the club-admin condition swapped, messages corrected. Drafts are now "only I see it until I send it" (plus system admins).
**Who-can-do-what test** (ci/assert-game-permissions.sql): six people — the organizer, a player in the game, a club admin not in it, a club member not in it, an outsider, a system admin — try 13 game actions (line-up, groups, send a draft, see a draft, bets, side contests, move a group, share, date, course, reset, end, delete); each attempt rolled back. The organizer can do all 13 (so every action is valid); nobody else can, except system admins for the six setup rules (they use their admin tools for the rest). A REGISTER classifies every game function signed-in members can call (organizer, system-admin tools, scoring roles, read-only, the Money tab) — a new one fails the test until it is classified. Negative-tested: the old club-admin rules put back are caught by name; an unclassified new function is caught. The app ↔ server sync check now also pins the app's side (Manage Game for the creator only).
An older test updated to the decision: the 0220 draft test now expects a club admin (not the organizer) NOT to see a draft. Permission and core-rules contracts updated deliberately. Full migration chain + every assertion pass on local PostgreSQL 16.

**Deploy: apply migration 0223 to production FIRST** (after 0218–0222; SQL editor, "Run without RLS"), then staging, then the pull request. Then check_what_is_applied.sql: 0185–0223 all "applied".

## 212.51.261026 — No more silent saves: refused changes say why, edits confirm, and the add-player forms show the reason

Owner (Oct 26, testing staging): "Once the game has started, I can still enter details for a guest, including their handicap. It doesn't look like it saved successfully, there is no message either way."

**What was wrong.** In a team contest once scoring has started (or an ended game) adding players isn't allowed — but Manage Game → Players still showed the add-guest form: you could type a name and handicap, the "+ Add guest" button was disabled yet LOOKED enabled (its fading only checked that the boxes were filled), and its reason was a hover tooltip, which phones never show. Separately, about a dozen setup saves on the game screen ignored the server's answer — harmless while the server never said no, but since 0221/0222 it refuses what the app refuses, so a refusal became a silent failure, and a success gave no sign either (e.g. a guest's handicap edit just reloaded).
**Fixed:** when adding players isn't allowed, Manage Game → Players shows the reason in place of the forms (e.g. "Players cannot be added after scoring starts in a match or team contest…"; on an ended game, reopen first); when it is allowed (an individual format mid-round, after a confirmation) the forms work as before, and the button looks disabled when it is. Every setup save now reports the server's answer through one routine — a refusal shows the server's own reason ("Couldn't save Guest's handicap — This game has ended. Reopen it before editing this setting.") — and handicap, course-handicap, tee, allowance and reopen edits confirm when they land ("Guest's handicap saved (index 14, course handicap 16)."): completing setup, handicaps, manual course handicaps, tees, no-show, removing a player (stops at the first refusal), renaming, the date's rename, the allowance, reopening, clearing scramble groups.
Checked on a real database first: mid-round, adding a guest is refused in a four-ball and saved in a Stableford; a guest's handicap edit saves in both — so the server was right; the screen had to say so.
Tests: lib/add-player-blocked (4) — four-ball underway and an ended game show the reason, Stableford underway and four-ball before scoring show the forms; negative-tested with the old always-show form. Guard: ci/check_setup_saves_report.py — 11 setup saves must report the server's answer; negative-tested with the handicap save ignoring it again.

No migration. Deploy: code only (0222 from 212.49 still needed if not yet applied).

## 212.50.261026 — The phone's late-score handling, tested

Owner (Oct 26): "have you done automated testing on 212.49? if not do it". 212.49 had the full CI, every database test from a fresh database, and preflight — but the PHONE's reaction to a refused late score was only checked as present in the code, not run. Now it is: the decisions moved verbatim into lib/late-scores (which code means "the game has ended", the one-time message, hold while ended / resume on reopen, which formats keep team scores) and the game screen applies them on all three scoring routes (player scores, scramble and alternate-shot team scores).
Tests: lib/late-scores (10) — including that the phone listens for exactly the code the server raises (read from migration 0222), negative-tested by changing the phone's code; a reset (BN163), a setup lock and success are not mistaken for it; the message's wording (one / several / unknown); hold while ended, resume once reopened. The app ↔ server sync check now also requires all three scoring routes to use lib/late-scores.
End to end: ci/test-game-score-recovery.cjs runs the game screen's REAL score-sending code (lifted from components/tournaments.tsx) with the real lib/late-scores loaded — a late-score scenario beside the reset one: a BN164 refusal is not reported as saved, the queue holds, the player is told, and (unlike a reset) the kept scores stay recoverable. Negative-tested by removing the handling from the sending code. (The first CI run caught that this sandbox didn't yet supply the helper.)
No behaviour change. No migration. Deploy: code only (0222 from 212.49 is still needed if not yet applied).

## 212.49.261026 — The server enforces every setup rule the app does; late scores after the end are refused (migration 0222)

Owner (Oct 26): "doesn't it make sense to do a full inventory of offline functionality and ensure that the server side is handled similarly in order to keep the app in sync?" — then "Yes, enforce rules 1–11" and, for scores that arrive after a game has ended, "Refuse them: once ended, scores only change if the organizer reopens".

**The inventory.** The app's setup rules live in lib/game-setup-policy; the server enforced only some (the Ryder Cup contract, scoring-device and reset-version checks, team changes inside the structure step, groups since 0221). Only SCORING works offline (a durable queue, already guarded by the scoring device, reset version and validation); setup changes are online only and fail cleanly. The server is the safety net for any phone with an out-of-date picture — offline, a second phone, an old app version.
**Migration 0222** — the server refuses every "block" rule (the "confirm" rules — handicap, tee, allowance, scoring mode, skins ties, side games, no-show, a format change within its family — are allowed changes and stay allowed): 1 an ENDED game can't be changed (its name, sharing and date excepted) — reopen it first; 2 course and 3 number of holes locked once scoring starts; 4 format only within its family; 5/6 the team structure (skins style, individual/team match) locked — team names and colours can always change; 7 matchups and 8 foursomes (incl. first drivers and trifecta singles) locked; 9 no players added mid-round in match/team formats; 10 no removing a player with scores (No-show / Out instead); 11 no team change for a scored player. Exempt: maintenance without a signed-in caller, and system admins (the admin tools). Clearing scores (a reset, which reopens) and deleting a whole game stay possible.
**Late scores (BN164):** a score or stat for an ENDED game — a phone that was offline when the organizer ended it — is refused with its own code. The phone stops sending for that game (no endless retries), KEEPS the scores, and says once: "This game has ended, so N scores on this phone weren't added. They're kept on this phone — ask the organizer to reopen the game if they should count." Reopening resumes sending. Both player scores and scramble / alternate-shot team scores.
**Keeping them in sync:** ci/check_setup_rules_server_parity.py reads the app's rules and fails CI if any action the app can block (14 today) has no server test — negative-tested with a pretend new rule — and guards the phone's BN164 handling.
Tests: ci/assert-setup-locks.sql — each rule refused at the server; confirm-level changes, team names, within-family formats, resets and whole-game deletes allowed; late scores refused through the app's own routes (save_game_score_bundle, save_scramble_score_fenced); negative-tested. Two older tests relied on things the app forbids and were brought in line: the 0184 line-up test now saves the foursomes before a player scores (as a real round would); the policy-review test now expects the organizer to REOPEN an ended game before removing a guest (rule 1). Full migration chain + every assertion pass on local PostgreSQL 16; permission contract updated (two helpers, callable by no one).

**Deploy: apply migration 0222 to production FIRST** (after 0218–0221; SQL editor, "Run without RLS"), then staging, then the pull request. Then check_what_is_applied.sql: 0185–0222 all "applied".

## 212.48.261026 — Names listed alphabetically by first name, everywhere players are picked

Owner (Oct 26): "when picking teams, rather than a random order, make it alphabetical by name so it is easier to find on the screen … even when you list names, make it alphabetical from first name."

ONE rule, lib/names (sortByName / byName — by the name as written, so first name first, ignoring capitals and accents), for every setup list of players to pick from: the **team card** (Create and Manage Game), the **scramble Teams** list, the **groups list** for individual formats (single players; groups and matches keep their order), the **matchup pickers** (match play, 1:1 skins), the 2 v 2 **"+ Add player"** picker, **alternate shot's first-driver** picker, and the team-group slot picker. Create's club roster (Players step) and Manage Game's Players list were already alphabetical — they now use the same rule. Alphabetical order is fixed, so nobody moves when given a team.
Also: the balance note ("Team 1 54 · Team 2 53") clears when the teams are renamed, instead of naming the old teams.
Guard: ci/check_alphabetical_pickers.py (11 setup lists use lib/names). Tests: lib/names (3) — first name, capitals and accents ignored, ties by the rest of the name; lib/compact-team-editor — alphabetical, and assigning never moves anyone. An older guard that pinned the Players list's sort text now pins the shared rule.

No migration. Deploy: code only (0221 from 212.47 is still needed if not yet applied).

## 212.47.261026 — Players keep their place; field sizes said up front; the server freezes groups once scoring starts (migration 0221)

Owner (Oct 26):
**Team card: players keep their place.** Giving someone a team no longer moves them to the bottom — the list stays in the order players were added (it used to sort "no team yet" first). Test: assigning or clearing never moves anyone.
**Four-ball with 6 players (owner: "keep it strict").** Four-ball and trifecta work with 4, 7, 8, 11, 12, 15 or 16 players (equal even teams, or one more on one side for the single 2 v 1 group); alternate shot with 4, 8, 12 or 16. Now said UP FRONT on the Players step — e.g. "Four-ball works with 4, 7, 8, 11, 12, 15 or 16 players — you have 6: add 1 player (for 7) or remove 2 (for 4)"; when it works: "7 players: teams of 4 and 3 — 2 groups, one of them 2 v 1 (…)" — and the locked Groups note says the same. lib/grouping fieldFitsTeamGroups / teamGroupFieldSizes (the one rule).
**Migration 0221 — group changes after scoring, refused at the server** (owner: yes). One trigger on game_players covers every route that changes a group (set_tee_group, set_tee_groups, apply_game_structure, direct updates) and mirrors the app's setup rule: a scramble or alternate-shot game whose team scoring has started — groups frozen; a player with scores, or whose group has finished and locked — their group frozen; nobody moved into a finished, locked group. A late player with no scores can still join an active group; resetting the scores frees everything; maintenance work without a signed-in caller is unaffected. Before this the server refused team changes for scored players but not group changes. Test: ci/assert-group-changes-after-scores.sql (through the app's own group functions, with the organizer's scoring device as in the app); negative-tested (without the trigger a scored player is moved). Full migration chain + every assertion pass on local PostgreSQL 16; the permission contract is unchanged (the trigger function is callable by no one).

**Deploy: apply migration 0221 to production FIRST** (after 0218–0220; SQL editor, "Run without RLS"), then staging, then the pull request. Then check_what_is_applied.sql: 0185–0221 all "applied".

## 212.46.261025 — Manage Game → Groups → Start over (only before scores)

Owner (Oct 26): Start over for the groups in Manage Game too, "subject to no scores being entered. If there are scores entered then you need to tell the organizer to reset scores and then can redo groups."

**Start over** sits beside "Build balanced matchups / Build even groups" (team formats) and "Randomize groups" (individual formats) once any groups exist. Before scores: it confirms, then clears every group — and a team format's 2 v 2 foursomes with them — in ONE transaction (apply_game_structure); the teams stay as they are. After scores (or once a group has finished and locked): tapping it explains instead — "Scores have been entered, so the groups can't be cleared. Reset the scores first (Game → Reset scores), then you can redo the groups." One rule decides it: the setup policy's new "clear_groups" action (lib/game-setup-policy), used by the button and re-checked by the handler.
Checked on a real database: clearing a four-ball's groups leaves 0 players grouped, 0 foursomes, and every team choice kept.
Tests: lib/groups-start-over (6) — allowed before scores; blocked with scores or a locked group, with the reset-scores wording; the button clears when allowed and only explains when blocked.
Note: the server refuses TEAM changes for a player with scores, but group changes are protected by the app's setup rules only (as for every group action today) — raised with the owner.

No migration. Deploy: code only.

## 212.45.261025 — The Teams step: the organizer picks; names saved on Save; start over; odd numbers play one 2 v 1

Owner feedback (Oct 26) on the four-ball / trifecta / alternate shot Teams step, all addressed:

**No team tile on the Game step** for one-step formats ("Create Team Names (Red vs Blue)", trifecta's "Two teams") — the teams are named and picked on the Teams step.
**Renaming works:** "✎ Edit names" → two boxes → **Save names** (or Cancel). Before, typing went straight into the live name, so every player's button changed as you typed and an emptied name snapped back to "Team 1". Now nothing changes until Save; a blank keeps the old name. The colour dot still sits beside each name.
**Nothing is picked by default:** every player starts with "no team yet"; **Balance by handicap** is an option. **Groups stay locked** until every player is on a team and the teams fit (the note shows where things stand, e.g. "now Team 1 4 v Team 2 3"). Once open, nothing is pre-picked: **Build balanced matchups** (like plays like) or **Build even groups** (a similar mix in each) — both, as Manage Game offers — or pick by hand.
**Start over** for the teams (clears teams and groups) and for the groups (clears the groups), shown once there's something to clear.
**Odd numbers (owner's rule):** four-ball and trifecta with an odd field play **one 2 v 1 group, scored as before** — four-ball: the lone player's ball against the pair's best ball; trifecta: the lone player plays a single against each opponent. Teams must split 4 v 3, 6 v 5 … (the bigger side even) — 9 players (5 v 4) can't make one 2 v 1 group and is told so. **Alternate shot needs an even number** (a side shares one ball between two), and Review says so first. ONE rule, lib/grouping (allowsOneShortGroup, teamSizesFitGroups, groupShapesOk), used by the Teams step, the Groups editor's READY badges ("✓ READY · 2 v 1"), Review and Manage Game's checklist; both group builders gained the option to make the leftover two-and-one the last group, used in Create and Manage Game. The server already stored a 2 v 1 group (checked on a real database: 7 players, groups 2v2 and 2v1).
"Build balanced matchups"' trifecta ordering (strong v strong singles) moved verbatim into lib/structure-ops (balancedMatchupFoursomes) so Create and Manage Game share it.
Tests: lib/odd-field (23) — which splits open the groups, which group shapes are ready, the builders with and without the option, Review for 7 in four-ball, trifecta and alternate shot. lib/one-step-walkthrough (79) — nothing picked on arrival, groups locked, Balance opens them, Start over (teams and groups), Edit names → Save (an emptied name stays empty, buttons unchanged until Save), and 7 players: four-ball balances 4 v 3, builds one 2 v 2 and one 2 v 1 (both READY), Review "2 groups — one plays 2 v 1", one create call with those groups; alternate shot stays locked and Review says it needs an even number. lib/compact-team-editor (11).

No migration. Deploy: code only.

## 212.44.261025 — The compact team card: teams named and coloured on the Teams step

Owner (Oct 26): compared the full team editor with a compact mock-up as whole screens and chose the compact card — "but want the ability to name the teams … and to pick colors".

**The compact team card** (components/game/compact-team-editor): one row per player — name, playing handicap, the two team buttons in the teams' colours (tap again to clear) — under a summary of each side: its **colour dot** (the app's own picker, TeamColourDot: five colours, picking the other side's swaps them), its **name** (type to rename), and its **player count and total playing handicap**, so balance is visible at a glance; "Balance by handicap" sits under it. A four-ball Teams step drops from about 3.3 phone screens to about 1.8. Used in **Create's Teams step** and **Manage Game's Teams tab** (the same save handlers; a player with scores can't change team — the setup policy's own rule).
**Teams are named once, where the players are:** for four-ball, trifecta and alternate shot the Game step no longer asks for team names and colours — it says they're chosen on the Teams step; their descriptions no longer say "after creating". Ryder Cup sessions keep the Cup's names; team match play and team skins keep today's naming until they move to one-step.
**Found by the guards and fixed:** text on a selected team button wasn't readable enough on red, purple, navy or maroon fills (3.77:1 on red at 12px) — it now uses lib/game-colors readableInk (dark or light, whichever contrasts more) at 14px bold, and a test checks all 14 team colours reach 3:1 (worst 4.29:1); the team-name box uses the shared field style (inputStyle); the Balance button meets the 24px tap floor. Two layout guards that pinned the old full editor in Manage Game now pin the compact card with Manage Game's own handlers.
Tests: lib/compact-team-editor (8): side totals, unassigned first, assign and clear, a scored player locked, renaming keeps the other side, readable text on every team colour, the WCAG formula. lib/one-step-walkthrough (49): the Game step points to the Teams step; a name and colour chosen on the Teams step are what Create game saves. Design gallery: 15a (today) v 15b (compact).

No migration. Deploy: code only.

## 212.43.261025 — One-step game creation, phase 4 (part 1): four-ball, trifecta and alternate shot are created in one step

The four-ball family joins scramble in the one-step Create flow (owner, Oct 25: "keep going"). Team match play and team skins follow next; every other format is unchanged.

**Create for four-ball, trifecta and alternate shot:** Course → Game → Players → **Teams** → Review. The Teams step opens on **teams balanced by handicap and balanced 2 v 2 groups** — the SAME editors Manage Game uses (the team editor and "Groups · build each match"), working on the phone's draft: re-balance, move anyone, rename the teams, choose alternate shot's first drivers and trifecta's singles, all before anything is saved. A player with no handicap can't be balanced — the step says so and leaves the teams to set by hand. If players change, the teams and groups are suggested afresh (and it says so). The line-up survives the app closing (Resume). **Review** names any gap — someone not on a team or in a group, a group that isn't two a side, or (alternate shot) a side without a first driver — and Create game stays disabled until it's fixed; Save draft is always available. **Create game** saves the game, players, teams, groups and 2 v 2 foursomes in ONE call (create_game_complete, 0219) and goes straight to the scorecard. Inside Create the team editor has no "Organizer · Manage game" header.
**One set of rules:** each draft change uses the same shared rules as Manage Game's save handlers — team balancing (lib/balance-teams), balanced groups and slot moves (lib/grouping), the foursomes derived from groups, first drivers and trifecta singles (lib/structure-ops). The server side was proven in phase 2: one call stores exactly what the two steps store for all three formats.
Tests: lib/one-step-walkthrough now drives four-ball, trifecta and alternate shot through the real Create screen (43 checks): one Teams step, Manage Game's own team editor, Review "Team 1 4 · Team 2 4 · 2 groups of 2 v 2", alternate shot blocked until the first drivers are chosen (through the same picker) and then ready, and ONE create call carrying 8 players, 8 team places, 8 group places and two 2 v 2 foursomes (with the first drivers), landing on the scorecard. Create-state inventory: the new draft line-up is classified (saved in the local draft).

No migration. Deploy: code only.

## 212.42.261025 — No personal scorecard in a scramble (or any format where you don't play your own ball)

Owner (Oct 25, staging games 376421 and 672063): at the bottom of a scramble's Results tab sat the player's own scorecard — empty, because in a scramble the team posts one score per hole and players record none (lib/round-rules). The screen hid it only for alternate shot, with its own "not alternate shot" check, so scramble was missed.

**The rule (owner):** no individual scorecard in any format where you don't play your own ball — scramble (the team's ball) and alternate shot (the pair's). A shamble, if added (best drive, then your own ball), keeps individual cards. The personal scorecard and "Share my scorecard" now follow the app's ONE rule for this, lib/round-rules countsForIndividualStats (which already excluded both formats from individual stats), instead of a screen-local check. Everything else a scramble shows is the team's: Results (the team leaderboard), the Group Card, the live page (one card per team since 212.1) and the recap.
Guard: ci/check_shared_ball_scorecards.py (the rule excludes both formats; the card and the share button use it; no screen-local copy) — negative-tested with the old check put back.
Also in the staging trial: the scoring script now marks "scoring started" as the app's own scramble scoring does — in a scramble that mark is what locks teams and settings, since players' own cards stay empty.

No migration. Deploy: code only.

## 212.41.261025 — One-step game creation, phase 3: scramble is created in one step; drafts are private (migration 0220)

The first visible piece of the one-step Create flow (owner, Oct 24–25). **Scramble** is set up end to end inside Create and saved in one server step (create_game_complete, 0219); every other format keeps today's flow, with one change below.

**Create, for every format (owner's wording):** the steps are **Course → Game → Players → Review** — Course (course, default tee, then the date; **no "your handicap index"** — a game always has several players, and all handicaps can be updated together in Manage Game), Game (the **game name**, moved here, then the format), Players, Review. Format now comes BEFORE Players for every format, so the steps never reorder mid-way. A step is ticked only once you have visited it (Format and Players used to show ✓ before you'd seen them). Back and Continue follow the step bar (they had the old order built in — Continue skipped Format).
**Scramble, one step:** a live hint on Players ("8 players can play as 4 teams of 2 or 2 teams of 4. You'll pick on the Teams step"; amber when the count can't work); a **Teams** step inside Create that opens on suggested teams balanced by handicap — the same Teams screen Manage Game uses, with Groups on the course; it says so when players change and the teams are suggested afresh; the teams survive the app closing (Resume brings them back exactly). **Review** shows everything that will be saved, names any gap, and has **Cancel · Save draft · Create game**. **Create game** saves the game, players, teams and groups at once, tells each player their team and group, and goes straight to the scorecard. Ryder Cup sessions keep today's flow for now.
**Save draft:** the game is saved but private — **only its organizer and the club's admins can see it** — with no notification, no share link and nothing in the club's activity feed. Manage Game shows a DRAFT banner; **Send to players** tells everyone at once and makes it an ordinary game. Join-by-code refuses a draft.
**Sharing lives in Manage Game → Review:** the **line-up link** and the **live scores link** (one switch: on makes both, Stop sharing turns both off), above the line-up card. Nothing can be shared before the game is created and sent; the old sharing card on the Game tab moved here.

**Migration 0220 — drafts are private at the SERVER** (owner: "let's do this the right way"). One RESTRICTIVE rule each on games, game_players, game_alt_shot_scores and game_contests, for signed-in members: while a game is a draft, only its organizer, club admins and system admins can read or change anything about it. Restrictive rules are ANDed with the existing ones, so nothing about announced games changes (before this, any club member could read any club game). set_game_share refuses a draft. Signed-out visitors have no access to these tables at all. Test: ci/assert-draft-private.sql — organizer and admins see it; its own players, clubmates and outsiders can't see, join or edit it; it can't be shared; once sent it is an ordinary game. Negative-tested (without the rule a player sees the draft). The core access-rules contract (ci/assert-core-rls-live.sql) records the two new core-table rules deliberately; the security contract is updated. Full migration chain + every assertion pass on local PostgreSQL 16.

**Proof of the flow:** lib/one-step-walkthrough drives the REAL Create screen with a sample club (22 checks): the step order, the hint, the Teams step, Review, Create game makes ONE create_game_complete call (game, 8 players, teams, group places) and lands on the scorecard, nothing shared, the activity feed told; Save draft tells no one, shares nothing, writes no activity, opens Manage Game; a draft's teams survive closing and Resume. lib/draft-games (11): who sees drafts, the banner, the share links. Create's records are built by the same code for both flows (buildCreatePayload / buildCreateRows, moved verbatim). Found and fixed on the way: the test DOM had no bare localStorage, so local drafts never saved in tests; team balancing in Create now uses the shared handicap rule (chBasis — a manual course handicap counts); the walkthrough and draft tests were missing from CI's list. Older checks updated to the owner's decisions (sharing in Review, the step list, the draft step names, the classified Create state), each still guarding the new behaviour. Design gallery: 14a–14g.

**Deploy: apply migration 0220 to production FIRST** (after 0219; SQL editor, "Run without RLS"), then staging, then the pull request. Then check_what_is_applied.sql: 0185–0220 all "applied".

## 212.40.261025 — One-step game creation, phase 2: the single server step (migration 0219)

The server step the one-step Create flow will use (owner, Oct 25). **No screen uses it yet** — phase 3 moves the Create flow over, format by format — so **nothing members see changes**, and today's Create works exactly as before.

**create_game_complete** saves a game, its players and its teams / matchups / groups in ONE transaction — everything or nothing — with the ORGANIZER's own permissions (the same row policies as today's Create), applying the line-up through the same all-or-nothing step Manage Game uses (apply_game_structure, 0184). **Only then are players told**, one notification each, with their own setup (wording owner-approved Oct 25): "… you play the Blue tees (CH 18) · Reds, with Raj Mehta, v Sam Lee & Vikram Rao · Group 1"; match play "v Sam Lee · Group 1" (team games "Reds, " first); scramble "Team 2 with Bo Li · Group 1"; Stableford / stroke / individual skins "Group 1 with Raj, Sam and Vikram". **Create now, finish later** (p_announce = false): saved NOT YET ANNOUNCED — nobody is told, not even a player added afterwards — until **announce_game_players** tells everyone at once (organizer or club admin; repeat calls do nothing).
**games.players_notified_at** (new): every existing game and every game made the old way counts as announced, so the per-player notification trigger behaves exactly as before; its text is unchanged (now built by game_added_note).
**Proof:** ci/assert-create-game-complete.sql (generated) creates every phase-1 case in ONE call with the organizer's final choices — **all 25 store exactly the phase-1 two-step record**. ci/assert-create-game-announce.sql: today's Create still notifies at once, word for word; one step tells each member once with the approved wording (four-ball, match, singles, scramble, Stableford); finish later tells nobody until announced, then exactly once; a bad line-up leaves no game, players or notifications; a misspelt field is refused; signed-out callers, non-members and strangers are refused. Negative-tested: a trigger that doesn't stay quiet (double notifications), changed wording, an empty detail, and a step that ignores groups — each fails, naming what broke. Security contract updated deliberately: announce_game_players (members; organizer checked inside) and two internal helpers (no one). Full migration chain + every assertion pass on local PostgreSQL 16.
Found by an older guard and fixed: comparisons in the new test that would silently pass on a missing value (NULL) — all 13 made NULL-safe.
Also: the phase-1 generator now tracks scramble groups in its picture of the line-up (it emitted the right calls, but handed the one-step test no groups for scrambles — caught by the equivalence test on its first run).

**Deploy: apply migration 0219 to production FIRST** (SQL editor, "Run without RLS") — CI checks the security contract against production — then staging (0219 on staging too), then the pull request. Then run check_what_is_applied.sql: 0185–0219 all "applied".

## 212.39.261025 — One-step game creation, phase 1 (part 2): what Manage Game saves, pinned on a real database

Completes phase 1's yardstick (owner, Oct 24): alongside what Create saves (212.38), a record of exactly what MANAGE GAME stores when the organizer sets teams, matchups and groups, for every format Create can make. **Nothing members see changes.**

**Shared rules, moved verbatim out of Manage Game's save handlers** (components/tournaments.tsx, components/game/scoring-views.tsx → lib/structure-ops): the payload for moving players between teams (setPlayerTeam, balance teams), the foursomes rebuilt after a group change (syncTeamPlayFoursomes), each player's group once scramble teams are saved (setScrambleTeams), alternate-shot first drivers, trifecta singles, and which players' groups the foursome editor updates. The handlers call them and make the same calls to the server. Proven identical to the old inline code: 24,000 comparisons on random games, 0 differences.
**The record** (lib/structure-behaviour → ci/assert-structure-behaviour.sql, generated): 25 cases — every format Create makes (split skins above 4 players excluded: Create refuses it). Each is created as Create creates it, then fixed organizer choices are saved through the exact calls Manage Game makes, **run as the organizer on a real database** so permissions and triggers apply as in the app; what is stored (teams, matchups, foursomes, each player's team and group) is compared with the golden record in the file. Both fresh-database runs (GitHub and local) execute it. The code-side test regenerates the file and fails if what Manage Game SENDS changes; the database test fails if what the server STORES changes.
**Found while mapping it:** Manage Game saves structure by six routes — the all-or-nothing server step, two group functions, direct game updates (matchups, foursomes), and the 2 v 2 skins foursome editor writing groups straight to the players table. The one-step flow will replace all six with one server step.
Negative-tested: un-pairing scramble teams of 2 fails the code-side test; a server group function storing one group higher fails the database test for exactly the 15 formats that use that route (scramble and 2 v 2 skins, which save groups by other routes, unaffected). Guard: ci/check_structure_behaviour.py (the handlers use the shared rules; both database runs include the test) — negative-tested against the old handlers. Full migration chain + every assertion pass on local PostgreSQL 16.
**Two older checks followed the moved code:** ci/check_competition_contract.py (Ryder Cup trifecta foursome sync) and ci/check_scramble_tee_groups.py (212.34) looked for the rule's text inside components/tournaments.tsx; they now check the rule in lib/structure-ops AND the screen's call to it. Both still fail with the original bugs put back.

No migration. Deploy: code only.

## 212.38.261024 — One-step game creation, phase 1 (part 1): what Create saves, pinned for every format

The yardstick for the one-step Create flow (owner, Oct 24): a record of exactly what today's Create step saves, for every format combination, which every later phase must reproduce. **Nothing members see changes.**

**Shared rules, moved verbatim out of the Create screen** (components/tournaments.tsx → lib/game-create): the allowance a format starts at (defaultAllowanceFor: alternate shot 50%, four-ball and trifecta 85%, the rest 100%) and how the scramble settings are put together (scrambleCreateSettings). The screen calls them; the expressions are unchanged. **Button replay** (lib/create-game-format replayFormatKey): every combination reached by the same clicks a person makes, through the same helpers, applied the way the screen applies them. **Alternate Shot added to the reachable list** — it has its own Create button but was missing: 19 → 20 combinations.
**The record** (lib/create-behaviour, pinned in ci/golden/create-behaviour.json): 26 cases — the 20 combinations, plus back nine, front nine, split skins with 4 players, and scramble teams of 2 / captains / team v team. For each: the format state, the review label, whether Create refuses it (split skins above 4 players), the saved game row, the saved player rows, where Create sends the organizer, and the game's shape. A guard (ci/check_create_behaviour.py) keeps the Create screen on these shared rules and its button handling identical to the replay. Negative-tested: changing four-ball/trifecta's default to 90% fails exactly those 4 cases; breaking 1:1 skins' replay fails its 2 cases; the guard catches a copied rule and a dropped field.
**Confirmed from the record:** 8-player Stableford/stroke play lands on Play with no groups (only 4 or fewer are grouped); both scramble types land on the Groups tab. **Found:** a game opened from a Ryder Cup session starts trifecta at 100% (four-ball 85%), while choosing trifecta by hand gives 85% — recorded, not changed.
Next (phase 1, part 2): the same yardstick for what Manage Game saves — teams, matchups, groups — on a real database.

No migration. Deploy: code only.

## 212.37.261024 — Skins counts print as fractions everywhere; the recap body credits shared (halved) holes

Owner (Oct 24) asked for one way to print skins after 212.36 showed the gap. When players tie a hole in individual skins with ties halved, the skin is SHARED — three players tie, each gets ⅓. Every place that printed a skins count got that wrong in its own way: the scoring screen and live page knew only halves (⅓ read "0", 1⅔ read "1½"); the recap email used the match-points printer (⅓ read "½"); the recap headline, "you won N skins" and the recap screen printed raw numbers ("1.6666666666666665").

**One printer — lib/skins-format fmtSkins:** whole numbers plain; halves, thirds, quarters, fifths (fields of 5+), sixths (½ + ⅓ = ⅚) and eighths as fractions (½ ⅓ ¾ ⅕ ⅚ ⅛…); anything else (twelfths) to one decimal. "⅓ skin", "1 skin", "2⅔ skins". Used by the scoring screen (its local halves-only copy removed), the team totals line for skins, the live page, the recap headline and personal lines, the recap tiles and screen, and the recap email. The recap screen's headline styling recognises the fractions.
**Found while testing it — the recap body contradicted its headline** in halved individual skins: the headline (skinsTotals) said "Raj won 6⅔ skins" while the body credited only OUTRIGHT winners ("Raj 1 skin") and called the shared holes a "Longest carry, holes 2–18". lib/game-recap-sections now credits each player's share of a shared hole (the engine's splitIds) and never calls a shared hole carried. Carry-over games are unchanged (they have no shared holes).
Tests: lib/skins-format (13): the printer, and a real three-way tie end to end — recap headline, personal line, recap body, recap email, recap screen and scoring screen. Negative-tested: each of the five old files fails. Guard: ci/check_skins_format.py (no file defines its own skins printer; the six that show skins import the shared one) — negative-tested. Design gallery: 12b-skins-thirds.

No migration. Deploy: code only.

## 212.36.261023 — The public live scorecard scores skins the way the app does (migration 0218)

Found Oct 24 while fixing 1:1 halved skins (212.35): the shared live link scored EVERY skins game as individual carry-over across the whole field. It ignored "Halved", and it ignored 1:1 and 2 v 2 team skins (the team standings summed field-wide skins by team). The app was right; only the live page was wrong. Its feed had no skins setting at all.

**Migration 0218** (get_live_scorecard): the current definition, read back from a database with every migration applied, plus ONE line — `skins_mode`. Permissions unchanged (public by share token); the security contract matches exactly. Test: ci/assert-live-skins.sql (the feed carries split and carryover, every field it carried before, still refuses bad tokens) — negative-tested against the old definition.
**Live page:** team standings and the player list now come from lib/live-skins, which hands the live data to the app's own rules (lib/game-results skinsTotals). The one translation: the live feed sends an empty foursome list where the app has none, so an empty list means 1:1. In 2 v 2 each player shows their pair's skins. "Still in play" counts every match. Skins show halves as "1½". The Carryovers box shows only for individual skins with ties carried — the one style where a field-wide pot is the game.
Tests: lib/live-skins (19): for individual, 1:1 and 2 v 2, both tie settings, the live numbers EQUAL the app's; the old live answer recorded as not the app's. Negative-tested (without the empty-list rule: 3 fail). Guard: ci/check_live_skins.py (both places use liveSkins; the only field-wide calculation is the guarded Carryovers box) — negative-tested against the real 212.35 page. Full migration chain + every assertion pass on local PostgreSQL 16.
Also: docs/sql/check_what_is_applied.sql recreated (0185–0218) — the handoff's copy was not in the package.

**Deploy: apply migration 0218 to production FIRST** (SQL editor, "Run without RLS"), then staging, then the pull request. The live page reads skins_mode when present and carries over when absent, so the order is safe either way.

## 212.35.261024 — Fix: 1:1 team skins ignored "Halved" (always carried); "skins still in play" counted one match

Found while mapping formats for one-step creation (Oct 24): Create offers 1:1 team skins with ties **halved**, but the 1:1 engine (lib/golf computeHeadToHeadSkins) had no tie setting and always carried ties over. Individual and 2 v 2 skins did respect it. Owner checked production first: **no 1:1 skins game was ever set to halved**, so no past result changes.

**Fix:** computeHeadToHeadSkins takes the tie setting — halved = every hole worth 1, a tie ½ each, nothing carries (the 2 v 2 rule); carry over unchanged and still the default. Every team skins call (1:1 and 2 v 2, in the scoring screen, the recap and the results) reads the setting through ONE rule, lib/game-shape skinsTieOf. The 1:1 screen words a halved tie as 2 v 2 does ("Halved · ½ each").
**Also fixed on that screen:** "N skins still in play" was 18 minus skins won, as if the game were one match; with two 1:1 matches 6 left of 36 read "6". It now counts every match (24 in the gallery example).
Tests: lib/skins-tie (13): the engine both ways, 1:1 halved agrees with 2 v 2 halved, team totals, the screen's wording, "still in play" with two matches. Negative-tested: the old engine fails 4 (the bug's own numbers), the old count fails 1. Guard: ci/check_skins_tie.py — every team skins engine call must pass skinsTieOf(game); negative-tested. Design gallery: 12-skins-11-halved.
Not in this release: the public live page scores every skins game as individual carry-over (it has no skins setting in its feed) — a separate fix with a migration.

No migration. Deploy: code only.

## 212.34.261023 — Scramble: small teams share a group, so one scorer keeps one card for all of them

Owner (Oct 23): with teams of 2, or captains only, teams play together on the course — but saving teams made EACH TEAM ITS OWN TEE GROUP (components/tournaments.tsx, group = team number), so a foursome of two teams had two group cards and no one could keep both.

**The rule (lib/scramble-teams scrambleTeeGroups — one rule, used by team saving and the Teams screen):** a team never splits; a group holds at most 4 players (a captain counts as one); **teams of 2 pair up by default** (two teams a group, even past a bigger team in the list); **captains default to one team per group, with the option to combine** (owner); teams of 3–4 keep a group each, as before; the organizer's choice wins wherever it fits, otherwise that team gets its own group; groups are numbered 1..n in team order. Team v team is unchanged (a match is its group). Ryder Cup scrambles have their own Teams and Groups steps — unaffected.

**Teams screen — "Groups on the course"** (shown when any team is 2 or fewer, one-leaderboard games): each group lists its teams; each team has a group picker offering only groups with room, or "Own group". It shows the SAVED groups (what scoring uses); a change pins every team's group (games.foursomes[].tee) so later team edits keep the plan. Captains are counted as teams ("2 teams · up to 4 teams a group").

**Scoring:** the group card already shows every team in its group; the server already lets a tee group's marker score any team in that group (0203/0209) — **no migration**. Proven on a fresh database (ci/assert-scramble.sql, new): a group marker scores both teams in the group, NOT a team in another group (the old layout), and a non-marker only their own team.

Tests: lib/scramble-groups (25: the rules incl. game 386503's shape — three teams of 2 → Teams 1+2 in Group 1, Team 3 in Group 2; the screen; one card with both teams). Negative-tested: the old one-team-per-group rule fails 6. Guard: ci/check_scramble_tee_groups.py (team saving must use the rule, never team position) — negative-tested. The full migration chain + every database assertion pass on local PostgreSQL 16. Design gallery: 11d-teams-groups-pairs, 11e-teams-groups-captains.

Existing games: groups change the next time the teams are saved (or use the new section). Deploy: code only.

## 212.33.261023 — Scramble: a no-show stayed on their team but vanished from the Teams screen; no-show now asks first

Owner (Oct 23, staging game 386503): after adding a player, the Teams picker listed 5 players, not 6, and Team 1 "had a player" but showed nobody. Real data: Marcus Johnson had been marked No-show (an accidental tap on the phone, owner) while on Team 1. The Teams screen HID no-shows but kept them in their team; the setup check and scoring still COUNTED him — the check said the teams were complete, and Team 1's team handicap was built with him in it. The shared line-up card hid him too, so it showed a different team handicap from scoring (in the test: 0 against 5).

**Owner's decisions:** a no-show keeps their team place ("I would leave on the team"), shown and flagged; and marking someone a no-show asks first.
1. **Teams screen** (components/game/scramble-teams-builder): no-shows are listed below the players ("No-show · still on Team 1"), with a picker that can only keep them or take them off; inside the team they are marked "no-show". Nobody disappears.
2. **Setup check** (lib/scramble-teams scrambleSetupProblem): "Marcus Johnson is marked as a no-show but is on Team 1 — take them off the team, or return them to play." — so Teams isn't "complete" until it's resolved.
3. **Line-up card and text** (components/game/scramble-lineup): show the no-show, marked, with the same team handicap scoring uses.
4. **No-show asks first, even in setup** (lib/game-setup-policy): "Mark Marcus Johnson as a no-show? They won't play in this game…" Returning a player to play before scores stays one tap. After scoring starts, nothing changes (teams are locked).
Audit of the other team screens: the Ryder Cup scramble line-up had the same gap (fixed above). The Ryder Cup tee-group picker leaves no-shows out of its slots and its counts alike, so it doesn't disagree with itself.
Tests: lib/scramble-noshow (16, from game 386503's real teams and players): the old check passing is recorded; each old file is caught (builder, line-up, policy). Design gallery: 11b-teams-noshow, 11c-lineup-noshow (the review moved the line-up's "No-show" onto its own line — it was cut off).

No migration. Deploy: code only. Game 386503 shows the flag at once — take Marcus off Team 1, or return him to play.

## 212.32.261023 — Fix: a test that failed at random on GitHub (212.31's push failed)

212.31's pull request check failed in lib/storage-tidy: "an exact duplicate under an old identity is removed". The app code is unchanged from 212.30 (byte-identical); the TEST stamped the backup and its "exact duplicate" with two separate clock reads. On a fast machine both land in the same millisecond; on GitHub's runner the clock ticked between them, so the copy was not exact and the tidy rightly kept it. Present since 212.30 — it passed there by luck. Reproduced by running the test on a clock that moves 1 ms per read: the old test fails with the CI message, the fixed test (one timestamp for the pair) passes.

**Guard (lessons become guards):** ci/test-ticking-clock.cjs runs every unit and screen suite (130) again on that ticking clock, in `npm run ci` right after the tests (~36 s). All other suites already pass that way, so storage-tidy was the only timing-dependent test. Negative-tested: with the old storage-tidy test it fails, naming the suite.

Includes 212.31 (stroke play leaderboard on par pace; many-tabs storage test). No migration. Deploy: code only.

## 212.31.261023 — Fix: stroke play leaderboard sorted on raw totals, not score to par

Owner (Oct 23, production game 494730): Nihar was "leading" at E thru 1 (net 3) while Amit was second at -5 thru 3 (net 6) — the board sorted on the raw net total (3 < 6), so whoever had played fewest holes looked best. The score column was right; the order was not. The same sort was copied into the public live page.

**Fix (lib/player-scoring strokePace, owner: "share how Stableford does it"):** stroke play now ranks the way Stableford always has — against par pace for the holes each player has played (strokes minus the par of those holes; Stableford: points against 2 a hole), the rule the six-hole segments already used. Same pace: the player further round is listed first, still tied. The app leaderboard and the live page call the one function. Finished rounds are unchanged: when everyone has played the same holes, par pace and lowest total give the same order, so results, recaps and emails (full cards only) do not move.
Real data (game 494730, as pulled from production): before — Nihar, Amit, Sanjay, Karan; after — Amit -5, Sanjay E and Nihar E (T2), Karan +1.
Tests: lib/player-scoring (the real 494730 rows, lib/game-494730.fixture, including the old wrong order); the differential test against the frozen baseline (57,460 comparisons) proves every other format and every same-holes stroke board unchanged. Guard: ci/check_stroke_pace_ranking.py (app and live page must rank through strokePace) — negative-tested.

**Many open browser tabs (owner question):** new permanent test ci/test-multitab-storage.cjs runs the real device controller with many tabs over one shared storage: ten tab hand-overs leave one backup (moved, never copied); a live old tab keeps scoring and new tabs are viewers; 50 abandoned tabs with different games use 45 KB of the ~5 MB limit. Negative-tested: with both the move and the duplicate tidy removed it fails (10 backups); the tidy alone is covered by lib/storage-tidy.

No migration. Deploy: code only (staging, then pull request).

## 212.30.261023 — Phone score backups were duplicated on every relaunch (8.7 MB); log retention (0217)

**1. The phone storage meter found a third leak** (owner, Oct 23: staging phone at 9.4 MB, 8.7 MB of score backups). When the home-screen app relaunched and resumed, it COPIED every pending backup to the new device identity and never removed the old copies — so every relaunch duplicated everything. Fix (lib/scoring-device): resume MOVES the backups; the storage tidy removes an old identity's exact duplicates whatever their age, and its fully uploaded game backups after 2 days; work not yet uploaded is never removed (kept up to 30 days, as before). Tests: lib/storage-tidy (18) — duplicates removed, uploaded old copies removed, unsent and recent kept; the device suite passes with move semantics.

**2. Log retention (0217, owner):** notifications, the activity log and the email logs are ARCHIVED, then removed from the live tables — notifications after 90 days (what members see today; 0095 deleted them outright), the activity log and the round / team-round / club-report email logs after 1 year. Rounds, scores, games and the money audit are never touched (owner). The archive is a separate schema the app's API cannot reach; run_log_retention() runs nightly ("log-retention", replacing "purge-old-notifications") and only the scheduler can run it. Test: ci/assert-log-retention.sql.

**3. Phone diagnostics log keeps 180 days** (owner).

Deploy: staging 0217 → code; production 0217 → merge (includes 212.29).

## 212.29.261023 — Fix: Reset scores was undone by the in-memory copy (212.26 regression)

Owner (Oct 23, production): "I can no longer reset scores under Manage game — the entered scores persist."

**Cause (introduced in 212.26):** each entry is also kept in memory, so a score is still sent if the phone's backup can't be stored. Reset scores cleared the phone's backups and the database, but not that memory copy — and a refresh stamped the memory copy with the game's CURRENT scoring version, so it passed the check meant to reject pre-reset entries. The old scores came back on screen and were sent again.

**Fix (components/tournaments):** each memory entry records the scoring version and time it was made; a refresh (and the writer) use it only if that version is still current and it was made after any reset — otherwise it is discarded. Every reset path clears it (Reset scores, course change, match-length change, delete game, a reset made on another device), and it is dropped once the score is confirmed saved.
Tests: ci/test-game-score-recovery (the real refresh code: a pre-reset memory entry does NOT come back; an unsent post-reset entry survives); ci/test-game-reset (the real Reset scores code clears the memory copy); the device suite passes.

No migration. Deploy: code only — URGENT for production (includes 212.28).

## 212.28.261023 — Storage audit: two more unbounded stores fixed; phone storage meter; database size report

Owner (Oct 23): after the 212.26 storage bug — "are we close to getting to memory full anywhere else?"

**Audited every place the app stores data on the phone** (~25 writes). Fixed keys are bounded (diagnostics log capped at 400; AI counter, boot cache, session and settings are single small values). The offline app copies (service worker) are cleared on every release. Found and fixed:
1. **Team-score drafts (scramble / alternate shot) could stop a save:** a full storage area made the draft write THROW, so the team score was never sent — the 212.26 bug class on another path. Now it tidies and retries; if it still fails it is reported and the score is still sent (the draft is only the offline backup).
2. **A game's score backups were never removed when the game ended** — one backup and one confirmed copy per player per game scored, forever. The storage tidy now removes a pair once fully synced (nothing pending) and over 30 days old; unsent scores are never touched.
- One storage-failure flag (lib/scoring-device noteStorageWriteFailure / storageWriteFailed) for every backup kind; the scorecard's top warning shows for either.

**Admin → Diagnostics → Phone storage:** how much BNN keeps on this phone against the ~5 MB allowance, by kind, with "Tidy now".
**ci/check_storage_writes.py (new guard):** every function that stores a score backup must tidy, retry and report a failed write — it fails the build if that handling is removed (proven).
**docs/sql/storage_report.sql:** read-only — the database's size, its 15 largest tables, and the always-growing tables (activity log, notifications, money audit, email log, holes) over the last 30 days.

Tests: lib/storage-tidy.test.ts (14): synced old backups removed, unsynced and recent kept, a team-score draft on a full area doesn't throw and is flagged, the meter adds up; the device, recovery and reset suites pass. Photographed and reviewed.

No migration. Deploy: code only (includes 212.27).

## 212.27.261023 — The score-save trace is a switch in Admin → Diagnostics

Owner (Oct 23): keep the save trace (it found the 212.26 storage bug) but make it something to switch on and off, in Admin → Diagnostics.

- **Admin → Diagnostics → "Score-save trace": On / Off** — per device, OFF by default, on any site (staging or production); only Admin reaches the switch, so members never see it. The game screen shows the trace panel only while it's on (it was always shown on staging). The trace records quietly regardless, so switching it on shows the latest events.
- lib/save-trace: saveTraceEnabled / setSaveTraceEnabled; components/save-trace-view: SaveTraceToggle, useSaveTraceOn.
Tests: lib/save-trace-toggle.test.tsx (off by default; on and remembered; off again). Photographed and reviewed.

No migration. Deploy: code only (includes 212.26).

## 212.26.261023 — Fix: a full storage area made every score backup fail silently, and entered scores vanished

Found with the 212.25 save trace (owner, Oct 23, staging): "tap … scorer yes", then "save try 1–4: not saved" with no "held" or "sending", then "refresh: … no phone backup" for every player. The save sends what is in the phone's backup; the backup write was failing — the site's storage area (about 5 MB, separate per site) was full — and the error was swallowed, so the writer found nothing to send and the next refresh showed the database's empty card.

**Why it filled:** every new device identity (a fresh install, a takeover, an unrecognised relaunch) copied all earlier identities' score backups into a recovery archive that only grew, and left those backups in place, where they can never be read again (pending work is isolated by device token). Staging, with many test games, deploys and relaunches, filled first; active members on production would have followed in time.

**The fix:**
- **lib/scoring-device:** the recovery archive (the runaway growth — repeated full copies) keeps its 3 newest entries from the last 30 days; tidyScoringStorage() also removes game snapshots not opened for 30 days, and another identity's backup only when its own timestamp is over 30 days old — never while recent, since another tab or a phone that scored offline may resume it (ci/test-scoring-device caught a first version that removed them) — run after every successful device claim.
- **lib/draft saveGameScores:** a failed backup write tidies the storage and retries; if it still fails, it is flagged (backupWriteFailed), not swallowed.
- **The save path (components/tournaments):** each entry is also kept in memory — the writer sends from it when the phone's backup is missing, and a refresh keeps it until confirmed; a plain warning shows at the TOP of the scorecard when backups can't be stored (the bottom status bar can be hidden by the navigation).
- The staging SAVE TRACE stays for one more round to confirm the fix ("sending … sent: OK").

Tests: lib/storage-tidy.test.ts — a FULL storage area packed with what staging accumulated: the backup succeeds after tidying, the archive is capped at 3, old snapshots go, an unfixable failure is flagged, and the writer sends from memory; the score-recovery and reset suites (the real refresh and save code) pass.

No migration. Deploy: staging first, confirm, then production (it carries 212.20–212.25 too).

## 212.25.261023 — Diagnostic: a save trace on staging

Owner (Oct 23, staging game 564332): in stroke play, entered scores showed, then vanished ~10 s later. The staging API logs show no save_game_score_bundle call at all — the app never sent them — and no status message was seen. The database's save works (tested on a migration-built database: the score is stored).

To find where it breaks without guessing, staging shows a SAVE TRACE at the top of the game screen (lib/save-trace, components/save-trace-view): each tap (and whether this device is the scorer), why the writer held a save (not the scorer / recovery not ready / reset in progress / offline), what was sent and the database's answer, and each refresh (scorer, phone backup missing or discarded, holes kept). Tap the title to collapse. Production never shows it (isStagingClient). No behaviour change.

No migration. Deploy: STAGING ONLY — do not merge to production until the cause is fixed.

## 212.24.261023 — Stableford & stroke play: choose the segment side contest

Owner (Oct 23): a Stableford game showed six-hole segments nobody chose, and there was no way to play front 9 / back 9 instead. The team formats had a Segments setting; the individual formats' "six-hole segments" panel under the leaderboard was always on and always sixes.

- **Setup → Format → Segments** for Stableford and stroke play: **Sixes** (default) / **Nines** (front 9 & back 9) / **Off** — saved in leg_config (no migration). The panel and its breakdown follow the choice ("FRONT 9 & BACK 9 (NET STABLEFORD)"); Off hides it.
- **TGC money games are always three sixes** — the payouts and clean sweep are built on them (owner: TGC never plays nines). The setting shows "Three sixes — the money game pays on them"; the money calculations (lib/golf computeBetting, lib/segments segOf / segLeadersFrom) are unchanged.
- lib/segments: indivSegScheme, segRanges, segValues, segLeadersFor — the general version for display; for three sixes it equals the original exactly (tested across 80 random groups, Stableford and stroke play).

Tests: lib/segments-scheme.test.tsx. Photographed and reviewed.

No migration. Deploy: code only (includes 212.23).

## 212.23.261023 — An automatic game name follows the format

Owner (Oct 22): changing Stableford to stroke play left the line-up link (and everything that reads the game's name — live link, recap, emails, the app) saying "Stableford / …". Since 208.5 an AUTOMATIC name ("Format / Course / Date") is rebuilt when the course or date changes — the course part works and is tested — but not when the format changes.

- **lib/game-create refreshedAutoName** takes the format too; Setup → Format renames an automatic name in the same update (components/tournaments setFormat). A name the organizer typed is never touched.
- **A name already left stale** by an earlier format change is recognised as automatic (any format's label), so the next format, course or date change repairs it.
- **The line-up link's description** names the format properly ("Stroke Play", not the raw "stroke").
Tests: lib/game-name.test.ts (a format change renames; a stale name is repaired; a typed name is kept; the description's label); lib/lineup-meta.test.ts updated to the label.

Note: chat apps keep the preview they fetched when a link was first shared; sharing the link again shows the new one.

No migration. Deploy: code only (includes 212.22).

## 212.22.261022 — Stroke play scorecard: net score, not Stableford points

Owner (Oct 22): in a stroke play game each score cell's corner badge showed Stableford points ("2", "3") and the legend read "box = net Stableford" — points decide nothing in stroke play. Now, in stroke play only, each played hole's badge is its net score ("net 3" — gross minus the strokes received there), the Out / In / Total boxes show the net total for that nine / the round, and the legend reads "box = net score". Stableford and the other formats keep points. Tests (tee-yardage): stroke play net badges and legend; Stableford unchanged. Photographed and reviewed.

No migration. Deploy: code only (includes 212.21).

## 212.21.261022 — Record the real score everywhere; yardage per tee

Owner (Oct 22):

**One entry limit everywhere — par + 8.** Stroke play counted a quad bogey in full, but entry was inconsistent: each player's own card stopped at net double bogey (or double par) outside stroke play, and the round editor at double par — so a 7 on a par 3 couldn't be picked there without a handicap stroke, and the real score was lost. Now every screen and format records the real score up to par + 8 (lib/golf maxHoleScore — the one rule, used by the score pop-up, the player card, the solo/round entry and the round editor). The caps stay in the calculations, which apply them: the handicap index takes each hole at most net double bogey (WHS), Stableford gives 0 points. The quick-pick buttons still stop at double bogey.

**Yardage per tee.** The group scorecard used one yardage for everyone when a group played more than one tee (the game's stored yardage). Each hole header now shows every tee in the group with its yardage, longest first ("Par 4 · Blue 365 · White 340 · SI 7"); one tee reads as before; the score pop-up shows the tapped player's tee. Photographed and reviewed.

Tests: lib/tee-yardage.test.tsx (mixed tees, one tee, the tapped player's tee, the entry limit); full suite unchanged.

No migration. Deploy: code only (includes 212.20).

## 212.20.261022 — Ryder Cup scramble: the recap headline is the session score

Owner (#17): a Ryder Cup scramble's recap headline gives the session score, as the Cup does — "Blues 1½ – ½ Reds" (leader first; level "Reds 1 – 1 Blues") — instead of listing each match result. It comes from the Cup standings' own scoring (lib/competition scoreCompetitionGame: DECIDED matches only), so it can never disagree with the standings; a match unfinished when the game ended is said in a smaller line below ("1 match unfinished — not in the score until completed, as in the Cup standings"). A scramble without the Cup's two teams keeps its headline. Tests (cup-scramble): 1½ – ½; an unfinished match; a non-Cup scramble. Photographed and reviewed.

Also: docs/sql/data_profile.sql gains Part 3 (Insights & Your courses — rounds usable, stroke indexes, putts, members ready, club courses with averages).

No migration. Deploy: code only (includes 212.19).

## 212.19.261022 — Production matches the migrations: three hand-made functions retired (0216)

The production security check (212.8) found three differences on production:
- **create_group_invite / redeem_group_invite** — the original one-time invite functions, made by hand on production before migrations and never captured in one (0015 mentions them). Redeeming already goes through begin_account (0189); creating a one-time link now uses create_group_invite_multi with 1 use and 30 days — the same behaviour, admins only (components/groups.tsx).
- **clear_my_notifications** — created by 0094, no longer callable on production, no longer used by the app.

0216 retires all three (removed on production; nothing to remove on a migration-built database), so production and the migrations match exactly. The recorded security contract changes by one line (clear_my_notifications removed). `drop function` without cascade refuses if anything still depends on one, so an unexpected dependency would stop 0216 harmlessly. Test: ci/assert-retired-functions.sql.

**Order:** apply 0216 to production, then merge promptly — until the merge, production's 212.6 "one-time link" button errors (multi-use links work).

Deploy: staging 0216 → code; production 0213–0216 → merge. Includes 212.18.

## 212.18.261022 — Insights and Your courses (0215)

Owner (Oct 2026, placed Oct 22): personal analysis from data BNN already records.

**Insights** (lib/insights.ts; components/insights.tsx). A dashboard card right after the handicap — the two strongest findings, a bold headline and a plain detail — and "See all insights" opens the full screen: what stands out (problems, then strengths, then general figures, by shots a round); against par per hole by hole type, difficulty (stroke index) and stretch of the round; consistency (within 3 of handicap; what blow-up holes cost; three-putts). From the last 20 valid rounds (lib/round-rules: 9+ holes), nothing until 5, no finding from fewer than 20 holes.
**Findings compare each hole with what the member's own game predicts** — the round's score over par spread across the holes the way handicap strokes are — because everyone drops more shots on the hardest holes; a raw comparison always "found" them. A player who pars everything gets no invented leak; a constructed +12 season shows the hardest holes 1.1 a hole worse than predicted (about 6.9 shots a round). The screen shows both: against par, and "vs your game".

**Your courses** (lib/your-courses.ts; components/your-courses.tsx), at the top of the Courses tab: each course played, most first — rounds, best and average gross (complete 18-hole rounds only), last played. Tap one: nemesis hole and best hole (their averages), and hole by hole your average against par beside the CLUB's — your figure red where you're half a shot or more worse than the club there, green where better.

**0215 course_field_averages:** the club's hole averages at a course — members can't read each other's hole scores, so only averages leave the database, nothing unless 5 rounds by 3 members (3 scores per hole), last two years, the club's own active members only. Tested: averages only, the threshold, another club / a suspended member refused, not callable signed out.

Tests: lib/insights.test.ts (messy rounds — lib/test-fixtures/messy-rounds.ts — known answers, the window, the course record, no handicap), lib/insights-render.test.tsx, ci/assert-course-field.sql. Design gallery: 5 new screens, reviewed at phone width.

**Before it reaches production:** run docs/sql/data_profile.sql on production (standing rule for statistics).

**Also: Insights reads handicaps through the one rule.** A guard (check_handicap_single_source) caught a direct read of the stored course handicap, which would ignore a manual one (0153); and the scoring rule treats no handicap as scratch (0) — right for a game, wrong for an analysis — so lib/game-shape gains chBasisOrNull ("no handicap" is none). The expected-score spread uses the one stroke allocator (lib/golf allocateStrokes, by stroke-index rank) — another guard caught a hand-written allocation. Tests: a manual handicap used as entered; no handicap → no after-handicap findings.

**CI: the Supabase images are kept between runs.** GitHub's container registry kept rate-limiting the image downloads (the retries got the database image, then the CLI needed realtime too). The workflow now restores a saved copy of the images (actions/cache, keyed on the pinned CLI 2.101.0 — keep in step), saves them after the first successful run, and the rebuild retries up to 8 times.

Deploy: staging 0215 → code; production 0215 → merge.

## 212.17.261022 — CI: the fresh-database rebuild survives registry rate limits

GitHub's fresh-database check kept failing before a single migration ran: GitHub's container registry (ghcr.io) rate-limited the download of the Supabase database image ("toomanyrequests"), and the Supabase CLI retries only twice (4s, 8s).

- **.github/workflows/ci.yml:** signs in to ghcr.io with the run's own token before the rebuild (anonymous downloads are the ones throttled); `packages: read` permission. No new secret.
- **ci/test_fresh_db_rebuild.sh:** retries `supabase db start` patiently — 15s, 30s, 60s, 120s, up to 5 attempts; downloaded layers stay cached between attempts. Only a registry rate limit is retried; any other failure fails at once. Proven with a stand-in CLI: rate-limited twice then starts (3 attempts); a migration-style error fails at once (1 attempt); rate-limited every time gives up after 5.

No app change. No migration. Deploy: code only (includes 212.16).

## 212.16.261022 — Design sweep: 21 fixes across the recent screens; a design gallery

Owner (Oct 22): "these are basic design choices that you should be proactively looking to implement rather than me having to constantly point them out." Every screen built recently was photographed at phone width and reviewed as a member would see it.

**New: the design gallery** — lib/design-gallery.tsx renders 14 recent screens with realistic sample data; `npm run gallery` (scripts/design-gallery.mjs) photographs them at 390px. HANDOFF rule: every new or changed screen gets an entry and is reviewed this way before it ships.

**Fixed (21):**
- Teams screen: a one-line explanation with the detail behind "How?" (it was five lines above every control); the selector reads "Team 1" (counts only in the menu); fixed-width selectors; the mixed-sizes note names every team; captains only — the note once at the top, not on every card, and one handicap box per team (no second gold label).
- Format settings: a one-line explanation; % beside every percentage box (they read as strokes); a value changed from the USGA's labelled in gold ("changed · USGA 25%"); drive buttons "2 each / 3 each / 4 each" on one line.
- Ryder Cup scramble groups — two real bugs: the counter assumed 2 per side ("NEEDS 0 PLAYERS" at 2 of 3 each — now "NEEDS 2 MORE"), and the explanation described pairs and Trifecta singles (now what the scramble buttons do).
- Scorecard (team v team): the match status above the table ("Blues won 6&4"); each team's score on two deliberate lines.
- Game-screen matches: each card named ("MATCH 1").
- Recap matches: match name, result, and both teams' players (it was one bare line).
- Line-up card: the working in aligned columns — Index · Course · % · Counts.
- Team rounds: "TEAM ROUNDS" heading (it wrapped); the result bold on the right.
- Season Wrapped headline: the team-round line smaller and positive ("including 3 scramble & alternate-shot rounds").
- Team-round / round email: the scramble leaderboard as the app's table (Pos · Team · Net · Gross · ±, members on their own row), and named matches with players.

No migration. Deploy: code only (includes 212.15).

## 212.15.261022 — Scramble leaderboards laid out as tables

Owner (Oct 22): the final leaderboard's layout. In the recap, each row's score — "54 net (63 gross, -18)" in large type — took more than half the width, squeezing the team and its members into a narrow column; the subtitle showed the raw word "scramble".

- **The final leaderboard (recap, shared image)** is a table: Pos · Team · **Net** (biggest — the ranking) · Gross · ± ("thru 15" under it for an unfinished round), with the members on a full-width line under each team.
- **The game-screen leaderboard:** the members on a full-width line too, instead of wrapping inside the Team column.
- The recap's format name reads "Scramble".
(The round email keeps its one-line wording.) Checked by screenshot at phone width.

No migration. Deploy: code only (includes 212.14).

## 212.14.261022 — The scramble scorecard, rebuilt

Owner (Oct 22): "the team members are crunched in a small part of the screen and the score takes up more than half of it." A scramble used the scorecard's per-player layout — a one-line team header ("Raj / Nihar / Karan / Sam · team hcp 7") and a thumb-high box per hole, eighteen times over (about eight phone screens), with a "net Stableford" legend that doesn't apply.

**Now its own card** (components/game/scorecard-views, scrambleBody — inside the same scorecard, so the score editor, drive chips, saving and permissions are unchanged):
- **a header per team** — name (or Cup side), team handicap, every member on their own line with their course handicap, and the running score ("Thru 12 · 43 gross · 38 net (-9)"); team v team side by side;
- **a compact table** — Hole · Par · SI · a score column per team — each cell with the team's stroke dots, the net in the corner and, when drives are tracked, whose drive; tapping opens the score editor;
- **Out / In / Total** with gross and net; the legend "dots = team strokes · colour = net v par".
About a screen and a half for 18 holes. Checked by screenshot at phone width (one team; team v team with drives).

Test: the card replaces the per-player layout; every member and the team handicap in the header; 18 cells and Out / In / Total; no Stableford legend; tapping a cell opens the editor for that hole.

No migration. Deploy: code only (includes 212.13).

## 212.13.261022 — Scramble recap: net, gross and net to par for every round

Owner (Oct 22): every round reads the same way — net first, then gross and net to par — "54 net (63 gross, -18)"; an unfinished round adds how far it got — "49 net (67 gross, -9 thru 15)". The headline and each player's line read the same way; teams are ranked by net to par. lib/scramble-game scrambleRowValue / scrambleScoreText — the app's recap, the shared image and the round email.

No migration. Deploy: code only (includes 212.12).

## 212.12.261022 — Scramble recap: unfinished rounds show the scores themselves

Owner (Oct 22): for a round that wasn't finished, show the net and gross scores themselves, net first — "49 net (67 gross, -9 thru 15)" — rather than "net -9 (67 − 18 strokes, thru 15)", which made players do the subtraction. Full rounds keep "net -18 (72 − 18 strokes)". The headline and each player's line read the same way; teams are still ranked by net to par (fair when teams played different numbers of holes). lib/scramble-game scrambleRowValue / scrambleScoreText — the app's recap, the shared image and the round email.

No migration. Deploy: code only (includes 212.11).

## 212.11.261022 — Scramble Teams screen: one column of players; ending a scramble

Owner (Oct 22, staging):

**The Teams screen, in the owner's layout:** every player in ONE column — name, course handicap, and a team selector on the right (No team · Team 1 … · New team; a full team can't be picked) — with the teams summarised below (players, and the team handicap by the method: USGA working, or the agreed box). Empty teams disappear when their last player moves. "Make balanced teams of 2 / 3 / 4" stays as a shortcut. (Replaces "Pick teams myself" / "Add to…" / "Move to…".) A Ryder Cup scramble still builds its matches in Setup → Groups.

**Ending a scramble said "no scores entered" for every player.** The end-of-game check read team scores only for alternate shot; a scramble fell through to players' own cards, always empty. It now checks each TEAM (lib/scramble-game scrambleFinishGaps — "Team 2: holes 17, 18"); the offline-upload check before ending covers scramble's team scores too.

Tests: the new layout (one column, New team, the selector shows the team, an emptied team disappears, full teams can't be picked); ending a scramble (fully scored: nothing missing; a team missing holes named with them).

No migration. Deploy: code only (includes 212.10).

## 212.10.261022 — Scramble recap: strokes actually taken; net to par for unfinished rounds

Owner (Oct 22, staging game 109487 — ended without all 18 holes): the leaderboard read "Team 3 · 67 gross thru 15 · -9", but the recap read "net 49 (67 − 22)". The net (49) was right — strokes are taken hole by hole, so through 15 holes the team had received only the strokes on those 15 holes — but the recap's working used the full 18-hole team handicap (22), so 67 − 22 didn't equal 49. And the headline and personal lines compared raw net totals, which can't be compared between teams that played different numbers of holes.

- **Rows:** net to par with the strokes actually taken — "net -9 (67 − 18 strokes, thru 15)"; a full round "net -18 (72 − 18 strokes)" (lib/scramble-game scrambleRowValue — the app's recap, the shared image and the round email read it word for word).
- **Headline and personal lines:** to par, the leaderboard's basis — "Team 3 wins the scramble — net -9 (thru 15)", "Your team (Team 3) finished 1st, net -9 (thru 15)" (scrambleScoreText).
- Test: a team with a team handicap of 22 stopping after 15 holes — strokes taken through 15, the row adds up, the headline says thru 15.

No migration. Deploy: code only (includes 212.9).

## 212.9.261022 — Every field uses the one field style; two documented exceptions

Owner (Oct 22), the fields the 212.0 guard found:

**Readability bugs fixed:** the contest-logging fields in the score-entry pop-up (closest to pin, longest drive — feet, inches, distance, player) and the yardage-backfill cells had **cream text on a white background**, almost invisible. Now the shared style: dark ink on the field fill.

**Brought in line (DISPLAY_RULES.md §2 — `inputStyle`, layout-only adjustments):** contests' entry fields and player menu; course history "Reason for restoring"; the live-link box; the club switcher (compact); the public line-up "Find your name" search (keeps its pill shape); the admin game-repair note; Admin → Clubs "Merge into"; Admin → Game "Reassign organizer"; the organizer's handicap-index box; the player-card note.

**Already correct (my guard's miscount):** nine fields used the shared style directly or a style built on it (money, course searches, tee-time dates). The guard now recognises every correct form.

**Two documented exceptions** (owner), marked in the code (`data-field-exception`), named in the guard, and written up in DISPLAY_RULES.md §2 "Field-style exceptions": the score-entry number picker (reviewed and kept — score entry is its own surface family; don't flag it again), and the invisible native date input under the date button.

**ci/check_field_style.py** is now strict: no allowance for old fields — any other self-styled field fails the build. Spacing: 8 fewer off-scale values; the lower baseline is recorded.

No migration. Deploy: code only.

## 212.8.261022 — Security contract on production; server-route audit; storage rules (0214)

Owner (Oct 22): finish the security work.

**The security contract now checks PRODUCTION.** It checked only the database built from migrations, so a rule or permission changed by hand in production's dashboard went unseen. 0214 adds security_contract_state() — server only, read-only — reporting exactly what the contract checks; the contract check reads this ONE function locally, in GitHub's fresh database, and on production: nightly (production-security.yml — a difference fails the job and opens a GitHub issue naming it) and on every pull request (ci.yml's production job). ci/fetch_security_contract_state.mjs fetches it with the server key; ci/check_security_contract.py --state-json compares. Proven: identical to the previous queries on the same database (132 rules, 45 permissions, 199 functions); a simulated hand edit on production ("expenses delete rule now true", "anon can read expenses") is named.

**Storage in the contract.** Avatars are the only stored files; their rules are right (anyone can view; only the member adds, replaces or deletes their own; images only, 512 KB) — and now watched: the 4 storage rules and each bucket's public / size / type settings are in the report and the snapshot. Proven: a loosened upload rule and removed limits are named.

**Server-route audit.** Nine routes use the server key (which bypasses row-level security): each has a sound gate — the job / webhook secret (round-emails, push), a signed link that only turns emails off (unsubscribe), or the signed-in member with their own data or the right role (member-stats, push test, game completed, course checks, course apply, account merge); the four acting-on-behalf functions (merge_accounts_as, apply_course_freshness_selected_as, remember_course_declines_as, record_course_freshness_checked) are server-only and check the actor's authority. No gap found. ci/check_server_routes.py (new, in the guards) keeps every future route to it: a recognised gate, and the signed-in user as the actor — never an id from the request.

**Deploy note:** apply 0214 to production BEFORE opening the pull request's checks (its production job now reads security_contract_state()).

Deploy: staging 0214 → code; production 0214 → merge.

## 212.7.261021 — Team rounds count as played: Season Wrapped, round history, recap email (0213)

Owner (Oct 22). Scramble and alternate shot record one score per team / side, never a personal round — so a member's scrambles and alternate-shot games were invisible in Season Wrapped (a scramble-only member wouldn't even get the notification), their round history and the round email.

**A team round** (lib/team-rounds.ts, and its database twin team_rounds_in_year — the same rule): a member in a FINISHED scramble or alternate-shot game whose team / side scored 9+ holes; older alternate-shot games that kept the scores on the players' own cards count too. Played — never in a personal statistic.

- **Season Wrapped:** the headline's rounds, holes and courses include team rounds ("including 3 team rounds (scramble / alternate shot) — played, not in your personal stats"); every personal-statistic card unchanged; the floor still gates the statistics (they need personal rounds). The notification, the admin preview and the club totals (send_season_wrapped, season_wrapped_preview, season_club_stats) count personal + team rounds.
- **Round history:** a "Team rounds · scramble & alternate shot" list under the member's rounds — date, course, format, team or partner, result ("1st of 4", "Reds won 2&1") — tapping one opens the game. Not in the Dashboard's statistics.
- **The team-round email:** the game's recap (recapEmailHtml, the app's recap word for word) with the member's own line, from the round-email job, on the round email's rules — opted in, active, owner-only until opened to everyone, 1 hour to 7 days after the game ends, never twice (team_round_email_log; due_team_round_emails / record_team_round_email, server only). "Open the game" uses the game's code (lib/app-links).
- 0213 classifies the new log for account merges (moves with the account, like the round-email log).

Tests: ci/assert-team-rounds.sql (9+ holes count, 5 don't; older alternate shot counts; a scramble-only member is in Season Wrapped; the email due once; server only); lib/team-rounds.test.ts (the rule, results, Cup names, Season Wrapped headline with personal cards unchanged, the email and its link).

Deploy: staging 0213 → code; production 0213 → merge.

## 212.6.261021 — Scramble simulation: hundreds of games, two bugs found and fixed

Owner (Oct 22): "run this version through simulated game tests for various combinations and confirm all works like it should."

**lib/scramble-simulation.test.tsx (in CI):** 240 seeded random games through the real code — one leaderboard and team v team; teams of 2, 3, 4 and mixed; captains only; USGA default and custom percentages, agreed handicaps (some blank); plus handicaps; drive requirements; Ryder Cup 2 v 2, 3 v 3, 4 v 4; partial and full rounds — each checked against an INDEPENDENT calculation in the test: team handicaps; strokes on the card (team only, totalling the handicap, on the right holes); leaderboard (net = gross − strokes, order, shared ties); match lead and closeout; Ryder Cup points (app = live page, a decided match worth 1); live page, line-up and recap agreeing; club-report rounds; drive tallies. 24,622 checks. A one-off 1,500-game run with another seed: 158,522 checks.

**Found and fixed:**
1. **Plus-handicap teams showed no strokes on the card** (the leaderboard was right). The card's team strokes came from a give-only allocator; now the engine's own signed allocation — a plus team gives strokes back on the easiest holes, drawn with the hollow "you give a stroke" mark.
2. **The Cup live page ignored a scramble's handicap method.** liveCupSessionScore handed the engine a cut-down game (type, allowance, mode, par), dropping the scramble settings — so every Cup scramble was scored there as USGA with the standard percentages, and agreed handicaps or custom percentages gave different leads than the app. The settings now pass through.

No migration. Deploy: code only.

## 212.5.261021 — Ryder Cup scramble: pick each match's players like the other team formats

Owner (Oct 22): "for Scramble I am supposed to be able to choose team members. It should be the same as 4 ball or alt shot or trifecta for team selection." And the Cup scramble team screen didn't fit an upright phone.

**What was wrong.** Four-ball, alternate shot and trifecta pick each match's players in Setup → Groups (the slot builder — per group, N menus per Cup side, matches derived from the groups). 212.3 gave a Cup scramble a separate editor in a different tab — a second, different way to do the same thing, with one-line rows (name, working, a "Match 1 · Reds" menu) too wide for a phone.

**Now a Ryder Cup scramble is a team-group format like the others:**
- lib/game-shape — a scramble with the Cup's two teams uses Teams + Groups (a normal scramble keeps its Teams editor);
- the slot builder (scorecard-views TeamGroupsBuilder) takes N per side — 2, 3 or 4, the session's size: N menus per side, "ready" at N v N, "Each group is one match: its Reds players are one scramble team, its Blues players the other — exactly N of each"; its menus wrap on a phone;
- groups become matches as for the others (syncTeamPlayFoursomes → deriveTeamFoursomesFromGroups); setup complete at N v N in every group;
- "⚖️ Build balanced matchups" / "🎲 Build even groups" build teams of exactly N from each side (snake-drafted by course handicap) — team i of each side in Group i — saved with the matches in one transaction (apply_game_structure);
- the control center reads "Scramble · Ryder Cup · 3 v 3 · USGA allowance";
- a Cup scramble's sides are named by the Cup ("Reds", "Blues") — scorecard, results ("Reds 2 UP thru 12"), recap, line-up, live pages (scrambleTeamsOf / cupSideNames).
212.3's separate Cup branch in the scramble Teams editor is removed (one way to build Cup matches). Normal scramble Teams screen: each player's Add to… / Move to… menu on its own full-width line, so rows fit a phone.

Tests: the setup flow for a Cup scramble 3 v 3 (format line; Teams & groups → Groups shows the slot builder with three menus per side, not the Teams editor); Cup side names in results; game type coverage (a scramble supplies teams only as a Cup session).

No migration. Deploy: code only.

## 212.4.261021 — Scramble line-up by team, with inputs and method; random scores for one-ball formats

Owner (Oct 22), from staging:

**The line-up card didn't make sense for a scramble.** There are two line-up cards: the public line-up page (which had a scramble version since 212.1) and the line-up you share from the app (components/share-card), which still laid every game out by group with individual playing handicaps. Both now use ONE scramble line-up (components/game/scramble-lineup.tsx): by team (and by match for team v team); each player's own handicap shown as the input it is ("Index 3.8 → course hcp 4.2"); the method stated with the percentages actually used for each team size; under USGA each player's "× 25% = 1.1" and the sum line ("1.1 + 2.0 + 2.2 + 2.2 = 7.44 → 7"); under agreed the agreed number with players' handicaps for reference. Each team handicap is shown prominently in light text on the card's dark green. "Copy as text" says the same (scrambleLineupText).

**Random scores (staging) didn't show in a scramble's results.** The 🎲 tool wrote individual scores to each player's own card — visible in the score history, but a scramble's (and alternate shot's) results read team / side scores. For one-ball formats it now writes team / side scores through the same fenced save as the scorecard, and for a scramble with a drive requirement records whose drive, round-robin.

**Scorecard header:** a scramble team no longer shows the handicap twice ("playing hcp" and "team hcp") — just "team hcp"; the score-entry title says "team hcp".

**"Protected Deployment – Vercel" on a shared staging link** is Vercel's Deployment Protection on the staging project (a Vercel login is required); production isn't protected that way. Not an app change — the owner can turn it off for staging, or use a protection-bypass link, in the Vercel project's settings.

No migration. Deploy: code only.

## 212.3.261021 — Scramble as a Ryder Cup session (0212)

Owner (Oct 21): "we should absolutely offer scramble in Ryder Cup … it has to be the same number of players in a team facing off against the opponent."

**A scramble session** is a set of team v team matches — one scramble team from each Cup side, both with the session's number of players (2 v 2 by default; 3 v 3 or 4 v 4) — hole by hole with team handicaps (USGA allowance with the game's percentages, or agreed). Points as other sessions: a win 1, a halve ½ each.

- **Cup → Add a session:** format Scramble, "Players per team" 2 / 3 / 4.
- **Set up this session's game:** created as a team v team scramble keeping the Cup's two teams; the form shows "RYDER CUP · 2 V 2" instead of who's on the app; handicap method and percentages as usual.
- **Setup → Teams:** "Make balanced matches" — each Cup side snake-drafted by course handicap into teams of exactly N, paired Match 1, 2, … (Team A's team on side a); "Pick matches myself"; Add to… / Move to… only offer a player their own Cup side, where there's room; each team is labelled by its Cup side. Setup is complete only when every match is exactly N v N ("Match 1: Blues have 1 of 2 players").
- **Points everywhere from one engine:** the app's Cup scoring (lib/competition scoreCompetitionGame — standings, session recap, Cup box) and the Cup live page (lib/live-scoring liveLegs) both use the scramble engine's running lead (scrambleMatchProgress) through the shared closeout, so results read like other sessions' ("2&1", "AS"); team handicaps by the one method rule (app) and its feed twin (lib/live-scramble, also now used by the scramble live page). Test: the same match scored by both agrees.
- **0212:** competition_sessions.format accepts 'scramble' and has scramble_team_size (2–4); guard_competition_game_structure — a Cup scramble is team v team and no team is larger than the session's size (its trigger now also fires when scramble_mode changes — it didn't, caught by the test); get_live_competition carries the scramble settings and entered team handicaps.

Deploy: staging 0212 → code; production 0212 → merge.

## 212.2.261021 — Scramble end-to-end check: fixes

Owner asked for a full end-to-end check. Method: every app file and database function that treats alternate shot specially (the closest format — one score per side, same score table) was checked for scramble (21 files, 10 functions), then the journey traced from creating a game to the season. Fixed:

1. **Setup rules counted a scramble mid-round as unscored.** lib/game-setup-policy judged "scoring has started" from players' own cards (empty in a scramble) plus alternate shot's side-scoring marker only. Now the marker counts for scramble too, and once set every player counts as having scores — so removing a player, changing teams or moving groups mid-round is blocked or confirmed as for alternate shot, with the message naming "scramble team scoring". (The setup screens themselves already locked correctly.)
2. **One-ball formats counted nowhere in the club report.** Since alternate shot moved to the canonical side-score store (0140), its players' own cards are empty — so alternate shot AND scramble counted no game, round or attendance (side scores fed rivalries only). Now each player carries their side's / team's card: the round counts for games, rounds and attendance, and still feeds no individual statistic; older alternate-shot games (scores on players' cards) keep counting.
3. **Scorecard view showed nothing under the card for a scramble** — other team formats show their results there; now the scramble leaderboard / matches.
4. **Admin screens showed the raw key "scramble"** — now "Scramble".

Checked and right: score resets clear team scores for any format; deleting a game removes its team scores; match length can't change once a team score exists; the primary-device rule guards the team-score table; no betting is offered on a scramble; the share-my-card buttons stay hidden (no individual card exists — the recap is the shareable result); results code for other formats is never reached by a scramble.

Tests: setup rules (blocked once team scoring starts, with the scramble wording; not blocked before); club report (a scramble and an alternate-shot game count 6 rounds, no best gross).

No migration. Deploy: code only.

## 212.1.261021 — Scramble: team strokes only; the line-up card and live scorecard show teams (0211)

**Team handicaps weren't the strokes being drawn (owner).** A 12 handicap's team showed a stroke on every hole and two on several. The team handicap was calculated correctly, but the scorecard's stroke sets (lib/game-shape strokeSets) had no scramble case, so the team's row fell through to the default — the FIRST player's own course handicap — and a second check also drew individual course-handicap dots and a Stableford column. In a scramble nobody plays their own ball: now the only strokes shown are the team's ("your team"), from the one team-handicap calculation, on the group card and the personal card alike (which kept its own copy of the stroke-basis list — now the shared type). Test: a team whose first player is 24.8 shows its 9 team strokes, not 25 — fails on 212.0.

**The line-up card shows a scramble's teams** — the method in setup's words, each team with its players and team handicap, each player's "course hcp × % = counts" under USGA (with the game's own percentages and each team's own size), "agreed" under agreed handicaps, the captain under captains only, grouped by match for team v team. No individual playing handicaps.

**The live scorecard shows a card per team** — hole-by-hole gross, the team's strokes, net and the team handicap — instead of empty player cards; the leaderboard and the cards share one calculation.

0211: get_live_lineup carries the scramble settings (method, percentages, captains only); get_live_scorecard adds captains only. Both stay public by token.

Deploy: staging 0211 → code; production 0211 → merge.

---
Entries before 212.0 are archived in docs/history/DEPLOY_NOTES_through_211.md (Nov 17, 2026 housekeeping).
