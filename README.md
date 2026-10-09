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
