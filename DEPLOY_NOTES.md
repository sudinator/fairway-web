## 177.80.260822 — Bottom nav sits flush; the geometry guard made to actually evaluate
- **NO migration. Layout + CI only.**
- **FIX: the nav floated ~34px above the bottom of the app.** 177.79 sized the shell to the VISIBLE
  viewport (`--app-h` = 894 on a notched iPhone), which already ends above the home indicator — the
  glass is 956 and the indicator sits in that strip. The nav then reserved
  `env(safe-area-inset-bottom)` again on top of that, counting it twice. Its padding is now a flat
  4px, which with the button's own padding leaves 8px below the labels on every profile.
- **A third wrong height was caught before shipping.** Reasoning from the device numbers I changed
  the shell to `calc(var(--app-h) + env(safe-area-inset-top))`; the guard failed it immediately
  with the same "+62, labels clipped" as the original `100lvh`. Two constraints hold at once — the
  nav must not exceed the visible viewport AND must not stop short of it — which pins the height to
  exactly `--app-h`. The gap was never the shell height.
- **The guard that should have caught all this had two holes, both the shape this series keeps
  hitting — a check that passes because it never evaluated the thing it claims to verify:**
  - It matched the shell height as a STRING for `"lvh"`. `calc(var(--app-h) + env(...))` contains
    no "lvh" and sailed through while being wrong in exactly the same way. The height is now
    EVALUATED per device profile, and an expression it cannot parse is a hard failure rather than
    a silent pass.
  - `slack = gapBelowLabel - safeBottom` forgave reserving the bottom inset inside the nav. That is
    only legitimate where the shell extends under the home indicator; where it is sized to the
    visible viewport it stops above it. The allowance is now conditional on the shell actually
    reaching the glass — without which the exact bug reported after 177.79 passed.
  - The `--verbose` table computed its own figure rather than the one the assertion uses, so it
    displayed -26 while the check reasoned about 8. A display that disagrees with the verdict makes
    a wrong value look reassuring. It now prints the same expression.
  Negative-tested against every wrong value this episode produced — `100lvh`, `--app-h + safeTop`,
  a deliberately short shell, and the double-reserved nav inset. Before these fixes it caught one
  of the four; it now catches all four.
- **The guard was reading the wrong `gap`.** Its pattern matched the first
  `alignItems: "center", gap: N` anywhere in home.tsx — an unrelated flex row 200 lines above the
  nav, with `gap: 10` against the nav button's `gap: 3`. The height model had therefore been
  running on an input 7px too large the entire time: wrong input, confident output. Every value the
  guard reads is now anchored to the nav button's own declaration, and the other four reads were
  audited to confirm they already were.
- **That correction exposed a 43px tap target**, 1px under Apple's 44pt minimum and invisible while
  the model was wrong. The button padding has to stay "4px 10px" to remain on the documented
  scale — check-design-scale.py rejected "5px 10px", correctly — so the pixel comes from the
  icon/label gap instead, which is not scale-governed. Tap target 44px on every profile, nav
  content 48px against Apple's own 49pt tab bar, and 8px below the labels throughout.
- **I built the same guard twice.** `ci/check_shell_layout.py` was written before noticing
  `ci/check_shell_geometry.py` already existed. The pre-existing one is a superset — six device
  profiles to four, it also checks tap-target height, and it needs no browser at runtime, so it
  cannot silently skip where Playwright is absent. The duplicate has been deleted rather than left
  to drift.

## 177.79.260822 — Installed app: bottom nav labels were clipped off-screen
- **NO migration. One CSS declaration.**
- **FIX: the installed app showed bare icons in the bottom nav; the browser showed labels.** Same
  version, same code. `.app-shell` was `height: 100lvh` in standalone, on the documented
  assumption that "iOS gives a stable full-glass viewport". It is stable — but on a notched iPhone
  **100lvh measures the whole screen INCLUDING the strip behind the status bar**, while the shell
  is already pushed down by `padding-top: env(safe-area-inset-top)`.
  Measured on device via the built-in ViewportDiag:
      innerHeight / docClientH / visualVP_h   894      the visible viewport
      100lvh                                  956      = 894 + safe-area-inset-top (62)
      navTop / navBottom                      859/956
      navBottom_vs_visible                    -62      <- the nav ran off-screen
  `.app-shell` is `overflow: hidden`, so that 62px was silently clipped. The nav is the last child
  and its LABELS sit below its icons, so only 35px of a 97px nav was visible — enough for the
  icon, not the text. In a browser `safe-area-inset-top` is 0, so the bug could not occur there,
  which is why two identical builds looked different.
- **The correct height was already being measured.** `--app-h` (set by ViewportSync) reported
  894px and `100dvh` 893.98 — both matching the visible viewport. The standalone media query was
  discarding a correct value in favour of an incorrect assumption. Both contexts now use
  `var(--app-h, 100dvh)`. The rule is kept rather than deleted so the reasoning survives and
  nobody reinstates `100lvh`.
- The file's header comment documented the wrong model and has been rewritten with the measured
  numbers.
- **Two follow-on effects of the shorter shell, both checked and fixed:**
  - The **More menu** subtracted a flat 96px for the nav in its `maxHeight`. The nav actually
    measures 97, so the menu could ask for 1px more than the space above it — masked until now by
    the 62px of slack the over-tall shell provided. It now subtracts both safe-area insets and the
    nav's real height, leaving a deliberate 16px gap below the status bar. Verified with the menu
    open at device dimensions: menu top 405 against a 62px inset, not clipped.
  - `components/viewport-sync.tsx` documented the removed override and claimed `--app-h` was "only
    consulted in the browser". It is now load-bearing in both contexts; the comment says so.
- Everything else that reads a viewport unit was checked: `auth.tsx` and `organizer.tsx` use
  `minHeight: 100vh` but are ordinary scrolling pages outside the shell, so the extra height
  scrolls rather than clipping. `ui.tsx` notes that BottomSheet is positioned rather than sized by
  height math, so it is unaffected by design.
- **`navBottom_vs_visible` in ViewportDiag is the permanent check**: if it is ever negative again,
  the shell is taller than the viewport and something at the bottom is being cut off. It was
  already computed and already displayed — it named this bug precisely, once someone looked.

## 177.78.260820 — Achievements wall: alignment, redundant badges, and an assertion ratchet
- **NO migration. No schema change.**
- **FIX: badge discs sat at different heights on the Achievements tab.** A `<button>` vertically
  centres its own content, and CSS grid stretches every cell to the tallest in its row — so a badge
  with only a label ("First birdie") centred and dropped below one that also shows a count and a
  best value ("Birdie x9 / best 2"). Fixed in `achievements.tsx` with an explicit top-aligned flex
  column, the same fix already applied to `round-detail.tsx`. `player-card.tsx` is top-aligned too
  as a precaution, though it uses `<div>` and was never affected.
  **This was NOT a regression:** `achievements.tsx` had only ever had its COLOURS changed. The
  earlier fix went into `round-detail.tsx`, a different screen. Two grids, one fixed.
- **FIX: "First birdie" showed beside "Birdie x9".** Once several exist, the separate tile is
  noise. It is now hidden, and the date is NOT lost: `first_earned_at` is already stored on every
  badge row, so the count badge's detail reads "First on 14 Jun". Kept when there is genuinely only
  one, because then the "first" IS the achievement. `first_round` is never hidden — it is a
  milestone with no counting sibling.
- **FIX: an 83 credited Broke 100, Broke 90 AND Broke 85.** Each counter is factually correct — the
  round is under all three — but three tiles reading x9 tell you nothing the hardest one does not.
  The wall now shows only the hardest threshold earned. **Unearned harder badges stay visible** as
  targets, which is the point of a wall. Stored counts are untouched, so this is a display rule and
  reversible without recomputing anything.
  The round view (`collapseRoundAwards`) and the player card (`BROKE_CHAIN`, `CARD_EXCLUDE`) had
  both done this for a long time. The wall was the only screen that never did.
- **NEW `ci/check_test_assertions.py`** — ratchets the assertion count per suite, failing if any
  suite verifies LESS than it did. Baseline: **1,252 assertions across 20 suites.**
  This exists because of a mistake made while writing the badge tests above: 11 assertions were
  appended AFTER the file's report line, so the suite printed its old total and could not fail the
  build. It was caught only by deliberately sabotaging the code and noticing the tests still
  passed. That is the fourth "reports success having checked nothing" failure found in this
  series — after the GolfCourseAPI monitor that had never run, the VAPID check that skipped on a
  missing key, and a contrast check that passed its own bug. Negative-tested against both shapes:
  reproducing the exact bug reports "badges: 75 -> 64 (11 fewer)", and deleting a test is refused.
- `lib/badges.test.ts` 64 -> 75 assertions; sabotaging `visibleWallBadges` correctly fails three.

## 177.77.260820 — Error messages: Safari's wording, and 58 raw-provider leaks
- **NO migration. No schema change.** Follows 177.76, found by testing it in airplane mode on a
  real iPhone within minutes of shipping.
- **FIX: the network-failure detection only matched Chrome.** Safari — so every iPhone — words a
  dropped connection as **"Load failed"**; Chrome says "Failed to fetch"; Firefox says
  "NetworkError when attempting to fetch resource". Matching only Chrome's phrasing meant an
  iPhone user in airplane mode fell through to the generic "Try again" with no explanation of
  why. All five wordings are now matched AND pinned in `lib/errors.test.ts`, so the same gap
  cannot reopen for another engine.
- **FIX: 58 places showed the user the provider's raw message.** These predate the mapping and
  were never in the 64 silent writes, because they DID check the error — they just printed
  "TypeError: Load failed", which names no cause and no action. All 58 now route through
  `failureMessage()`, so every one gains plain advice and a quotable error code. **0 remain.**
- The ProfilePanel handicap save was one of them: it had its own inline gold status line, a third
  error style alongside `alert()` and the toast. It now uses the same mapping as everything else.
- Descriptions derived from the enclosing function name were hand-corrected where they read
  badly — "Couldn't admin power users" and "Couldn't ops metrics" are not sentences a user should
  see. Every generated string was reviewed by eye, not assumed.
- `lib/errors.test.ts` 15 -> 24 assertions. Negative-tested: reverting to Chrome-only matching
  fails the suite on the Safari case specifically.

## 177.76.260820 — Failed database writes are no longer silent
- **NO migration. No schema change.**
- **The app had 64 writes that never inspected their error.** Most were deliberate and are left
  alone: a notification mark-read that self-corrects on reload does not need an alert, and the
  `group_activity` inserts are already wrapped with "logging never blocks the action", which is
  the right call. **Scores were never at risk** — they go through a durable outbox with a per-row
  synced watermark and retry on reconnect, foreground, poll and manual sync.
- **Fixed the 11 where silence was not defensible:**
  - **Writes followed by a LOG or NOTIFY (3).** `toggleVetted` wrote "Amit vetted Berkshire Valley"
    to the activity log whether or not the update landed; `restoreCourse` told a member their
    deleted course was restored when it had not been. The evidence became wrong, not just the
    state. The log/notify no longer runs on failure, and in the delete cascade the activity entry
    moved AFTER the deletes it describes.
  - **The permanent-delete cascade (5).** Five deletes in sequence, unchecked: a failure partway
    left the player's rounds gone, the log claiming a permanent delete, and the profile still
    present, with no error. Now stops at the first failure and names both the step that failed and
    the steps already completed. It still cannot roll back — making it atomic needs the cascade
    moved into a Postgres function, recorded in BACKLOG.
  - **Handicap writes (3).** A handicap that silently fails to save changes every net score
    recorded afterwards, and the optimistic UI gave the player no reason to doubt it.
    `home.tsx saveIndex` now reverts the on-screen value to match the database. `organizer.tsx
    setIndex` had `try { } finally { }` with no catch, which does nothing for a Supabase failure —
    those RESOLVE with `{ error }` rather than throwing — so it was silent while also clearing the
    draft, making the typed value vanish on reload.
- **Messages say what to do, not what went wrong internally.** The first draft surfaced the raw
  provider text ("new row violates row-level security policy"), which serves a developer and means
  nothing to a golfer. `lib/errors.ts` now maps a failure to plain advice plus a quotable error
  code, and **the advice changes with the cause**: a permission failure says "ask a group admin"
  and deliberately does NOT say "try again", because retrying is pointless; a dropped connection
  says exactly the opposite. Codes are the real Postgres/PostgREST ones where they exist (42501,
  23505, 23503, 23502, PGRST116) so they are searchable; only NET, AUTH and BNN-UNK are ours.
- **NEW `lib/db-write.ts`** — `write()` for a single statement, `writeAll()` for a sequence that
  must not half-apply. Both surface through the existing `notifyError` toast, whose own comment
  already stated the purpose: "so a failed database write becomes VISIBLE instead of a silent
  no-op". It was used 7 times against 70 `alert()` calls; `lib/errors.ts` existed and was used in
  ZERO components. Both were built and never adopted; this drop adopts them rather than adding a
  third mechanism.
- **NEW `lib/errors.test.ts`** — 15 assertions, including a regression test that the raw provider
  message never reaches the toast.
- Silent writes 64 -> 53. The remaining 53 are the deliberate ones.

## 177.75.260820 — Course library sorted; format-block message names the way out
- **NO migration. No schema change.** Includes the 177.74 VAPID work, folded in as agreed.
- **FIX: the course library had no ordering at all.** `loadCoursesForGroup` queried
  `favorite_courses` with no `ORDER BY`, so Postgres returned rows in whatever order it found
  them — not stable between loads. It was not a scheme nobody had spotted; there was no scheme.
  Now sorted alphabetically by name, matching the player list, which has sorted by `display_name`
  with the same collation since it was written.
  The sort runs AFTER group overrides are merged, because an override can rename a course —
  ordering in SQL alone would fall out of alphabetical order the moment a group renames one.
  One change covers every surface: New Round, Create Game, Manage Game, the scorecard views and
  the share card all read through the same loader. The admin "All App Courses" list already had
  `.order("name")`; the group library was the outlier.
- **NEW `lib/courses-order.test.ts`** — 4 assertions that call `loadCoursesForGroup` through a
  stubbed Supabase. An earlier draft pinned a copy of the comparator instead, which passed whether
  or not the function used it; removing the sort was confirmed to fail this version.
  `lib/courses.ts` now imports its sibling relatively rather than via the `@/` alias, which the
  repo's test runner cannot resolve — that is what made the module untestable.
- **The format-change block now names the way out.** Changing a team format to an individual one
  after scoring has started is correctly refused: in a team format a hole's score belongs to a
  PAIR (best ball or aggregate), so reading those same numbers as individual Stableford would
  silently change what each entry meant when it was typed. The message explained the constraint
  but offered no route forward. It now states both: clear every score and change the format, or
  leave the game and create a new one. It also notes that changes WITHIN a family are still
  allowed. Behaviour is unchanged — only the message.
- **FOLDED IN FROM 177.74:** the VAPID drift check now fails on an absent key instead of exiting 0
  with "comparison skipped", CI supplies the key so the comparison actually runs, and
  `ci/check_vapid_contract.py` asserts the checker cannot regress to skipping. Corrected framing:
  the Vercel build already performed this comparison correctly; the hole was that deleting the
  variable would have produced a green build that verified nothing.
- **BACKLOG.md** records the designed-but-unbuilt admin system-health notifications.

## 177.74.260820 — VAPID drift check: absence is now a failure, not a skip
- **NO migration. CI and build-script only.** No application code changes.
- **Correcting an earlier characterisation:** the VAPID key check was described as "skipping in CI,
  so push could break silently". That was overstated. `prebuild` runs automatically before `build`,
  so the Vercel build — where the environment variable IS set — already performs the comparison and
  fails on a mismatch. That protection was working.
- **The real hole was narrower.** `scripts/check-vapid-key.mjs` exited **0** with "comparison
  skipped" when `NEXT_PUBLIC_VAPID_PUBLIC_KEY` was absent. So deleting the variable from Vercel
  would have produced a GREEN build that verified nothing, and push notifications would then fail
  at runtime with nothing having flagged it. Absence of the input is a failure of the check, not a
  pass — the same shape as `GOLF_API_KEY`, which sat unset for months while its workflow reported
  nothing wrong.
- **Absent key now exits 1**, with a message naming the expected value and the three places it can
  be set. `VAPID_CHECK_OPTIONAL=1` is an explicit opt-out for local builds only; CI and Vercel must
  never set it. All four paths verified: matching key 0, mismatched 1, absent 1, absent+opt-out 0.
- **CI now supplies the key** so the comparison actually runs there, sourced from the repository
  VARIABLE `vars.NEXT_PUBLIC_VAPID_PUBLIC_KEY` — deliberately a variable, not a secret, because a
  VAPID public key ships to every browser in `public/sw.js` and is not confidential. Making it
  readable is the point: an unreadable value is exactly what made `GOLF_API_KEY` unrecoverable.
  Falls back to the committed `sw.js` value if the variable is unset, so a missing variable cannot
  block CI.
- **`ci/check_vapid_contract.py` extended** to assert that the checker fails rather than skips, and
  that CI supplies the key. Negative-tested: restoring the silent skip fails the guard.
- `.env.example` documents `VAPID_CHECK_OPTIONAL`, caught by the existing env-hygiene guard.
- **BACKLOG.md** records the designed-but-unbuilt admin system-health notifications: a course-count
  threshold and a heartbeat dead-man's switch for the weekly contract monitor.

## 177.73.260820 — Three display fixes; GolfCourseAPI monitor repaired
- **NO migration. CI and docs only.** No application code changes.
- **The weekly monitor has never run successfully.** `GOLF_API_KEY` was set in Vercel for the app
  but never added as a GitHub repository secret, so every scheduled run since the workflow was
  added has failed at the first line. Adding the secret then exposed a second, real defect.
- **FIX: the monitor exceeded the provider's rate limit.** It makes 31 requests (13 searches +
  18 detail lookups) and fired them back-to-back, returning HTTP 429 about a third of the way
  through. Now paced at 400ms between calls with exponential backoff on 429, honouring
  `Retry-After` when present. A full run takes ~20-25s, irrelevant for a weekly job.
- **FIX: the alert issue sent readers after the wrong problem.** Any failure produced "Check
  provider ids, search/detail response shape, required fields..." — so a missing secret looked
  like an API change. Exit codes now distinguish them: **1 = contract drift** (the provider really
  did change), **2 = monitor problem** (missing key, rate limit, outage). The issue body reports
  the right one, and for a monitor problem says explicitly "this is NOT evidence that the contract
  changed" and "do NOT change application code for this".
- 401/403 now reports that the key was rejected and names both places it must be updated.
  5xx retries as a provider outage rather than failing immediately.
- **All five paths verified offline** with a stubbed `fetch`: missing key, 401, 429, 5xx and real
  drift each produce the right exit code and message.
- **THREE DISPLAY FIXES, spotted on device:**
  - **Badge grid alignment.** The badges-earned grid was `display:flex` with `flexWrap` and fixed
    74px cells, so each wrapped row took the height of its tallest label — a one-line label
    ("Birdie") left its disc at a different vertical position from a three-line one ("Best
    differential / new record"). Now a 4-column grid with cells top-aligned, so every disc lands
    on the same line regardless of label length.
  - **Club member rows had no boundary.** The row background was `C.greenLight` and so was the
    panel behind it — **1.00:1, the same colour** — so members read as one undifferentiated list
    with no card and no divider. Rows are now `C.greenMid` on a `C.borderGreen` outline. Same
    family as the border work at 177.65; this one escaped because both sides are legitimate
    tokens, so nothing looked wrong in source. The `Make admin` / `Remove` pair is now grouped in
    a non-shrinking flex box: as bare flex children behind a 190px name field, `Remove` dropped
    onto a line of its own on a phone.
  - **Badge count pill clipped.** The `×2` / `×3` pill sits at `top: -4` so it straddles the disc
    edge, inside a strip declaring `overflowX: "auto"` for horizontal scrolling. **A scroll
    container clips BOTH axes** — CSS has no way to scroll one direction and spill the other — so
    the pill lost its top 4px. Fixed with 6px top padding on the scroller rather than
    `overflow: visible`, which would have disabled the horizontal scroll. Only badges earned more
    than once have a pill, which is why it appeared intermittent. Every other `overflowX:auto`
    containing a badge was checked; this was the only one.

- **HANDOFF.md now records that `GOLF_API_KEY` lives in THREE places** — Vercel (app), GitHub
  secret (monitor), password manager (recovery) — with the reason. The key set in June was
  unrecoverable: Vercel marks it Sensitive and write-only, and GolfCourseAPI does not display an
  existing key. Documenting this is what stops it recurring.

## 177.72.260820 — Overlays: a scroll no longer closes the sheet
- **NO migration. Cosmetic + CI only.**
- **FIX: four overlays closed when a scroll gesture ended on the backdrop**, discarding whatever
  the user was entering. The failure is subtle: `onClick` fires on whatever sits under the finger
  when it lifts, so a scroll that starts inside the panel and drifts onto the scrim registers as a
  backdrop tap. `stopPropagation` on the panel does not help — the click target really is the
  backdrop. Affected: the hole score sheet (`ui.tsx`), the share modal (`share-card.tsx`, 2 sites),
  the player card (`player-card.tsx`) and the end-game confirmation (`tournaments.tsx`).
- **NEW `backdropDismiss()` in `ui.tsx`.** Requires that the gesture BEGAN on the backdrop and that
  the finger travelled less than 10px. `BottomSheet` avoids the problem structurally by putting the
  scrim in a separate sibling div; these four wrap the panel inside the scrim, and this makes that
  shape safe without restructuring them.
- **Verified by execution, not inspection.** Four new assertions in `lib/release-check.test.tsx`
  dispatch real pointer events: a clean backdrop tap closes; a scroll starting in the panel does
  not; a drag across the backdrop does not; a click inside the panel does not. Negative-tested —
  reverting to the naive `onClick` fails three of the four.
- **Safe-area padding added** to the share modal and player card, which lacked it. Without it a
  full-screen overlay can place its content under the notch or the home indicator.
- **Two of the eight "hand-rolled overlays" were false positives** and are left alone: `ui.tsx:211`
  is `BottomSheet` itself, and `home.tsx:944` is a bare click-catcher behind a menu, not a panel.
  A third, `ui.tsx:44`, is the avatar photo lightbox — a different pattern from a sheet, and
  correct as written.
- **Share-card PNG export reviewed.** No action needed: the card uses only system fonts (Georgia,
  `-apple-system`) so there is no webfont to inline, contains no remote images to fetch, and falls
  back to "Copy as text" on failure. Every colour inside the exported card measures 5.16:1 or
  better against `C.green`.

## 177.71.260820 — Tap targets: 30 buttons too small to hit reliably
- **NO migration. Cosmetic + CI only.** Vertical padding only — horizontal is untouched, verified
  line by line, so nothing got wider and nothing can wrap.
- **30 buttons rendered under 24px tall.** The worst was an 18px band around 11px text
  (`manage.tsx` delete-stale). Apple's HIG minimum is 44pt; under ~24px is a miss-and-retry on a
  phone, one-handed, outdoors — which is how this app is used. All 30 now render >= 32px.
  One was correctly excluded: the course-library star toggle sits in an `alignItems: "stretch"`
  row and already fills the row height.
- **The 152 buttons in the 24-31px band are left alone.** Tight but hittable. Standardising them
  would move layout across the app for a benefit nobody would feel.
- **The wider padding scale is NOT being pursued.** 161 padding values remain 161. Analysis showed
  it is a cross-product of two axes rather than 161 arbitrary strings, so a 5x5 or 6x6 scale would
  collapse it to 20-31 combinations with 454 of 508 sites moving only 1-2px. That is invisible: it
  would be 508 sites of layout risk, with no component test harness, for a change no user could
  perceive. Ratcheted so it cannot get worse; not collapsed. Reasoning recorded in DISPLAY_RULES.
- **NEW `ci/check_tap_targets.py`** — fails the build if a button drops below 24px estimated
  height. Height is fontSize * 1.25 + 2 * vertical padding; buttons inside a `stretch` container
  are skipped because they fill the parent. Negative-tested. Baseline is 0.

## 177.70.260820 — Release verification, and the eight bugs it found
- **NO migration. Cosmetic + CI only.** Supersedes the 177.69 candidate, which was packaged but is
  incomplete.
- **NEW `ci/verify_release.py`** — 20 assertions that every agreed fix from 177.59 onward is still
  in place: both `undefined`-override fixes, the weight and radius scales, `C.field`, the
  `color-scheme` declaration, no mangled token names from scripted edits, and the version ledger.
  Wired into `npm run guards`, so a later release cannot silently undo an earlier one.
- **NEW `lib/release-check.test.tsx`** — 18 assertions that EXECUTE the changed components rather
  than reading source. This is the layer that would have caught the 177.68 blue buttons: the static
  checks confirmed the file said what was claimed, but only rendering shows the colour is wrong.
- **The first version of the C.birdie check silently passed its own bug.** It resolved the
  background with a 900-character lookback — the same proximity heuristic responsible for several
  misses in this series. Rewritten to walk the JSX ancestor chain, it failed immediately and then
  found **8 more sites** the button-scoped pass at 177.69 had missed:
  `organizer-panel.tsx` 1063/1097/1098, `scoring-views.tsx` 642, `manage.tsx` 1274/2224,
  `money.tsx` 1027. All `C.birdie` on a green surface at 1.42:1, most inside ternaries — which is
  precisely what proximity matching cannot see. Now `C.overRedDark` at 4.91:1.
- Both new checks were NEGATIVE-TESTED: each bug was deliberately reintroduced and confirmed to
  fail the suite, then reverted. A check that cannot fail is decoration.
- Total destructive-action sites corrected across 177.69 and 177.70: **44**.

## 177.69.260820 — Destructive actions made visible; a bad token map reverted
- **NO migration. Cosmetic + CI only.**
- **FIX: 36 destructive actions were effectively invisible.** Every ghost-styled Delete, Ban, Wipe
  and Remove used `C.birdie` as its text colour — a CREAM-surface token measuring **1.42:1** on a
  green card. Now `C.overRedDark` at 4.91:1, across 10 files. Same failure mode as the score
  colours fixed at 177.65: a colour correct for a cream surface, stranded when 177.62 turned that
  surface green. Filled danger buttons already used `C.danger` and are unaffected.
- **FIX: six success buttons were turned blue by 177.68.** "Mark settled" and the payment confirms
  used `#7FD6A3` (mint). 177.68 mapped that literal to `C.underDark` — but `C.underDark` was
  `#7FD6A3` only until 177.66, when it was lifted to `#A3C6F5` to clear a contrast near-miss. The
  map matched the OLD value, an 82-point channel shift, on the buttons that confirm money has been
  paid. Reverted to `#7FD6A3` and allowlisted with the reason.
  The gates could not catch this: `#A3C6F5` with dark text is 8.9:1, so it passed every contrast
  check. It was readable — it just meant the wrong thing. Found only because the change was
  questioned.
- **Lesson recorded in the guard comments:** a token's value can change after code maps a literal
  onto it. Map to a token by MEANING, not by matching its current hex.
- 21 bespoke button fills converted to tokens at 177.68 remain; the other 15 stay documented as
  exceptions in DISPLAY_RULES with reasons.

## 177.68.260820 — Button fills to palette tokens
- **NO migration. Cosmetic + CI only.** No layout change: only fill colours move, and every one
  moves to a token within a few RGB steps of the value it replaces.
- **21 bespoke button fills converted to palette tokens.** `#173a2c`, `#0f3529`, `#14351f`,
  `#123528` -> `C.green`; `#16503D` -> `C.greenMid`; `#C9A227` -> `C.gold`; `#7fd6a3` ->
  `C.underDark`; `#5a2018` -> `C.danger`. Off-palette button fills 36 -> 15.
- **15 kept and documented as exceptions**, with reasons, in DISPLAY_RULES and in the palette
  guard's allowlist: three payment brand marks (Venmo, PayPal, Zelle) that cannot be recoloured
  without misrepresenting the service; one in the orphan `nav-debug.tsx`; a success green used by
  three admin-only buttons; four amber caution washes; and three conditional fills in `money.tsx`
  that sit inside ternaries paired with matching text colours, where snapping risks breaking a
  correlated pair for no visible gain. None is a contrast failure — each was measured.
- **The "174 ad-hoc buttons" figure in earlier notes was misleading** and is corrected here.
  Properly categorised: 307 already use `btn()`; 67 have bespoke fills; 66 are real ghost buttons;
  24 map cleanly to a role; and **12 are structural wrappers** — `<button>` around a whole card or
  selector tile, unstyled because the child provides the layout. Applying `btn()` to those would
  break them. They are correct as written and are now documented as excluded.
- No call sites migrated to `btn()` in this drop. The 66 ghost buttons remain outstanding: their
  padding is currently sized to fit tight spaces, so standardising it will move layout and needs
  reviewable batches rather than a sweep.

## 177.67.260820 — Geometry: weight scale, radius scale, button roles
- **NO migration. Cosmetic + CI only.**
- **Font weight: 6 values -> 3.** 500 body / 700 emphasis / 800 title, with 500 set as a base on
  `body`. 1,098 pieces of text declared a `fontSize` and no `fontWeight`, inheriting the browser
  default of 400; only 11 explicit 400s existed, so this is one CSS rule rather than a migration.
  500 rather than 400 because light strokes optically thin out on a dark background, which made
  11-12px secondary text harder to read than it needed to be. 800 kept for titles rather than
  stepping down to 700 — the app uses it 457 times and it is what holds a title against the green.
- **Corner radius: 20 values -> 6.** `999` pill, `14` sheet, `12` card, `10` control, `8` compact,
  `6` tag. 108 sites snapped to their nearest neighbour, none moving more than 4px. `r20` (x6) and
  `r24` (x1) swept to 14 by decision.
- **`btn()` extended to four roles and two sizes** — `primary`, `secondary`, `ghost`, `danger` x
  `standard`, `compact`. **Additive only: no call site changed.** The boolean form still works and
  all 243 existing calls are untouched.
  The reason matters: of 172 hand-rolled buttons in 129 distinct shapes, **86 were ghost buttons**
  — transparent, text-only — a role `btn()` never offered. People were not being careless; there
  was nothing to reach for. Migrating those 86 will move layout, so it is deliberately separate
  work to be done in reviewable batches.
- **DISPLAY_RULES Part 5 rewritten from measurement.** Three of its four scales were written from
  theory before anything was counted, and all three were wrong. The radius scale alone would have
  changed 278 sites AWAY from values the app already used consistently. Font size and padding are
  now explicitly NOT prescribed, with the reasoning recorded: enforcing the documented type scale
  would have resized body text across 759 sites, and padding has 161 values with no dominant
  cluster and a real risk of moving layout.
- `ci/check-design-scale.py` updated to the measured scale.

## 177.66.260820 — Conditional-style pairing, and the bugs it uncovered
- **NO migration. Cosmetic + CI only.** Follows 177.65, which is already deployed.
- **Why this is a separate version:** 177.65 was packaged, deployed, and then extended. Shipping
  the extended set under the same number would have meant two different builds both reporting
  177.65 in Help. The version-ledger guard cannot catch this — it checks package.json against
  DEPLOY_NOTES, and both agreed. It has no way to know what is already live.
- **The contrast checker now pairs conditional styles by their shared CONDITION.** It previously
  cross-multiplied every text colour against every background, so a chip whose background and
  label both flip on `selected` was reported as failing for combinations that never render —
  (gold, cream) and (green, dark) when only (gold, dark) and (green, cream) exist.
- **It also stops attributing text to an ancestor when the element's own background is a variable
  it cannot resolve.** The dashboard bar labels sit on the bar, not on the card behind it.
- **Removing that noise exposed real defects that had been hidden in it:**
  - five near-identical error reds (`#FB7185`, `#EF9D90`, `#E8A199`, `#F3A3A0`, `#F0A99F`) all
    short of 4.5:1 on green, now one token
  - `C.faint` (a cream-surface token) used as text on green in money.tsx
  - `C.indivDot` at 3.18:1, lifted to 4.72:1
  - the sand marker `#E8730C` at 2.68:1 on a light wash
  - white on the mid-green confirm button at 4.11:1
- **Contrast end to end: 523 sub-threshold sites at 177.58 -> 25.** The residual 25 were each
  inspected by hand: 2 PayPal/Venmo brand fills that cannot change, several nested correlated
  ternaries where both real states are fine, and near-misses at 3.7-4.4:1. None is unreadable.

## 177.65.260820 — Visual states audit: opacity, SVG, borders, shadows, native controls, focus
- **NO migration. Cosmetic + CI only.** Completes the surface migration by auditing the seven
  categories that background and text colour alone never covered.
- **Runtime-computed colours: 21 of 33 combinations were failing, now 0.** Helpers like
  `ptsColor()`, `colorFor()`, `relCol` and the achievements hole chips return a fixed set of
  values, so their range is enumerable even though a static scanner cannot read them. Every one
  had been tuned for a cream surface and left at 1.26-2.27:1 when those surfaces flipped in
  177.62. The achievements chips were the worst in the app at 1.26:1 — every possible state
  unreadable. NEW `ci/computed_colour_matrix.py` checks all 33 combinations on every build.
- **Disabled controls:** eight different opacity values (0.3-0.85) collapsed to one, 0.62. At 0.3
  and 0.4 a control did not read as disabled, it read as broken. WCAG exempts disabled controls
  from contrast minimums, so this is legibility rather than compliance.
- **SVG:** `player-card` FormChart carried the OLD `C.faint` (#8B8775) and OLD `C.sage` (#A9C4B5)
  frozen into `fill=` attributes, which no `color:` scanner reads. Axis labels measured 2.24:1 on
  the green panel. Now `C.sage`; the series red lifted for a dark ground.
- **Borders: 103 below 1.7:1, triaged by PURPOSE not by value.** 5 deleted as redundant (the
  surface change already gave >=3:1), 93 raised so the edge is visible, 5 lifted to 3:1 because
  they communicate state. Two of those five were real bugs: the SELECTED course row and
  destructive controls were both effectively invisible at 1.34:1 and 1.42:1.
- **Destructive actions: five treatments collapsed to one.** Two outline variants, bare red text,
  `#7A2F28` and `#5A1E1E` all become `C.danger` with `C.cream`. The three outline-only ones did
  not read as buttons at all. `C.dangerEdge` is added for the two that sit directly on `C.green`,
  where the fill alone is 1.03:1.
- **Selection rings** to full-opacity `C.gold` (1.34 -> 3.34:1). At .25 a selected item was marked
  by a smudge.
- **Box shadows:** black drop shadows do almost nothing on a dark page — `rgba(0,0,0,.45)` is
  3.36:1 on white but 1.37:1 on `C.green`. The inert card shadows are removed; the raised border
  now carries elevation. 22 distinct shadow values collapse to 3.
- **Native controls:** `color-scheme` was never set, so iOS chose light or dark from the USER'S
  phone setting — the same screen rendered differently for different people. Now declared light,
  matching the cream fields. `accent-color: C.gold` globally; it had been set at exactly one of
  two checkboxes, leaving the other iOS system blue. The one date input on a dark surface now
  matches the other three (iOS draws the value text, so cream was never guaranteed).
- **Focus:** nothing removed the outline, so keyboard and Switch Control users were never
  stranded — but the browser default is system blue at 2.01:1 on a green card, and which blue
  depends on the browser. A two-tone `:focus-visible` ring replaces it; no single colour clears
  3:1 everywhere, so cream outer plus dark inner covers gold buttons (6.75:1) and green cards
  (7.29:1) alike.
- **Dashboard stat bars** had `C.cream` labels on light fills — 1.57:1 at worst. Now `C.green`.
- **Contrast, end to end: 523 sub-threshold sites at 177.58 -> 25.** The residual 25 are: 2 PayPal/
  Venmo brand fills (allowlisted, cannot change), several correlated ternaries where background and
  text flip on the same condition but sit on different elements, and a handful of near-misses at
  3.7-4.4:1. Each was inspected by hand rather than assumed.
- **The checker now pairs conditional styles by their shared CONDITION.** Previously it
  cross-multiplied every text colour against every background, reporting combinations that can
  never render — a chip whose background and label both flip on `selected` only ever paints
  (gold, dark) or (green, cream), never (gold, cream). It also no longer attributes text to an
  ancestor when the element's own background is a variable it cannot resolve; the dashboard bar
  labels sit on the bar, not the card behind it.
- Error reds unified: `#FB7185`, `#EF9D90`, `#E8A199`, `#F3A3A0`, `#F0A99F` were five
  near-identical values all short of 4.5:1 on green. Now one token.
- **NOT done:** the share-card PNG export. `html-to-image` rasterises separately from the on-screen
  render, so it needs verifying against a real generated image with real data rather than by
  static analysis.

## 177.64.260820 — Fix: surfaces and text 177.62 missed
- **NO migration. Cosmetic + CI only.** Completes the 177.62 surface migration.
- **Root cause: every scanner I wrote matched the LITERAL form and treated "no match" as "nothing
  there".** `color: C.faint` matched; `color: cond ? C.faint : C.green` did not. `background:
  C.card` matched; `background: sel ? C.cream : C.card` did not. In a codebase where conditional
  styling is common this silently excluded a large fraction of reality while reporting a clean
  pass. Three separate defects, one habit.
- **123 conditional colour expressions** were never examined by `check_resolved_contrast.py`. One
  of them shipped "G1 2 UP" as `C.green` on a `C.greenLight` card — 1.54:1, effectively invisible.
  The guard now evaluates BOTH branches of a ternary.
- **19 conditional light surfaces** were never inventoried, which is why Courses went green while
  New Round and Create Game kept white course pickers. Now flipped: create-game course rows,
  new-round favourites rows, leaderboard rows, scoring total cards, scoring player cards, the
  admin provider-source panel.
- **`round-setup.tsx` favourites row was misclassified** as the par grid on the line above it.
- **Dark-on-green text fixed at 20+ sites** — `C.green`, `C.ink` and bespoke hexes (`#14351f`,
  `#4a6b54`, `#8a5a12`, `#9a6a12`, `#5a4a12`, `#6B6857`) left behind by the flip because the swap
  map only knew `C.*` tokens.
- **Case-sensitivity, twice.** The tree mixes `#14351F` and `#14351f`; case-sensitive replacement
  matched 2 of 9 sites, the same mistake that made the first flip script miss 14 of 63. Every
  scanner now treats hex as case-insensitive.
- **NEW `ci/style_audit.py`** — resolves literal AND conditional styles and, critically, PRINTS
  every expression it could not parse instead of skipping it silently. A scanner that hides its
  blind spots produces confident wrong answers, which is what happened three times here.
- Guard baselines regenerated from the fixed state, not from the broken one. The 177.62 baselines
  had frozen the defects as "known", so `npm run guards` passed over them.

## 177.63.260819 — Fix: package-lock.json missing from the 177.62 drop
- **CI-only. No application code, no visual change, no migration.**
- 177.62 added four devDependencies for the new component test harness (`jsdom`, `@types/jsdom`,
  `@testing-library/react`, `@testing-library/dom`) but shipped `package.json` WITHOUT the matching
  `package-lock.json`. `npm ci` requires the two to agree exactly and fails hard when they do not —
  "Missing: <pkg> from lock file", exit code 1, before any gate runs.
- Regenerated `package-lock.json` (6,913 -> 7,587 lines).
- **Root cause of the miss:** local verification used `npm install`, which UPDATES the lock file as
  a side effect and therefore always succeeds. GitHub runs `npm ci`, which VALIDATES it. Testing
  with the wrong command hid the defect through a full six-gate verification pass. Verification now
  uses `npm ci` on a clean extract, which is what CI actually does.

## 177.62.260819 — Surface migration: list rows and panels go green
- **NO migration. Cosmetic + CI only.** Builds on 177.61 (same staging base).
- **63 surfaces flipped from cream to green**, from a per-site classification of all 118 light
  surfaces in the app. The rule (APP_RULES #25): cream is scorecards, score entry, editable fields
  and pick-control outlines; green is everything else. Affected: rounds list, games list, course
  library, Manage Game player cards, tee times and RSVP rows, admin panels, contests standings, the
  end-game confirmation, and assorted chrome.
- **174 text colours re-picked** on those surfaces. This is the part that matters: a flipped
  background silently leaves its text on the wrong family — `C.ink` is 1.90:1 on green, `C.faint`
  2.24:1, and `C.green`-as-text 1.54:1. Every one was resolved by walking the JSX ancestor chain,
  then verified by `ci/check_resolved_contrast.py`.
- **Net contrast effect: zero regressions.** 39 sub-threshold sites before, 39 after, and no text
  anywhere on the wrong surface family. Two intermediate states during the work were worse (68 at
  one point) and were caught by the guard, not by review.
- **Editable fields now read correctly.** `C.field` (#EBE3CC) was introduced in 177.61 but sat on
  near-white cards, so two light tones competed. On green the field reads as a filled-in slot,
  which is what the token was for.
- **Deferred 177.61 changes are now correct**, three of them applied automatically by the
  resolver: `vetted ★` and `✓ in your library` -> `C.sage`; Games-list share code -> `C.cream`
  (7.29:1 on green). The course-library star toggle -> `C.gold` when set, `C.sage` outline when
  not; it is a control you act on, so gold belongs there, and `C.line` at 1.49:1 had made the
  empty state nearly invisible.
- **NEW component test harness** — `lib/test-dom.ts`, `lib/test-render.ts`,
  `lib/component-render.test.tsx` (17 assertions). jsdom + React 19 `createRoot` inside `act()`,
  following the repo's existing compile-then-run convention rather than adding a framework. Before
  this, no component in this repo had ever been executed in a test.
- **Correction to an earlier claim:** the conditional `useId()` fixed at 177.59 was described in
  prior notes as a runtime crash. The harness proves it is not — React 19 neither throws nor warns
  in either hook-count direction. It remains a rules-of-hooks violation worth fixing, but it was
  never an outage risk and should not have been characterised as one.
- **Still deferred:** the geometry scales (161 paddings, 21 radii, 20 font sizes, 174 ad-hoc
  buttons) remain ratcheted but not collapsed. 39 sub-threshold sites remain, mostly near-miss reds
  on green (3.8-4.1:1) needing a lighter red token.

## 177.61.260819 — Colour correctness: measured contrast across the whole app
- **NO migration. Cosmetic + CI only.** Supersedes the 177.59/177.60 candidates, which were never
  merged to main; this is built from the same staging base.
- **Sub-threshold text: 523 sites -> 39 (-92%).** Measured by resolving each text colour against the
  background its JSX ancestor actually paints, then applying WCAG 2.1 (4.5:1 normal, 3:1 large).
- **Two token changes fix 405 of them.** `C.faint` #8B8775 -> #676253 and `C.sage` #A9C4B5 ->
  #B2CBBD. These are the app's default secondary-text colours; both were marginally under the floor
  everywhere they appeared (3.55:1 on cream, 4.33:1 on green) because they were chosen by eye.
- **62 wrong-family sites corrected** — `C.faint` (cream-surface text) sitting on green at 2.24:1,
  and `C.sage` (green-surface text) sitting on cream at 1.83:1.
- **NEW `C.field` #EBE3CC + `C.fieldLine` #C4BB9E.** Editable fields now read as a filled-in slot.
  177.59 used `C.cream` for this, which is 1.09:1 against `C.card` — invisible.
- **Corrects three 177.59 candidate changes that made contrast WORSE.** `vetted ★` and
  `✓ in your library` were moved to `C.sage` on cream rows (1.83:1, worse than the 2.38:1 gold they
  replaced); they are now `C.faint` (5.98:1). The Games-list share code was moved to `C.cream`
  (1.09:1) ahead of a surface change that has not shipped; it stays `C.green` (12.25:1) until the
  row actually turns green.
- **FIX — two buttons rendered as the browser default control.** "End game for everyone"
  (`tournaments.tsx`) and "Copy round summary" (`organizer-panel.tsx`) appeared as a light grey pill
  with iOS accent-blue text. A style spread was overridden with `undefined`, which discards `btn()`
  because React skips undefined values. Invisible to typecheck, lint and build.
- `borderRadius: 99` -> `999` at 8 stroke-dot sites. No pixel change; CSS clamps radius to half the box.
- **NEW `DISPLAY_RULES.md`** — the authoritative visual spec, with a manual audit checklist.
  `APP_RULES.md` 25/26 rewritten around it.
- **NEW guards**, all ratcheted and negative-tested: `check_resolved_contrast.py` (ancestor-resolved
  WCAG), `check-design-scale.py`, `check-palette-closure.py`, `check-overlay-contract.py`
  (undefined-override is zero-tolerance), `check_version_ledger.py`. `npm run guards` 51 -> 56.
- **Deferred to the next release:** the 238-site cream->green surface migration, and the geometry
  scales (161 paddings, 21 radii, 20 font sizes) which are ratcheted but not yet collapsed.

## 177.58.260816 — Create Game convergence audit closeout
- **NO migration. Runtime behavior unchanged from 177.57.** Final staging-only audit/packaging checkpoint before the cumulative Production PR.
- Added `DE_NOVO_CREATE_GAME_AUDIT_CLOSEOUT_177.58.md`, consolidating the fresh 177.46 Production -> final staging responsibility/contract comparison. The audit found no missing legacy Create Game capability and documents the intentional Lean Create ownership boundary plus the inherited non-atomic create risk.
- Removed an accidentally generated `tsconfig.tsbuildinfo` working artifact so it cannot enter the release bundle.
- Corrected the human `MIGRATIONS.md` mirror to mark 0138 as applied in staging + Production (the database ledger remains authoritative).
- Version/docs only; all dependency-backed CI, Vercel staging, targeted browser checks, PR verify, Production Ready and Production smoke gates remain mandatory before calling the cumulative convergence release deployable.

## 177.56.260816 — Format UI Fidelity + Handicap Input Polish
- Locks the shared Stroke / Match Play selector to the proven Production BNN geometry, icons, colors, typography, spacing, and selected-state treatment used by Create Game; Manage Game continues to consume the same shared selector.
- Fixes the Create Game custom handicap-allowance editor so deleting the value leaves a genuinely blank field instead of forcing `0`. While blank, the domain value safely falls back to the default `100%`; leaving the field restores the visible value to `100`.
- Replaces the broad allowance reset effect with explicit format-selection defaults so a resumed custom allowance (for example 92%) is not overwritten merely because the saved game type is restored.
- Adds pure allowance-edit/commit tests plus permanent source-contract checks for the blank/default behavior and Production selector styling.
- No scoring, database, setup-policy, or persistence schema behavior changed. No migration.

## 177.55.260816 — Cumulative Guided Format Restore + Shared Create/Manage Selector
- Create Game Four-ball wording: **Create named teams** is now **Create Team Names (Red vs Blue)**. Underlying `teamMode` and team-name persistence are unchanged.
- Manage Game → Format now uses the same shared Stroke / Match Play family cards and icons as Create Game. The family cards only filter which format choices are shown; the persisted game changes only when a specific format is selected, so the existing setup-policy ALLOW/CONFIRM/BLOCK gate remains authoritative.
- Extracted the duplicated family-card markup into `components/game/setup/format-family-selector.tsx`, used by both Create Game and Manage Game.
- No scoring, database, setup-policy, or persistence behavior changed. No migration.

## 177.54.260816 — Guided Format Selection Restore & Polish

- Restores the proven Stroke / Match Play guided format hierarchy and original format-family icons after the 177.53 flat-selector experiment.
- Preserves the Lean Create architecture, modular game-create/draft/tee logic, Resume Setup, and Manage Game structural handoff.
- Restores the handicap allowance shortcuts plus custom 0–100% numeric input.
- Preserves Stroke → Stableford / Stroke Play / Skins and Match Play → Individual / Team → Singles / Four-ball / Trifecta / Skins selection paths.
- Clarifies Four-ball overall-team creation as “Create named teams (e.g. Red vs Blue)” without changing persisted team-mode semantics.
- Retains the detailed Review format summary introduced in 177.53.
- No database migration.

# Birdie Num Num — Deploy & Migration Notes

## Convention
- Every database migration's full SQL is pasted **inline in the chat** at delivery
  time (not just shipped in the bundle), so it can be run without opening files.
- Migrations are run **manually** in the Supabase SQL editor, in numeric order.
  Run each new migration once; `create or replace` / `add column if not exists`
  make re-runs safe.
- App code is cumulative: deploying the latest bundle ships all prior code. Only
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

### v1.152.1 — FIX: Admin tab horizontal drift (no migration)
The Admin views had no width guard, so a wide child (dense stat/bar rows, the drill-down table) could
push the whole page and let it drift left/right on a phone — only on Admin. Clamped both AdminHome
containers to width:100% / maxWidth:100% / overflowX:hidden. Content that's legitimately wide (the
admin_stat_users drill table) keeps its own local horizontal scroll inside its box; everything else
(flex tiles, flex:1 bar charts) reflows to fit. No data or logic change.

### v1.152.2 — Global no-horizontal-scroll + admin label clarity + APP_RULES.md (no migration)
1) No-horizontal-scroll is now APP-WIDE, enforced at the single inner scroll container
   (home.tsx scrollRef: overflowY:auto + overflowX:hidden). Reverted the admin-only clamps from
   v1.152.1 (global rule supersedes). Wide content must use its own local overflowX:auto box.
2) Admin label clarity: system-admin button now reads 'Make system admin' / 'Remove system admin';
   club-admin toggle reads 'Make club admin' / 'Remove club admin' (+ audit text). No more bare 'admin'.
3) Added APP_RULES.md (global invariants reference) + ci/check-global-rules.py (guards Rule 1: the
   scrollRef horizontal clamp). Release builds now run this check alongside fontsize + jsx-escape.

### v1.152.3 — Swipe-cue for horizontal-scroll boxes (no migration)
New shared <HScroll> (components/hscroll.tsx): an overflowX:auto box that shows a "Swipe →" cue in
the corner ONLY while there's more content to the right (mobile hides native scrollbars); the cue
vanishes at the end and never shows when content fits. Applied to the two wide data boxes — admin
drill table (manage.tsx) and the round-detail hole strip (round-detail.tsx). Codified in APP_RULES.md
rule 1: any new horizontally-scrollable box uses <HScroll> (badge-shelf carousels keep their
half-clipped-badge cue). No data/logic change.

### v1.152.4 — FIX: Activity log actor shows name, not email (no migration)
The game-delete log used the actor's email while game-create/end/reset used display name, so a delete
read as 'amitsud@gmail.com' next to 'Amit Sud'. Fixed centrally: logActivity (lib/activity.ts) now
resolves display_name from actor_id when the passed name is empty or looks like an email, so ALL entries
(games, groups, admin actions) read as names. Also set game_deleted to pass displayName directly.
Same actor_id throughout — this was only a label. Existing historical rows keep their old label.

### v1.152.5 — FIX: 'Completed a round' logs once, on first finalization (no migration)
round-editor save() logged a round_completed activity on EVERY save of a solo round, so re-opening a
round to fix a score/add stats wrote a new 'Completed a round (score)' line each time (the drifting
scores + partials seen in the log). Now it captures the round's prior status and logs a completion only
when the round FIRST becomes final; re-saves of an already-final round no longer log. Game rounds remain
excluded as before. Fixes audit-trail spam; no change to the rounds data itself.

### v1.153.0 — FEATURE: warn before logging a round that duplicates an active game (no migration)
Root cause of the Preet-style duplicate: a player who's being scored in a group game could also start a
SEPARATE manual round via New round (game_id NULL), which the rounds(game_id,user_id) unique index can't
dedupe. RoundSetup.start() now checks whether the player is in an ACTIVE (status<>'ended') game at the
same course; if so it warns: their scores post automatically and they can add their own putts/fairways/
sand/penalties on the game's scorecard — 'Log a SEPARATE round anyway? This usually creates a duplicate.'
Warn, not block (legit second rounds / back-entry still allowed). In-game guidance for view-only gross +
editable stats already existed (tournaments.tsx). No rounds-data change.

### v1.153.1 — refine duplicate-round warning: only when the game is still unfinished (no migration)
v1.153.0 warned whenever the player was in any active game at that course. Refined: it now also checks
the player's own scores in that game (game_players.scores, 0-based hole keys) and only warns if the
round is still UNFINISHED (fewer scored holes than the course's hole count). A fully-scored game that
the organizer simply hasn't ended no longer triggers it (that's likely a genuine second round). Message
shows progress (e.g. '11/18 holes in'). NOTE: there is no system auto-END for games — only stale-complete
in-progress ROUNDS auto-finish (0083). Auto-ending fully-scored stale games is a possible follow-up.

### v1.154.0 — game auto-complete + organizer nudge — MIGRATION 0103 (RUN THIS)
Fully-scored games that the organizer never ended no longer linger 'active' forever.
- New games columns: scored_at (first seen fully scored), end_nudge_at (nudge sent).
- post_game_rounds refactored: posting body extracted to post_game_rounds_internal(p_game, p_system);
  post_game_rounds keeps its organizer-only gate and delegates (client 'End game' unchanged).
- sweep_stale_games() (throttled once/hour via system_jobs, called on app open in home.tsx): a game is
  'fully scored' when every player who started has all holes in and NO player is mid-round (partials
  keep it in progress). Stamps scored_at; nudges the organizer 2h later ('...auto-complete at the end
  of today...', type game_autocomplete, link /?tab=games); auto-ends + posts everyone's rounds at the
  end of the ET day, attributed finished_by='system:auto' (mirrors the stale-round sweep 0083).
- Guard: only games created within the last 30 days are swept (avoids resurrecting ancient games).
- There is still NO auto-complete for single in-progress ROUNDS beyond finish_stale_rounds (0083).

### v1.155.0 — System Admin: stale games panel — MIGRATION 0104 (RUN THIS)
Operations panel (System Admin) now lists every unfinished game older than 24h, app-wide, so an
admin can see how much stale/abandoned game data is awaiting cleanup.
- New RPC admin_stale_games() (is_admin-gated, security definer, READ-ONLY): returns each non-ended
  game >24h old with per-player completeness (same scores read as post_game_rounds) and a verdict:
  fully_scored / in_progress / no_scores / empty, ordered cleanable-first then oldest.
- OpsMetrics (manage.tsx): fetches it alongside get_ops_metrics; adds three count tiles (Total stale,
  Fully scored, Abandoned) and a per-game list with a colour-coded verdict badge (gold=fully scored,
  sage=in progress, red=no scores, grey=no players). Read-only — no in-app delete yet.
- Note: fully_scored stale games under 30d auto-complete via sweep_stale_games (0103); this panel
  surfaces the longer tail (abandoned partials, empty shells, >30d fully-scored).

### v1.156.0 — stale-games panel: per-row Delete (System Admin) — MIGRATION 0105 (RUN THIS)
The Operations → Stale games panel now has a Delete button per row for clearing abandoned games
without dropping to SQL.
- New RPC admin_delete_stale_game(p_game) returns text (is_admin-gated, security definer). Guards:
  refuses if the game is already 'ended' (not_stale) or has any live non-deleted rounds (has_rounds),
  so it can never orphan a posted round. Nulls game_id on any soft-deleted rounds, then deletes
  game_players + games (mirrors admin_delete_game). Returns forbidden|not_found|not_stale|has_rounds|deleted.
- OpsMetrics (manage.tsx): each stale row shows a red outline Delete button when rounds_posted=0
  (behind a confirm), or a 'has rounds' note when protected. On 'deleted' the row is removed from the
  list in place; other statuses surface a short alert.

### v1.157.0 — test-group sandbox + wipe — MIGRATIONS 0106 & 0107 (RUN BOTH)
App Testing (group 41935c40-…) is now a true sandbox.
- 0106: groups.is_test (App Testing=true) + is_test_group() helper. post_game_rounds_internal bails
  before creating any rounds for a test group (covers game-end + auto-complete sweep); recordMyGameRound
  (client) does the same. sweep_stale_games and admin_stale_games now skip test groups (no nudges, no
  ops-panel clutter). Aggregate analytics already exclude is_test PROFILES, so test activity is fully
  sandboxed: games/betting/money work, but nothing hits Rounds/handicaps/stats.
- 0107: admin_wipe_group(p_group) — is_admin-gated AND hard-guarded to is_test groups only. Clears the
  group's games+game_players, rounds+holes, money (expenses/expense_shares/group_guests/settlements),
  group_activity, tee_times+rsvps, notifications; resets player_cards/member_badges for the group's TEST
  members only. KEEPS the group + members. Returns forbidden|not_found|not_test|wiped.
- manage.tsx GroupsAdmin: gold 'Wipe data' button on test-group rows (type-the-name confirm).
- NOTE: manual rounds a real user logs directly to a test group are not gated (phantom users can't log
  manually; games are the only phantom vector). Revisit if that edge matters.

### v1.158.0 — TEST MODE border (no migration)
A thin red border + centered 'TEST MODE' label now frames the whole app whenever the user is in a
test state, so it's never invisible. Shows when EITHER the account is a test account (profiles.is_test)
OR the active club is a test group (groups.is_test). home.tsx: groups query/AppGroup now carry is_test;
derived `testMode = profile.is_test || active group is_test`; fixed pointer-events:none overlay
(#DC2626, z-9999) in the app shell, label offset by safe-area-inset-top for notch/PWA. Purely visual;
the two underlying mechanisms are unchanged and remain distinct (is_test USER = excluded from
aggregate analytics; is_test GROUP = games never post rounds / sandboxed).

### v1.158.1 — FIX: analytics charts overflowed narrow screens (no migration)
Weekend-reach and New-vs-returning charts ran off the right edge on phones. Root cause: horizontal
flex bar rows whose columns were flex:1 but lacked minWidth:0 — a flex item defaults to min-width:auto
and can't shrink below content, so the per-column nowrap week label pinned each column to its intrinsic
width and ~13 weeks summed past the viewport; the app-shell overflowX:hidden then clipped the right
side silently (invisible on wide desktop, broken on phone). Fix: minWidth:0 on each column + overflow
hidden on the row + thinned week labels (~6 max, showWk()). Audited all other charts — SVGs are
width:100%, the hole-outcomes bar is percentage-width in an overflow-hidden box, legends flex-wrap —
all safe. Added ci/check-chart-overflow.py (flags a mapped bar-column with a nowrap label missing
minWidth:0) to the pipeline, and documented the flex minWidth:0 idiom in APP_RULES rule 1.

### v1.159.0 — automated layout-overflow e2e (Playwright + GitHub Actions) — no migration
Runtime guard so chart/layout overflow can't silently ship. AdminEngagement now accepts an optional
`inject` prop (skips its fetch) and is exported. New dev-only route app/dev/layoutprobe renders it with
worst-case 13-week mock data (inert in prod; only active when NEXT_PUBLIC_LAYOUT_PROBE=1). Playwright
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
- 3+ putts (item 9): now returns null for rounds with no putt data (gross-only or untracked), so they're
  excluded instead of charted as a false 0. A valid round with zero 3-putts still shows 0.
- Dynamic y-axis (item 4): drill-down trends now fit the data via niceDomain (pct stats clamped 0-100)
  instead of a generic auto axis — same data-fit treatment the scoring-form differential already uses.
- Colourful bars (item 8): bars now run green (beat your average) / red (didn't), direction-aware
  (lower-is-better vs higher), matching the scoring-form differential; rolling lines recoloured
  (cream 5-rd, gold 10-rd) and caption updated.
- Items 5/6/7 (scrambling 0%, missing putts bar, missing Stableford bar) are data-specific and pending
  a round-level diagnostic. Items 1 (avatars in analytics), 2/3 (popup dismissal global rule), and a
  full trend audit (10) are queued.

### v1.160.1 — popup dismissal + trend NaN hardening (no migration)
- Item 2: admin 'who' drill sheet (DrillModal) no longer dismisses on backdrop tap — a scroll that
  ended on the backdrop was reading as a tap and closing it. Now ×-only (backdrop dims but doesn't
  close). APP_RULES rule 4 extended: popups need an always-reachable × and must not close on scroll.
- Items 6/7 hardening: drill-down trend series now filters Number.isFinite(v), not just v!=null, so a
  NaN can't slip through as an invisible bar. (FB Jul 10 putts 31/15 and Weequahic Jun 17 Stableford
  are both finite/estimable per data, so please re-verify on this build.)

### v1.160.2 — dismissable chart tooltips (item 3) (no migration)
The recharts hover tooltip stuck 'on' after a tap on touch, with no way to dismiss (screenshot IMG_1366).
Fixed at the shared ChartTip level so it's fixed on every dashboard chart at once:
- ChartTip now renders a corner × that fires a global 'bnn-chart-dismiss' event.
- New DismissableChart wrapper listens for that event and remounts the chart (clears recharts' internal
  active-tooltip state). Wraps the scoring-form differential and the stat drill-down charts.
- All three <Tooltip> layers set wrapperStyle pointerEvents:auto so the × is tappable (recharts sets the
  tooltip layer pointer-events:none by default, which would swallow the tap).
Note: screenshot shows this Weequahic round labelled 'Jun 16' while the DB date is Jun 17 — a separate
date-display off-by-one (UTC parse) worth fixing; flagged, not yet addressed.

### v1.161.0 — avatars in the analytics 'who' drill (item 1) · MIGRATION 0108
- admin_stat_users (the shared is_admin-gated drill that every analytics stat routes through) now
  returns a 4th column, avatar_url, pulled from the profile behind each row (host.avatar_url for the
  guests stat). DROP+CREATE because the return shape changed; re-applies the 0096 America/New_York
  timezone and the authenticated grant. Regenerated from 0090 (paren-aware insert so rounds_day's
  subquery FROM wasn't touched).
- DrillModal rows now render <Avatar src={u.avatar_url} name={u.name}/> — a real photo when set, the
  initials circle otherwise (Avatar's own fallback), with tap-to-enlarge for real photos. Removed the
  now-dead local initials() helper (also clears a jsx-escape advisory false positive).
- Covers the primary analytics 'who' lists. The power-users TABLE (get_power_users) is a separate
  stats grid — avatars there deferred unless wanted.

### v1.161.1 — avatars in more people-lists (item 1, breadth) (no migration)
All client-side (no DB change) — the profile/player objects already carry avatar_url; Avatar falls
back to initials when a photo is absent:
- tournaments.tsx: flight handicap editor rows, guest members list, and flight members list now show
  a small avatar beside each name (native <select> option rows can't hold avatars, left as-is).
- manage.tsx Power users table: small avatar in the sticky name cell. get_power_users already returns
  user_id, so avatars are fetched client-side by id (best-effort; if RLS blocks reading those profiles
  it silently falls back to initials — never blocks the table). No migration.
- money.tsx settlements/balances already had avatars — confirmed, unchanged.
Still pending avatars: round-setup player picker, round-detail playing partners, share-card, a couple
of remaining tournaments guest/scorecard-header spots.

### v1.161.2 — avatar sweep finish (no migration)
- tournaments.tsx guest row now shows an avatar (guests have no profile photo, so it's the initials
  circle — consistent with member rows).
- Audited the rest: round-setup is a solo round-entry flow (no player picker), round-detail is a single
  player's scorecard, tee-times roster + money settlements already had avatars. Remaining name displays
  are not 'who is this' lists: native <select> options (can't hold avatars), the dense live-scoring grid
  column headers, action pills (mark-out), inline sentence mentions, and the stylized share card.

### v1.161.3 — analytics engagement charts rebuilt on recharts (no migration)
The Weekend-reach and New-vs-returning charts were hand-rolled flex div-bars: a value of 1 became a
~4px sliver (read as a broken dash), one tall bar crushed the rest, and labels didn't sit under bars.
Rebuilt both as recharts BarCharts (160px tall) matching the dashboard aesthetic:
- Weekend reach: gold bars, radius top, a thin y-axis for scale, aligned x labels (interval
  preserveStartEnd + minTickGap), value labels on each bar via LabelList. Small bars are now readable.
- New vs returning: proper stacked bars (new=gold bottom, returning=sage top), the week TOTAL labelled
  on top, legend kept below. Replaces the two-number-per-column clutter.
- Removed the old flex-bar scaling helpers (maxG/maxNR/stepW/stepNR/showWk). Imported recharts into
  manage.tsx. No tooltips (values are labelled) — avoids the stuck-tooltip issue on these admin charts.

### v1.161.4 — chart axis-fit as a default (no migration)
Making 'fit the axis to the data' a standing rule instead of a per-chart fix (APP_RULES rule 17):
- AdaptiveTrend now self-fits its y-axis to the data range when no explicit domain is passed (pct
  stats clamp 0-100) — so no future chart using it can ship un-fitted.
- Removed dead code: trend/diffDomain/ptsVals/ptsDomain (a leftover block that fed no chart).
Audit of every chart in the app (all now fit their space): dashboard scoring-form differential
(niceDomain), stat drill-down trends (niceDomain / pct-clamped), AdaptiveTrend (self-fit),
hole-outcomes proportion bar (no axis), manage engagement weekend + new-vs-returning (recharts,
0-based count bars, 160px tall), feature proportion bars, player-card FormChart (SVG, data-range
fit + span-0 guard). No un-fitted charts remain.

### v1.161.5 — date off-by-one display fix + % axis labels (no migration)
- fmtDate: a plain 'YYYY-MM-DD' (a DATE column like played_at) was parsed by new Date() as UTC
  midnight, rendering as the previous day in the Americas (e.g. Jun 17 -> 'Jun 16'). Now parsed as a
  local calendar day. Full ISO timestamps still parse as before. Fixes dates across scorecards, round
  lists, tooltips, share cards — anything via fmtDate.
- Percentage trend charts (scrambling, GIR, fairways, sand saves) now label the y-axis with '%' via a
  tickFormatter, in both the dense (AdaptiveTrend) and bar drill-downs — answers 'is that a percentage?'
- NOTE: the deeper 'played_at = game creation date, not actual play/record date' issue is separate and
  pending a design decision (see chat) — not changed here.

### v1.162.0 — round date = when it was actually played/scored · MIGRATION 0109
Server-only (no client change). Date priority for a recorded round is now: a deliberately-entered
date > the date it was actually scored > the game's creation date.
- post_game_rounds_internal (games) and post_group_rounds (tee-group posting): rdate is now the game's
  match date ONLY if it was deliberately entered (differs from the game's creation day, ET); otherwise
  the date it's being scored (now, ET). And played_at is no longer overwritten on re-post — it locks to
  the first (scoring-day) value, so finalizing a day later doesn't move the date.
- Backfill: every existing game round whose date was the non-deliberate default (match date = creation
  day, or null) is reset to the day it was scored (round.created_at, ET). Deliberate match dates and
  solo rounds (user-picked date) are left untouched.
- Worked example: the Weequahic 'Match Play' game (created Jun 17 ET, match date stored Jun 17, scored
  Jun 20, ended Jun 21) → backfill sets it to Jun 20, the day it was played.
- Separate/optional: the game 'Match date' field is still capped at max=today (can't schedule a future
  play date) — not changed here; the new rule makes it moot for the recorded date.

### v1.162.1 — allow scheduling a game ahead (remove today-cap on play date) (no migration)
The game date field was capped at max=today, so you couldn't set a future play date when scheduling a
game the night before / a few days out — and a tee-time's future play_date got clamped down to the
creation day (the root of the 'Jun 20 -> stored Jun 17' bug). Removed the cap and relabeled the field
'Play date'. Works with the 0109 rule: a deliberately-set (incl. future) date is honoured; if left at
the default, the scored-date fallback still records the day it was actually played.

### v1.163.0 — editable play date + past-date confirmation (solo rounds) (no migration)
- Round editor now shows an editable 'Play date' (defaults to the round's stored date); saving writes
  it to rounds.played_at on both the update and insert paths.
- Any round saved with a date before today prompts 'This round is dated {date} — {N} days in the past.
  Save it with that date?' Wired into new-round entry (hole-by-hole + gross) and the round editor.
  Backdating stays a deliberate one-tap-to-confirm action rather than a silent default.
- Still to do (team side): organizer-edits-a-game's-date (all players' rounds move together) and the
  0110 change making games always record the scored date. This release is the solo-round half.

### v1.164.0 — games always record the scored date + organizer date-edit · MIGRATION 0110
- Games are scored live and never back-dated, so a game round's recorded date is now ALWAYS the day it
  was scored. Dropped the 'deliberately-entered date wins' branch (0109) for games; the game's play
  date is scheduling/display only. Rain-delay case (scheduled Jun 19, played Jun 20) now records Jun 20.
- New RPC set_game_played_date(p_game, p_date): organizer-only; moves the game's date AND every
  player's round together. Surfaced as an organizer-only 'Play date' control in the game view (Save
  button appears only when changed; past-date confirmation before it moves anything).
- Backfill completes 0109: forces every game round to its scored (first-post/creation) day, ET.
- Solo rounds are unaffected (user-entered date, editable per v1.163.0).

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
header with the sticky-left Player corner at the highest z-index). New global rule in APP_RULES (rule 1).

### v1.165.0 — durable, immutable Money audit trail + integrity fixes · MIGRATION 0111
The Money ledger now keeps a permanent, tamper-proof record of every change, so an expense's full
allocation can always be traced — even after it's deleted. Fixes the gap where deleting an expense
erased its own history (the old `expense_audit`, 0050, was `on delete cascade`) and the allocation
breakdown vanished with the live rows.
- **New `money_audit` table**: one immutable snapshot per underlying write. NOT cascade-linked to the
  expense, so a deletion's snapshot outlives the expense. Read-only to members; NO update/delete policy
  (append-only, can't be doctored). Snapshots denormalize member/guest names so they still render after
  those rows change or are gone.
- **Captured by DB triggers, not app code** — they fire on every write path (manual expenses, admin
  edits, bet-posting from games, or a raw API call), so the trail can't be bypassed. A `BEFORE DELETE`
  trigger freezes the full allocation the instant before it cascades. The snapshot insert is
  exception-guarded so an auditing hiccup can never block a user's save/delete.
- **Because the app writes an expense and its shares/payers in separate requests**, one logical
  create/edit produces a short burst of snapshot rows; `collapseAuditBursts` (lib/money.ts, unit-tested)
  folds each burst into one clean version (first row's action, last row's settled snapshot). A delete is
  always its own terminal version.
- **UI**: the expense detail sheet now shows a full "History · N changes" list, each version expandable
  to its allocation as it stood then. A deleted expense's log entry is tappable and opens a read-only
  frozen snapshot ("DELETED" badge, full paid-by + split). No write code was touched.
- **Integrity fix — child-row write lock**: `expense_shares` / `expense_payers` writes are now scoped to
  the parent expense's `created_by` or a group admin/owner (previously ANY active member could rewrite
  another member's split directly via the API). Reads stay open to all members. Matches the app's own
  UI gate and the parent expense's update policy — makes true the model "edit only your own; admins edit
  anyone, all logged."
- **Sanity rail**: a single expense is capped at $100,000 (`amount_cents <= 10000000`) via CHECK
  constraint.
- Settlement permissions unchanged (honor system, by design — convenience over airtight).
- **Migration 0111 must be run** in the Supabase SQL editor. Deploying the code ahead of it is safe
  (the audit UI simply shows nothing until snapshots exist), but the audit trail and the child-write
  lock don't take effect until it's applied.

### 165.1.260714 — adopt new version scheme + doc sync (no migration, no app change)
First release under the new `FEATURE.EDIT.YYMMDD` version scheme (see "Versioning" note at the top).
Docs-only: recorded the scheme in APP_RULES (#13), HANDOFF (§4 step 2, §5), and here. No code or app
behavior changed and there is no migration — deploy at leisure (it only refreshes repo docs and the
version label; users will see a routine "update available" from the version-string change).

### 166.0.260714 — Events: group expenses into islands · MIGRATION 0112
Expenses can now be grouped under an Event (e.g. "Ireland Trip", or a game), so each event's spend sits
in its own island with its own per-person breakdown — while settlement stays group-wide.
- **`group_events`** (migration 0112): one member creates an event (name + optional free-form date);
  anyone can attach expenses to an OPEN event. `expenses.event_id` is nullable (optional field) and
  `on delete set null` (deleting an event never deletes its expenses — they fall back to Ungrouped).
- **Lifecycle open → closed.** An admin CLOSES a settled event via `set_event_closed` (admin/owner only,
  logged): it drops out of the picker, its expenses are sealed (no edits/deletes), and it moves to a
  collapsed "Closed events" section that stays fully viewable. Admin can reopen. **Enforced by DB
  triggers**, not just UI — a closed event's expenses can't be changed and nothing can be added/moved
  into it (consistent with the 0111 audit work). Closed events can't be deleted (sealed record); open
  ones can (by creator/admin), and their expenses fall back to Ungrouped.
- **Move an expense** between open events (or ungroup) via `move_expense_event` — expense creator or
  admin; target must be open; moving out of a closed event requires a reopen first. Logged.
- **Game-linked events auto-create on bet-post** (`ensure_game_event`): the game becomes an event whose
  name/date come from the game and are locked (a game event can't be hand-renamed). Reposting a bet into
  a closed game-event is blocked with a "reopen it first" message.
- **Balances view** now renders event islands (open → Ungrouped → collapsed Closed), each with its total,
  a "settled/unbalanced" chip (per-event nets to zero = settled), and — for admins — a Close/Reopen
  control. The add/edit form has an optional Event picker with inline "＋ New event"; the expense detail
  sheet has a "Move" control. Settle-up is unchanged and stays group-wide.
- New pure, unit-tested helpers in `lib/money.ts`: `eventNet` (per-member spent/share/net for one event)
  and `expensesByEvent`. `computeBalances`/`simplify` are untouched — events are a reporting lens only.
- **Migration 0112 must be run** (after 0111). Code is safe to deploy ahead of it (the events UI simply
  shows nothing until the table exists), but events don't work until it's applied.
- First release using `FEATURE.EDIT.YYMMDD`: this is FEATURE 166.

### 166.1.260714 — migration ledger (self-recording) · MIGRATION 0113
Confirming which migrations have run is now a query, not an honor-system checklist. Adds a
`schema_migrations` table + `record_migration()` helper; from 0113 on, every migration ends with
`select record_migration('NNNN_name');` and signs the log when it runs. Backfills a single
`baseline_through_0110` marker (confirmed applied) and auto-detects 0111/0112 by object existence, so the
ledger is accurate the moment 0113 runs regardless of order. Confirm state anytime with
`select id, applied_at from public.schema_migrations order by id;`. New standing rule in APP_RULES (#14).
No app-behavior change. Run 0113 LAST, after 0111 and 0112.

### 166.2.260714 — Money UI cleanup: drop Category, drop manual event date, header padding (no migration)
Refinements to the Money tab, display-only — no schema change.
- **Category removed** end-to-end: gone from the add/edit form, expense rows, the detail sheet, and the
  old "Spend by category" summary block. Description carries the expense now. The `expenses.category`
  column is left in place (DB default 'other'); nothing destructive, old values just stop showing.
- **Manual event-date field removed.** Events no longer ask for a typed date. Islands now show the
  auto-recorded **created** date and, once closed, the **closed** date (from `created_at`/`closed_at`) —
  shown on both open and closed islands. Game-linked events keep their date in the description text
  (built by `ensure_game_event` from the game), so no date is lost there.
- **Header padding**: the Money screen root had no horizontal padding, so content sat flush against the
  phone edges — added `0 14px` so headers and islands breathe.
No migration. Deploy via the normal flow.

### 166.3.260715 — auto-stamp the version date (build tooling; no migration, no app change)
The `YYMMDD` segment of the version is now computed from the US/Eastern date at build time in
`scripts/write-version.mjs`, instead of being typed by hand. Only FEATURE.EDIT is maintained in
package.json now; the date in package.json is a placeholder the build overrides, so the shipped version
always carries the true Eastern ship date and can't be fat-fingered (a 6-digit third segment marks the
new scheme; legacy 1.MINOR.PATCH is left untouched). Rule updated in APP_RULES #13 / HANDOFF §4. This is
also the first build to correctly land on 260715 rather than carrying 260714 forward.

### 166.4.260715 — fix false "settled" on event islands; rename Delete → Void (no migration)
- **Bug fix:** event islands showed "settled / ready to close" the moment they had any expenses, before
  any payment. Cause: the old `balanced` flag checked whether per-person nets sum to zero — a mathematical
  identity that's ALWAYS true (total paid always equals total owed). Replaced with `eventNet.owedWithin`
  (sum of positive nets = amount someone fronted for others within the event). The chip now reads
  **"all square"** only when nobody fronted, otherwise **"$X fronted"** (neutral, C.sage) — never a
  payment claim. Removed the misleading "Shares balance — ready to close" admin hint. Rationale:
  settlements are group-wide and not tagged to an event, so an event genuinely can't know if it's been
  paid — the admin asserts done-ness by CLOSING it; the app never fabricates "settled." `owedWithin` is
  unit-tested (fronting case, self-square case, guest-to-sponsor case).
- **Rename Delete → Void** on the expense edit screen: "Void expense" button + reworded confirm ("removed
  from everyone's balances, but the record stays in the activity log"). The frozen-snapshot badge now reads
  VOIDED and the log/version wording says "voided." Void better fits the connotation of reversing a charge,
  and matches what already happens — the record persists in the audit trail, only the live row is removed.
  Internal action key stays `expense_deleted` (icons, log history, existing rows unaffected). Mechanic
  unchanged. No migration.

### 167.0.260715 — event settled-state (derived), tap-through balance breakdown, Money spacing (no migration)
- **Event settled-state — now real.** Corrects 166.4: an event is settled when every participant is
  globally square (per the model "settle globally = settled everywhere"; owedWithin===0 events are
  trivially settled). Islands show **settled** (green) / **$X outstanding** / **open**, and the admin
  "ready to close" hint returns but only when actually settled. Global balances (computeBalances) are
  passed into the islands to derive this; settle-up itself is unchanged and stays group-wide.
- **Tap-through balance breakdown (new).** Tapping a person on the Balances tab opens a plain-language
  ledger of how their number was built — "You paid $60 for Beer cart" (+), "You owe $100 — your share of
  Rental (Ireland Trip)" (−), "You paid $50 to Dave" — grouped by event, with a running total that
  reconciles exactly to the shown balance. This is the RAW obligation list, deliberately NOT the
  simplified who-pays-whom (that stays on the Settle tab). New pure helper `personLedger` in lib/money.ts,
  unit-tested to reconcile to computeBalances for every member (incl. guest-sponsor and settlements).
- **Spacing fix.** The shared `Eyebrow` header has zero margin, so Money's Add tab and "Expenses by
  event" headers sat flush together. Added a spaced local `MoneyHead` (18px top / 8px bottom) for all
  Money section headers — scoped to Money to avoid touching other screens' spacing.
No migration; app-only.

### 167.1.260715 — FIFO event settlement, oldest-first (no migration)
Refines 167.0's settled logic to handle partial payments the way Amit specified: a person's cumulative
payments retire their debts **oldest-first**, with Ungrouped treated as just another dated bucket (ordered
by date alongside events). So paying half clears your oldest events first instead of nothing settling.
- New pure helper `eventSettlement` (lib/money.ts): buckets each person's net by event/ungrouped, orders
  by date, and FIFO-allocates their net payments-out (settlement "from" minus "to") oldest-first. An event
  is settled when its total owed is fully covered by participants' oldest-first allocations. Unit-tested:
  partial payment settles the older event and leaves the newer open; no payment settles nothing; full
  payment settles all; an older Ungrouped bucket takes the payment before a later event.
- Island chip now shows **settled** / **"$X of $Y settled"** (partial, amber) / **"$X outstanding"** /
  **open**, and "ready to close" only when truly settled. Replaces the all-or-nothing global-square check
  from 167.0.
No migration; app-only.

### 167.2.260715 — per-event settling with confirm-on-return · MIGRATION 0114
Settlements are now event-attributable, per person, all-or-nothing — replacing FIFO (which let a disputed
old event block newer ones). Approved via mockups before build.
- **Migration 0114**: `settlements.event_id` (null = Ungrouped/legacy global) + `settlements.status`
  ('pending' | 'confirmed', default confirmed). Pending rows are ignored by balances AND event
  settled-state — they only drive the "confirm your payment" nudge and persist so a settle survives an
  app close.
- **Settled-state is computed** (lib `eventSettlement`): a person is settled for an event when their
  confirmed, event-tagged coverage ≥ their current within-event owed; the event is settled when every
  ower is. No cross-event ordering, so a stuck/disputed event never blocks another. Editing an expense
  changes the owed and thus re-opens the event automatically when coverage falls short (Amit's option (a),
  computed — no destructive deletion, no trigger). `withinEventDebts` splits a person's within-event debt
  across that event's fronters (largest-remainder). Both unit-tested (pay-newer-leaves-older-open,
  pending-doesn't-count, edit-up-reopens, full-coverage-settles).
- **Confirm-on-return flow**: tapping Settle on an event arms pending settlement rows (persisted), hands
  off to Venmo/PayPal (deep link) or shows the Zelle handle to copy; on return the app asks "did it go
  through?" → confirm flips pending→confirmed (counts immediately) and notifies each payee via
  `create_notification`; "Not yet" leaves it pending with a persistent "confirm your payment" banner +
  Settle-tab-independent nag on Balances. We can't force the pay app to return the user, so this catches
  them on return and nags until resolved. No payee verification (trust model) — the notification is a
  courtesy heads-up.
- Balances/transfers now count **confirmed settlements only**. The existing global Settle tab is unchanged
  (records confirmed, event_id null) so nothing regresses.
- **Run migration 0114** (after 0113). Per the DB ledger, 0111–0113 are already applied; 0114 is the only
  new one. Confirm afterward with `select id, applied_at from public.schema_migrations order by id;`.

### 167.3.260715 — standardized header spacing + iOS-safe date fields (app-wide; no new migration)
Two consistency changes that apply across every screen, not just Money.
- **Header spacing is now a default, app-wide.** The shared `<Eyebrow>` header (components/ui.tsx) carries
  the benchmark spacing (`marginTop:16, marginBottom:8`) by default — matching the value tee-times already
  used. Removed the Money-local `MoneyHead` workaround from 167.0; Money now uses `<Eyebrow>` like
  everywhere else. Every screen that uses `<Eyebrow>` gets consistent vertical rhythm for free, and new
  screens comply automatically. Standing rule added (APP_RULES #15). NOTE: this nudges header spacing on
  all screens by design — if any specific screen looks off, flag it and I'll tune that spot.
- **Date fields are now guarded for the known iOS bug.** Bare `<input type="date">` renders badly on
  iPhone; the compliant patterns are `<ShortDateInput>` or a raw input with `WebkitAppearance:"none"`.
  Fixed one non-compliant input (admin analytics date picker in manage.tsx) and added
  `ci/check-date-inputs.py` (blocking) to the pre-ship pipeline so a non-compliant date field can never
  ship again. Standing rule added (APP_RULES #16), pipeline updated (HANDOFF §4).
- No new migration. 0114 (from 167.2) remains the outstanding one to run in Supabase if not already done.

### 167.4.260715 — dashboard tile-header consistency (stage 1 of header cleanup; no migration)
First screen in the staged header-consistency pass. Dashboard tile headers are now uniformly `<Eyebrow>`:
- Converted two hand-rolled stragglers: "RUNNING HANDICAP INDEX" (was a bare gold div with no margin →
  now standard `<Eyebrow>` spacing 16/8) and "✦ AI COACH" (was fontWeight 800 → normalized to the standard
  700; kept `margin:0` because it's a collapsible row header with a chevron, so the tile padding handles
  spacing and the chevron stays aligned).
- Left alone (correctly): the sage `sectionHead` divider (label + rule line) — a distinct, already-uniform
  pattern, not a tile header.
- Policy codified in APP_RULES #15: tile headers are `<Eyebrow>`; row-headers with a control pass
  `style={{margin:0}}`; lookalikes (pills, chips, column headers, banners, the sage divider) stay as-is.
NOTE for review: "RUNNING HANDICAP INDEX" gains the standard 16px top / 8px bottom spacing it didn't have
before — please eyeball that tile and confirm it looks right before I apply the same pass to the next screen.
No migration.

### 167.5.260715 — header-consistency sweep, app-wide (no migration)
Single pass applying the agreed three-tier header policy across the app (dashboard was 167.4).
- New shared `<FieldLabel>` (ui.tsx) for quiet sage form labels (a tier below Eyebrow section headers).
- Converted hand-rolled section headers to `<Eyebrow>`: money (Payments recorded, ledger bucket titles),
  manage (WHAT TO NOTIFY ME ABOUT, NOTIFICATIONS, CLUBS/ANALYTICS/REMOVE FROM APP), achievements (category
  labels), compare-stats (all 3), home (WELCOME), player-card (Index[margin:0]/Badges/Recent form),
  organizer (railH3 aligned to standard).
- Money field labels (Zelle contact, Now a member?, Sponsored by) → `<FieldLabel>`; "Guests" title 16→17.
- tee-times aligned to the app standard: dropped its local `EB` header override (was 12px/ls1.8 → now the
  standard 11/ls3), screen title "Tee Times" → Georgia serif (was sans), section field-labels → FieldLabel.
- Left as-is (intentional, not tile headers): color-coded course-diff labels (current vs proposed cue),
  table column headers, status/badge pills, banners (TEST MODE), the Tier-1 title-size hierarchy, and the
  dashboard's sage section-divider.
- Going-forward: APP_RULES #15 (headers use Eyebrow; tile/row rules) + #16 (date fields). No migration.

### 167.6.260715 — owe reminder is per-club + switches club on tap (no migration)
The top-of-app "you owe" banner no longer lumps clubs together.
- **Per-club reminders**: one line per club you owe in (kept separate, not summed). The club is NAMED only
  if you belong to multiple clubs ("You owe $X in Pebble Beach"); with a single club it stays "You owe $X
  to settle up".
- **Tap switches club + opens Balances**: tapping a reminder switches the active club to that one (reusing
  the same group-switch path the tee-time notifications use), opens Money → Balances so you see the
  expenses, and shows a transient toast "Switched to {Club} to view expense" — only when a switch actually
  happened (no toast if it's already your active club).
- **Bug fix (from 167.2)**: `loadOwed` counted ALL settlements including pending/armed ones, so a
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
- **Fix — balance breakdown mismatch**: PersonLedgerModal was fed ALL settlements (incl. pending) for its
  line items while showing a confirmed-only headline balance, so with a pending settle the lines wouldn't
  sum to the shown balance (despite the modal's copy promising they do). Now fed confirmed-only.
- **Fix — contradictory island UI**: in the netting case (globally square but owing *within* an event),
  the island showed a "settled" chip AND a "Settle $X" button at once. Settle affordance now gated on
  `!settled`.
- **Stress battery** (lib/money.test.ts): adversarial cases (rounding $10/3, cross-event netting, circular
  debt, over-settlement, guest multi-hop) + a seeded property-based fuzzer over **3,000 random valid
  ledgers** asserting the core invariants every time: (1) balances conserve to zero; (2) personLedger
  reconciles to computeBalances for every member; (3) per-event nets sum to zero; (4) withinEventDebts sums
  to owed exactly with positive amounts; (5) a globally-square member never blocks a bucket; covered never
  exceeds owed; (6) simplify conserves and zeroes. Money suite now 111 assertions, all passing.
- Scope note: the incorrect "owing" was the per-event island display only; the home-screen "you owe"
  banner is global-balance based, so genuinely settled members saw no banner.
No migration.

### 168.0.260715 — popup safe-areas (global), event who-owes summary, drop Built line (no migration)
- **Bottom popups clear the nav bar + safe areas (global).** New shared `<BottomSheet>` (components/ui.tsx)
  reserves bottom room for the tab bar + iOS home indicator and caps height against the notch. Fixes the
  reported Money expense popup whose bottom (and last button) was hidden behind the nav bar. All six Money
  sheets patched to the safe pattern; standing rule added (APP_RULES #17); shared component in place so new
  popups comply. Other screens' sheets tracked for migration.
- **Event islands now summarize who owes what.** Under each event header: "All members settled" (green) when
  settled, otherwise a plain-language line — e.g. "Ravi owes $50 · Amit gets $50" — built from the per-event
  nets, so a viewer instantly sees the standings even when not settled. Detailed per-member paid/net rows
  still shown below.
- **Removed the "Built: <date>" line** in Help → version tile (redundant now the date is in the version
  number). Dropped the now-unused APP_BUILT_AT import.
No migration.

### 168.1.260715 — bottom-popup safe-area sweep + guard (no migration)
Swept every bottom-docked popup for the nav-bar/safe-area rule (#17), and added a blocking CI guard so it
can't regress.
- Found: the manage handicap-override drawer, the notification-bell drawer, and the three tee-times
  drawers (RSVP / assign-captain / captain-duties) included env(safe-area-inset-bottom) but only ~10-16px
  of it — not enough to clear the ~56px nav bar (these are viewport-fixed, so on iOS PWAs they paint over
  the nav). Brought all to the standard `calc(72px + env(safe-area-inset-bottom))`, matching Money.
- Left as-is (correct): the home More-menu — it's the nav's own overflow menu and docks directly against
  the nav (`16px + safe`), so it must NOT clear the nav.
- New guard `ci/check-bottom-sheets.py` (blocking): every bottom-docked sheet panel must include
  env(safe-area-inset-bottom). Added to the pre-ship pipeline; rule #17 updated.
No migration.

### 168.2.260715 — closed events seal their payments too · MIGRATION 0115
Consistency fix (reported): an admin could "Unmark" a payment on a closed (sealed) event without reopening
it — contradicting "closed = sealed." Now the flow is reopen → unmark, matching how closed-event expenses
already behave.
- **Migration 0115**: `_guard_settlement_frozen_event` trigger blocks DELETE of a settlement tied to a
  closed event ("reopen the event to unmark it") and blocks INSERT of a new payment into a closed event.
  UPDATE is allowed so a pending settle armed before the event closed can still be confirmed.
- **UI**: the Unmark button is hidden on closed-event payments (shows a "🔒 closed" note instead); the
  unmark handler also pre-checks and tells the admin to reopen first. Reopen the event (existing admin
  control on the closed island) and Unmark returns.
- **Run migration 0115** (after 0114). Confirm with `select id, applied_at from public.schema_migrations order by id;`.

### 168.3.260715 — Money permission/lifecycle audit fixes · MIGRATION 0116
Full audit of every Money write path against the permission model (who) and lifecycle model (open/closed,
pending/confirmed). Findings + fixes:
- **CRITICAL — confirm-on-return was silently blocked.** `settlements` had no UPDATE RLS policy, so the
  pending→confirmed transition was denied by RLS with no error — armed payments never actually confirmed.
  0116 adds an UPDATE policy (payer OR payee OR admin). The confirm handler now also checks the result and
  surfaces a failure instead of silently swallowing it.
- **Both parties can clear a line (your call).** Payee can now "Mark received", not just the payer "Mark
  paid" (admin still can too) — two chances to settle a line item. (INSERT policy already allowed a party;
  UI now exposes it to the payee.)
- **Guest retire/un-retire is now creator-or-admin** (was any member). 0116 splits the guest RLS: any
  member adds; only the guest's creator or an admin edits/retires/deletes. UI gates the buttons and shows
  "added by X" otherwise. (Keys off group_guests.created_by; a guest's sponsor can still vary per expense.)
- **A game bet posts to a FRESH event if the game's prior event was closed** (your call). Dropped the
  one-event-per-game unique index; ensure_game_event now reuses the game's OPEN event or creates a new one.
- **Non-issue confirmed:** group_pay_roster is a read-only, membership-checked handles lookup — no bulk-pay
  bypass. Event creation stays open to any member (your call).
- Recorded the full who-can-do-what matrix in MONEY_PERMISSIONS.md.
- **Run migration 0116** (after 0115). Confirm with `select id, applied_at from public.schema_migrations order by id;`.

### 168.4.260715 — More menu: visible close + keeps nav visible (no migration)
- The "⋯ More" menu previously covered the bottom nav and could only be dismissed by tapping the (dim,
  undiscoverable) backdrop. Now it docks ABOVE the nav (measured nav height via ResizeObserver), so the
  nav stays visible and usable, and it has an explicit "MORE ×" header to close it.
- Standing rule #18: every popup/menu needs a visible close control; nav-extension menus sit above the
  (always-visible) nav. Bottom-sheet guard updated to recognize above-nav menus as compliant.
No migration.

### 168.5.260715 — one-confirmation-per-line (race-proof) · MIGRATION 0117 (includes 168.4 menu fix)
- **Double-post fixed at the DB layer.** With both parties able to clear a line ("Mark paid" / "Mark
  received"), two simultaneous confirmations could post twice and over-count. Migration 0117 adds a
  `dedup_key` + unique index: the client stamps a stable key for the debt line (derived from pair + event
  + how much is already confirmed-settled), so both parties compute the SAME key for the same line and the
  DB rejects the second — guaranteed one confirmation per line even under an exact race. A genuinely new
  later debt for the same pair carries a different key, so repeat settlements still work. Both settle paths
  (arm-pending and mark) stamp the key and handle the unique-violation (23505) gracefully with a refresh.
- **Void-of-settled-expense: confirmed correct, no change.** If an expense is voided after payment, the
  payment stays and the payer is shown as owed a refund — which is the intended outcome.
- **Run migration 0117** (after 0116).

### 169.0.260715 — payments recorded at the expense level (stage 2) · MIGRATION 0118
Settlements now carry expense-level allocation lines (the sub-ledger from the design doc). OVERALL BALANCES
ARE UNCHANGED — they're still computed from payment totals; allocations only make per-event/per-expense
attribution exact and traceable.
- `lib/money.ts`: new `allocateSettlement` (FIFO split of a payment across the expenses it clears; unmapped
  remainder — e.g. a simplify-rerouted debt — becomes a single general/null line so lines always sum to the
  payment). `eventSettlement` now derives per-event coverage from allocations, so coverage FOLLOWS an
  expense when it's moved between events (the original bug, now correct by construction). Global-square kept
  as a fallback for general/historical (null-expense) allocations.
- Writes: both settle paths (`recordSettlement`, `armSettle`) go through the atomic `record_settlement`
  RPC (0118) — one payment header + its allocation lines in a single transaction, with the sum-check and
  party/admin permission enforced server-side. No settlement is ever written without allocations.
- Tests: +9 (allocator sums/FIFO/unmapped-remainder; allocation-based coverage; and the move-carries-
  coverage proof). Money suite now 120 assertions, all passing. Overall-balance math untouched (the fuzzer's
  conservation/reconciliation invariants still hold).
- **Run migration 0118** (after 0117; run 0117 first if you haven't). It creates the sub-ledger, the RPC,
  backfills history as general allocations, and self-aborts via a reconciliation gate if any payment's
  allocations don't sum. Confirm with `select id, applied_at from public.schema_migrations order by id;`.
No user-facing change except the move case is exact and payments are now traceable to expenses.

### 169.1.260715 — More menu: flush to nav + no background scroll (no migration)
- The "⋯ More" menu no longer floats above the nav with a gap. It's now anchored structurally (an absolute
  panel at `bottom:100%` of a wrapper around the nav), so its bottom edge is exactly the nav's top edge
  regardless of nav height/safe-area — no measured offset to drift. Removed the ResizeObserver/navH
  measurement it relied on.
- The screen behind the menu no longer scrolls while it's open (scrollRef locks to `overflow:hidden` when
  moreOpen). Backdrop still closes on tap; the × still closes it.
- CI: global-rules guard accepts the intentional scroll-lock; bottom-sheet guard recognizes above-nav
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
- **#1 Event summary now reflects payments.** The event "who owes what" line used raw expense fronting nets,
  so a member who had settled still showed as owing. New `eventStandings` subtracts confirmed payments
  (expense-tagged + event-tagged general remainder) per member, so a paid member drops off and only genuine
  remaining owes/gets show; "All members settled" appears when none remain. Balanced (owes == gets).
- **#3 Balances breakdown attributes payments to events.** personLedger settlement lines now label the
  event(s) a payment cleared (via allocations), e.g. "You paid $50.33 to Jonny · E", instead of showing at
  the parent level with no event.
- #2 (how to retract a payment): it's the "Unmark" button in the Settle tab → "Payments recorded" list
  (hidden only for closed events). No code change; can surface it more prominently if wanted.
- Tests +5 (eventStandings). Money suite 127 assertions, all green. No migration.

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
- **global-square was too generous.** It settled any member who owed nothing NET — including net creditors
  (owed overall), so an event whose only ower was a creditor showed green "settled" with $0 paid. Now it
  applies only to members who are FULLY square (net exactly 0, i.e. actually paid up); a net creditor still
  owes their in-event share until it's paid/netted.
- **eventStandings could go unbalanced** (owes != gets) in cross-bucket cases (independent flooring). Rewrote
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
- **Event islands no longer have a Settle button.** They show each event's settled state (from allocations)
  and, if you still owe, a note to settle from the Settle tab. All settling is club-level; club payments
  allocate down to events (audit trail + per-event settled-state retained).
- **"As entered" is now read-only** — it shows who owes whom by expense for reference, with no Mark/Pay
  buttons. Settling happens only from **"Fewest payments"** (simplified), which is derived from net balances
  so it can never over-settle. This fixes the bug where, after clearing everything, the as-entered view still
  asked for (stale, cycle) payments that would have corrupted balances.
- The view toggle is now a local per-user view switch (anyone can flip to the reference view); settling is
  always via Fewest payments. The event-level arm/pending machinery is retired from the UI (club Venmo flow
  via startPay is unchanged).
No migration.

### 169.9.260716 — move-with-payments guard + retire event-level arm/pending (no migration)
- **Move guard.** You can no longer move an expense in or out of an event that has recorded payments —
  those payments were settled against a fixed set of expenses, so moving would misroute their coverage
  (the settle-then-move bug). The move is blocked with a message to unmark the event's payments (Settle tab)
  first. Checks both the source and destination event (event-tagged settlements OR club-payment allocations
  landing on the event's expenses).
- **Dead-code cleanup.** Removed the orphaned event-level settle path (`armSettle` + the `onSettleEvent`
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
- **Reconciliation banner**: recomputes club balances and confirms they net to $0.00 (or flags the gap).
- **Member picker** (ranked by |balance|) → shows that member's full itemized ledger via personLedger:
  every expense share and every payment (with allocations), each with its signed effect and a running
  balance that ends at the member's true net.
- **Audit log**: recent money changes (expense add/edit/void, settle/unmark) with actor, from group_activity.
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
Migration 0119 adds expenses.deleted_at (soft delete) + a partial index; all reads now filter deleted_at is
null. Void is now a SOFT delete (reversible) instead of a hard delete — the expense is hidden from balances
but restorable. The admin Untangle view is now actionable:
- Expense rows: **Edit** (opens the editor → new version, keeps audit) and **Void** (soft-delete, impact
  preview first via ImpactModal).
- Payment rows: **Unmark** (impact preview first).
- **Voided expenses** section lists soft-deleted expenses with one-tap **Restore** (inline confirm).
- Reconciliation banner + audit log (now includes expense_restored).
All destructive actions preview their per-member balance impact before committing. RUN MIGRATION 0119.

### 171.0.260716 — feature mirror: App Testing can assume any club's feature set (no migration)
New effectiveGroupId(groupId) helper in lib/golf: the App Testing club maps to a mirror target so its feature
gates behave like another club's, without touching that club's data. Defaults to TGC, so App Testing now has
the full TGC workflow — Tee Times nav, money-game betting defaults, clean-sweep posting to Money, six-hole
subtotals, member-tee defaults. All 8 TGC gate sites (home nav, tournaments tee/sweep/sixes, manage edition)
now go through effectiveGroupId. A "Feature mirror (testing)" control in Club settings (shown only for App
Testing) lets you point it at TGC, any other club, or off — per-device (localStorage), reloads on change,
copies/changes no data. Server side is membership-gated throughout (tee_times RLS, bet→money inserts), so no
server changes needed. No migration.

### 171.1.260716 — mirror also sources the course library (no migration)
Fix: when App Testing mirrors a club, the tee-time course dropdown (favorite_courses.group_id) and the
game-creation course list (loadCoursesForGroup via group_courses) were still reading App Testing's own
(empty) courses, so no courses showed. Both now read from effectiveGroupId, so mirroring TGC surfaces TGC's
course library for tee times and games. Read-only lookups (RLS lets a member of the mirrored club read them);
tee times / games / money still write to App Testing. No migration.

### 171.2.260716 — real-time Tee Times (migration 0120)
The Tee Times tab now updates live instead of only on pull-to-refresh. Added a Supabase realtime subscription
(channel per group) on tee_times (group-filtered) and tee_time_rsvps; any change reloads the tab. Migration
0120 publishes tee_times + tee_time_rsvps to the supabase_realtime publication (idempotent, guarded). RLS
scopes which events each client receives. RUN MIGRATION 0120.

### 171.3.260716 — live-test bug batch
Fixes from App Testing (mirroring TGC). No new migration (still requires 0120 from 171.2 for realtime).
- **Guest handicap (game setup):** the inline "NEEDS HCP" field committed on the first keystroke, so typing 11 recorded 1 and the field vanished. Typing no longer commits; a ✓ button confirms, and a committed index shows an "edit" link.
- **Waitlist → game roster:** creating a game from a tee time seeded the roster from every "in" RSVP including waitlisted signups. Now excludes anyone in the waitlist set (a member's guest correctly consumes a spot).
- **Post bet winnings blocked despite sponsor:** buildPostNets returned null for two different reasons but both showed "Assign a sponsor for each guest first." The real cause was guest-record creation failing on a name collision (guest already in the group). findOrCreateGuestId now falls back to the existing same-name guest, and the two failure modes show distinct, accurate messages.
- **Settle default:** the Settle tab now always opens on Fewest payments (As entered is a read-only reference view).
- **Confirmation modal:** the impact modal for settle / mark / unmark / add / edit / void now shows each person's resulting club balance (e.g. "owes $37.50 → settled up · owed $45.00 → owed $7.50") instead of raw +/- accounting deltas.

### Open — under investigation (needs live data, not guessed)
- **"$37.50 paid but $27.50 settled" on the bet event:** a club-level settle allocates FIFO (oldest first) across ALL of the payer's fronted expenses the payer shares, including closed events. Jonny's $37.50 net payment appears to have paid an older debt first, leaving the bet under-covered on the per-event view even though the overall pair balance is likely square. Needs a ledger trace before any allocation change.

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
- Event islands show only the expenses and the raw per-member split (paid / net) as a record. Removed the
  settled / "$X of $Y settled" / outstanding badges and the per-event standings line.
- Settlement happens exclusively in the Settle tab, club-level, Fewest payments. Removed the
  As-entered / Fewest-payments toggle (Fewest payments is the only mode; overall balances are the source of truth).
- Event close is now a no-gate "Archive event" (option a) — no longer requires the event to look settled.
  Archived events are relabelled from CLOSED and now also show the split for the record; reopen unchanged.
- Removed eventSettlement / eventStandings / withinEventDebtsRemaining / pairwiseDebts usage from the UI.
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
`group_events`) is now a self-contained settlement world: its expenses net among its members, its own
confirmed settlements pay those down, and it is SETTLED when everyone in it is net-square. Settlement is
scoped to a single Bucket — `allocateSettlement`/`record_settlement` always carry the Bucket's `event_id`,
so no payment ever reroutes across Buckets (the cross-Bucket FIFO netting was the root cause of the
"$27.50 of $45 / Jonny owes $10" contradiction). The **Club** is a read-only rollup: each member's net is
the sum of their Bucket balances (== computeBalances, an exact partition identity). A member can be net-$0
at the Club while owing in one Bucket and owed in another — you settle inside Buckets, never at Club level.

Engine (lib/money.ts, additive — existing functions unchanged): `bucketBalances`, `bucketTransfers`,
`bucketSettled`, `clubRollup`. New tests lib/bucket-model.test.ts — 34 assertions incl. a 1,500-run
multi-Bucket fuzzer proving partition, per-Bucket conservation, Bucket-settled⟺no-transfers, and Bucket
isolation (settling one Bucket never moves another). Full suite green.

UI (components/money.tsx):
- Settle is per-Bucket — transfers computed with `bucketTransfers` and grouped under Bucket headers; each
  row carries its `bucketId`; Pay/Mark/Venmo/PayPal/Zelle and the confirm-on-return flow all thread it.
  A Bucket with no transfers shows "✓ settled". Recorded payments are labelled with their Bucket.
- `recordSettlement(from,to,amt,method,bucketId)` — now REQUIRES a Bucket; records `p_event=bucketId`,
  `allocateSettlement(...,bucketId,...)`, `settleKey(...,bucketId)`.
- Balances stays the Club scoreboard (net per member); tapping a member shows the per-Bucket breakdown
  (PersonLedgerModal groups lines by Bucket, shown even at net-zero).
- Add: the Bucket picker defaults to **General**; "New event" → "New Bucket"; bets still auto-create their
  own Bucket; guests still resolve to sponsor within each Bucket.
- Log tab renamed **Activity**.

Migration 0121_money_clean_slate — ONE-TIME clean slate (approved: only disposable test data existed) +
Bucket foundation. Run it ONCE, right AFTER deploying this build (it makes `settlements.event_id` NOT NULL,
which the previous UI would violate). Guarded by the ledger so re-running never re-wipes. Also creates one
**General** Bucket per club and adds `group_events.is_general`.

DEPLOY ORDER: deploy 173.0 first → then run 0121 in the Supabase SQL editor. (0120 from 171.2 is still
required for realtime Tee Times if not already applied.)

### 173.1.260716 — popup safe-area audit: no more top-clip under the notch (no migration)
The notification bell sheet (and its twin, the stat drawer) capped height with a bare `maxHeight: "82vh"`.
On iOS `vh` is the LARGE viewport, so the sheet's top — its header and the `×` close — got pushed up under
the status bar/notch and clipped (couldn't reach ×). Rule #17 already required a notch-aware cap; the
`ci/check-bottom-sheets.py` guard only checked the BOTTOM inset, so this slipped through. Fixed every popup
to the canonical cap and closed the guard gap:
- Notification sheet + stat drawer (manage.tsx): `82vh` → `calc(100dvh - env(safe-area-inset-top) - 20px)`.
  The notification list is scrollable, so its backdrop no longer dismisses on tap (rule #4) — close via `×`.
- Tee-time detail sheets (tee-times.tsx ×3): had NO height cap at all → added the same notch cap + `overflowY`.
- Centered modals — HoleScoreModal (ui.tsx `90vh`), a tournaments dialog (`85vh`), and the nav "More" menu
  (home.tsx `70vh`) → dynamic-viewport caps reserving the top (and, for centered modals, bottom) insets.
- Guard hardened: `check-bottom-sheets.py` now also fails any bottom-docked panel that caps with a bare
  `NNvh` maxHeight; rule #17 updated to spell out the top-cap requirement. Money sheets were already compliant.
No schema change; still ships migration 0121 (from 173.0) as the only migration — run it once after deploy.

### 173.2.260716 — Bucket-island balances + guest-post fix + notch fix (no migration)
Feedback batch off the first live Bucket testing:
- **Guest bets couldn't be posted — the sponsor was being dropped.** A game guest carries its
  sponsoring member from the tee time (game_players.guest_of), but findOrCreateGuestId materialized the
  money guest record with sponsor_user_id=null, which the 0116 money_guests_insert policy correctly
  rejects (every game guest must belong to a member). Fixed the code to persist the guest WITH its known
  sponsor. No migration, no RLS change — the rule stands.
- **Notification popup still clipped under the notch — real fix.** The maxHeight cap in 173.1 was necessary
  but not sufficient: the sheet is a flex column with a separate scrolling list, and that list lacked
  `flex:1; minHeight:0`, so it couldn't shrink to the cap — the whole stack overflowed upward past the
  notch. Added `flex:1; minHeight:0` to the notification list and the stat-drawer list. Now the header/×
  pin below the notch and the list scrolls.
- **Bucket islands are now mini aggregate tiles (item 6).** Each open Bucket island shows its own settled
  balance — "✓ All balances cleared for this Bucket" when net-square, otherwise who owes / is owed within
  that Bucket (computed with `bucketBalances`, i.e. after that Bucket's own settlements). Replaces the raw
  paid/net split. Footer updated: "Settle this Bucket … each Bucket squares on its own"; "Archive event" →
  "Archive Bucket".
- **Copy:** the top Balances tile is now "Aggregate Club-level Balances" (net across all Buckets, tap for
  the per-Bucket breakdown); "Expenses by event" → "Expenses by Bucket".
No new migration this build. 0121 must already be applied.

### 173.3.260716 — settled-bucket UI, notch (attempt 3, robust), tee-time/game flow, phantom-score fix (no migration)
Four fixes from live testing:
- **Settled Bucket no longer shows a $ on top.** A settled island showed the gold total, which read like an
  outstanding balance. Now a settled island shows "✓ Settled" up top (unsettled still shows total spend).
- **Notification popup notch — definitive fix.** Stopped relying on `maxHeight: calc(100dvh - safe-top …)`
  (a dvh-resolution quirk in the installed PWA was dropping the cap). The sheet is now a full-screen flex
  backdrop with `paddingTop: calc(env(safe-area-inset-top)+12px)` and the panel capped at `maxHeight:100%`
  of that padded area — so the top physically cannot cross the notch, independent of dvh support.
- **A finalized game now supersedes the tee-time date.** Tee times linked to a game with status='ended' are
  treated as done (moved to Past, edit/RSVP frozen) even if the play date is future — tee-times now loads the
  linked games' ended status and folds it into the upcoming/past split.
- **Phantom hole scores fixed.** Tapping an empty hole cell as the group marker pre-persisted `strokes=par`
  BEFORE the editor opened, so merely opening (or navigating past) a hole wrote a phantom par — which then
  showed up in the six-hole segments (e.g. a hole-7 score with none entered). Removed the pre-persist;
  par is still one tap inside the editor. NOTE: existing phantom scores already in a game must be cleared by
  hand (open that hole and clear it) — the fix only prevents new ones.
No migration. 0121 remains the last migration.

### 173.3.260716 — owe-banner matches the Money screen (no migration)
The top "You owe $X in <club>" banner persisted after everything was settled. Root cause: its balance
query (home.tsx loadOwed) didn't match the Money screen's inputs, so its computeBalances diverged:
- expense_payers was selected as (expense_id, user_id, paid_cents) — MISSING guest_id/sponsor_user_id — so
  a GUEST payer's winnings (e.g. a member's guest winning a bet) resolved to nobody and were dropped,
  leaving the sponsor "owing" what their guest actually won.
- expense_shares was missing sponsor_user_id (per-expense sponsor).
- the expenses query didn't exclude soft-deleted rows, so voided expenses still counted.
Fixed the banner's queries to mirror the Money screen (guest_id + sponsor_user_id on payers/shares;
deleted_at IS NULL on expenses). The banner already refreshes on settle (onChanged=loadOwed), so it now
reads $0 when the club is square. Display/query only.

### 173.4.260716 — expense detail spells out guest → sponsor settlement (no migration)
In the expense/bet detail view, guest rows didn't make clear that the guest doesn't settle directly — the
sponsoring member does. Now each guest row shows "guest of <sponsor>" with the direction: in Paid by,
"<sponsor> is paid this" (a guest's winnings go to the sponsor); in Split, "<sponsor> pays this" (a guest's
share is owed by the sponsor). Plus a one-line footnote when any guest is in the expense. Display only.

### 173.5.260716 — guest→sponsor clarity in the bet views too (no migration)
Extends 173.4 everywhere guests appear in a money context. The game's NET RESULT list and the "Confirm bet
winnings" modal now show, under each guest row, "guest of <sponsor> · <sponsor> is paid this" (guest won)
or "<sponsor> pays this" (guest lost) — so it's explicit that the sponsoring member settles the guest's
balance. Matches the expense-detail wording from 173.4. Display only.

### 173.6.260716 — test-mode frame respects the notch (no migration)
The red TEST-MODE border frame was position:fixed inset:0, so its top edge ran behind the notch/status
bar (the bottom looked fine, tucked behind the nav). Inset the frame's top by env(safe-area-inset-top) so
the top border sits just below the notch; the "TEST MODE" tab now hangs from that edge (top:0 within the
frame). Bottom unchanged. Same safe-area-top principle the bottom sheets use to cap their height. Display only.

**Institutionalized (so this class of bug can't recur):** new CI guard `ci/check-safe-area-frames.py` fails any fixed, top-anchored (inset:0/top:0) element that draws a border without env(safe-area-inset-top). Added APP_RULES #20 documenting it, and corrected the now-stale #19 to the per-Bucket settlement model. Wired ALL six UI guards into CI (new `npm run guards` step in .github/workflows/robustness.yml) — previously they only ran locally, which is how the notch border slipped through. Guards: min font size, global rules, chart overflow, date inputs, bottom sheets, safe-area frames.

### 173.7.260716 — notification popup respects the notch + guard now catches it (no migration)
The NotificationBell sheet capped its panel at maxHeight:"100%" and relied on the backdrop's paddingTop to
hold it below the notch. That indirection didn't hold on iOS (100% resolves against the full-screen fixed
overlay), so the panel top still rode under the notch. Switched it to the canonical cap the money sheets
use — maxHeight: calc(100dvh - env(safe-area-inset-top) - 20px) — so the panel is explicitly smaller than
the screen by (notch + 20px); the list below already scrolls (flex:1; minHeight:0; overflowY:auto).
Institutionalized: check-bottom-sheets.py now flags ANY viewport-relative maxHeight (%, vh, or dvh) that
doesn't subtract env(safe-area-inset-top) — previously it only caught bare "NNvh", which is why "100%"
slipped through. Verified it now fails the 100% pattern.

### 173.8.260716 — notification sheet: pin the top by POSITION, not height math (no migration)
Root cause of the recurring notch clip: the notification panel was a flex CHILD inside a position:fixed
inset:0 flex-end backdrop, capped by maxHeight. On iOS that flex-item + maxHeight + fixed-viewport combo
positions the top as a derived leftover of (screen − height), which doesn't hold — the top rode up under the
notch whenever the list got long (short sheets like the money popups never hit the cap, which is why only
this one showed it). Fix mirrors the red TEST-MODE frame, which never clips because it POSITIONS its top
edge (top: env(safe-area-inset-top)). The sheet now lives inside a bounds box pinned to that exact
notch-to-bottom rectangle (position:fixed; top: env(safe-area-inset-top); bottom:0) and docks inside it
(flex:"0 1 auto"; minHeight:0); the inner list scrolls (flex:1; minHeight:0; overflowY) with the nav
clearance moved into its padding. No maxHeight/dvh/box-model dependence. APP_RULES #17 updated with this as
the robust pattern for tall sheets. (The stat drawer + money sheets use the fixed-bottom:0 + maxHeight form,
which does work; only the flex-item variant was broken.)

### 173.9.260716 — notification popup bounded on ALL edges; guard no longer blind to it (no migration)
Extends 173.8. The sheet now sits in a bounds box inset ~12px off EVERY edge — top: calc(env(safe-area-inset-top)+12px),
bottom: calc(72px + env(safe-area-inset-bottom)+12px) — so the popup's MAX size is the safe usable rectangle
minus those margins; it can never reach the notch, the tab bar, or the home indicator, and it scrolls
internally when the list is long. Sheet is now a floating rounded card (all four corners, overflow:hidden).
Two guard fixes so this is actually enforced: (1) the "decorative overlay" skip now inspects the element's
OWN line instead of the whole window — the bounds box previously carried pointerEvents:"none" (since removed),
which made the guard silently skip the entire popup; (2) is_panel now recognizes env-top-managed bounds boxes
that span downward and requires them to reserve the bottom inset, and the inset checks are paren-agnostic so
the env(...,0px) fallback form counts. Verified: breaking the box's bottom inset now fails the guard.
Best-practice sizing captured in APP_RULES #17 (fill the safe rectangle and scroll; never size off the raw screen).

### 173.9.260716 — one popup primitive built on the screen perimeter (no migration)
Institutionalizes the rule: know the screen's safe usable rectangle (inside notch + nav/home indicator +
side insets, with a margin) and POSITION every popup inside it — never size a popup by height math.
Rebuilt the shared <BottomSheet> (components/ui.tsx) to be that one primitive: scrim + a bounds box
positioned to the perimeter (top: env(safe-area-inset-top)+margin; bottom: 72px + env(safe-area-inset-bottom)
+margin; left/right: margin) with the card docked inside (flex:"0 1 auto"; minHeight:0) and an optional
sticky header above a scrolling body. It knows the perimeter, so a tall popup fills the rectangle and scrolls
— it can't cross the notch or the nav. Moved the notification sheet onto it (was hand-rolled), so there's
one implementation, not two. APP_RULES #17 rewritten principle-first. Next: migrate the remaining hand-rolled
popups (stat drawer, tee-time sheets, money sheets) onto <BottomSheet> for full consistency.

### 174.0.260716 — Profile-tab handicap summary (WHS scoring record) (no migration)
New HandicapSummary card on the Profile tab (components/manage.tsx): app-estimated WHS Handicap Index with
the scoring record it's built from — Date, Course · tee (CR/slope), Adj (adjusted gross, capped at net
double bogey per hole), and Differential — for the last 20 eligible rounds, with the counting best-N marked
(gold dot) and the index shown as the average of those. If a manual/official index is entered it's shown as
the system of record with the delta, noting the official GHIN index supersedes the app estimate.
Sync guarantees (both requested):
- Reads the SAME rounds prop and SAME engine as the dashboard. Extracted lib/golf.ts `handicapRounds()`
  (the shared "played or gross-only" filter) and pointed the dashboard at it, so the two indices are
  computed from an identical set and cannot diverge. runningHandicap() is unchanged (already correct WHS:
  best 8 of 20, proper fewer-than-20 handling, no 0.96).
- Recalculates automatically on add/delete: the card is a pure function of the rounds state, and a delete
  soft-sets deleted_at then reloads rounds (excluding it), which re-renders both tabs.
Also extracted lib/golf.ts `adjustedGross()` (refactored roundDifferential to reuse it — differential values
unchanged, verified by the existing golf/card/badges suites) so the "Adj" column shows exactly the AGS that
produced each differential. New tests cover the net-double-bogey cap and handicapRounds. GHIN score-history
import/reconcile intentionally deferred (see BACKLOG) — no credential scraping.

### 174.1.260716 — tap a round in the handicap summary to open its scorecard (no migration)
Each round row in the Profile handicap summary is now tappable and opens that round's scorecard, using the
same setViewing/RoundDetail path the dashboard uses (threaded onOpen through ProfilePanel → HandicapSummary).
Rows show a chevron, use pointer cursor, and are keyboard-activatable (Enter/Space, role=button). Back
returns to the Profile tab.

### 174.2.260716 — handicap summary: "your next round" roll-off preview (no migration)
When you have MORE than 20 acceptable rounds, the Profile handicap card now previews what your next posted
round does: it shows the round rolling off (oldest of the current 20), the differential threshold your next
round must beat to make the counting best 8, and — if it's above the threshold — the index you'd land on as
the oldest rolls off (which can already differ from today's if the roll-off round was one of your counting
8). Logic is a tested lib/golf.ts `nextRoundOutlook()` (not inline), with a unit test covering the roll-off
identity, the 8th-lowest-of-19 threshold, and the resulting index. Hidden at 20 or fewer rounds.

### 174.3.260716 — show rating/slope everywhere + tappable differential explainer (no migration)
Rating/slope now appear wherever a round is listed: the round-list rows (RoundRow), the round summary
header (RoundDetail), and the Profile handicap table (already had it). New shared DifferentialSheet
(components/ui.tsx, built on the BottomSheet perimeter primitive) explains a round's Score Differential with
its actual numbers substituted step by step: the formula (113 ÷ Slope) × (Adjusted Gross − Course Rating),
the three inputs with plain-language notes (incl. how adjusted gross is capped at net double bogey / filled
at net par / gross-only total), the substituted arithmetic, and the final rounded result. Opened by tapping
a differential in the Profile scoring table (dotted underline + hint; taps don't trigger the row's
scorecard-open) or the "How it's calculated ›" differential pill on the round summary. First real consumer
of the BottomSheet primitive.

### 174.4.260716 — consistent dark-theme colours + contrast rule/guard (no migration)
Fixed the "how this differential is calculated" sheet (and the handicap card's nested boxes), which used the
LIGHT-surface colour C.card (#FFFDF6, ~white) with LIGHT text (cream/sage/gold) — unreadable, off-theme.
Recoloured to the app's dark-sheet convention: greenMid panel, greenLight nested boxes, cream/sage/gold text,
subtle rgba(255,255,255,.08–.12) dividers (not C.line). Made it a global rule (APP_RULES #21): text and
surface colours must come from the same light/dark family — light surfaces (C.card/cream) use dark text
(ink/faint); dark surfaces (green*) use light text (cream/sage), gold as accent. New ci/check-contrast.py
(added to `npm run guards`) fails any single element that sets a background and same-family text; verified
clean across the app (the parent/child cases it can't judge statically are covered by the rule).

### 174.5.260716 — popups always have a × (baked into the primitive) + guard (no migration)
The differential sheet shipped without a close × — violating APP_RULES #18 — because no guard checked it and
I relied on memory. Two fixes: (1) the shared <BottomSheet> now ALWAYS renders a top-right × (translucent
chip, contrasts on any dark panel) whenever given onClose, so every popup built on it complies by
construction; removed the notification sheet's now-duplicate hand-rolled ×. (2) New ci/check-popup-close.py
(added to `npm run guards`, 8 guards total) fails any <BottomSheet> missing onClose. Rule #18 updated to note
the primitive provides the × and the guard enforces it. Process gap owned: rules without a guard weren't being
cross-checked; the durable fix is baking rules into the shared primitive (perimeter/notch, contrast, and now
the × are all automatic there) plus a guard per rule. Remaining hand-rolled popups (stat drawer, tee-time
sheets, money sheets) still carry their own × and should migrate to <BottomSheet> for full consistency.

### 175.0.260717 — badge fixes: collapse score ladder, repeatable counts, tappable "how earned" (no migration)
Four fixes to round badges (all visible on the round summary):
1. Score ladder collapses to the best earned — breaking 90 no longer also shows Broke 100; broke_par
   supersedes the whole ladder. New collapseRoundAwards() in lib/badges.ts, applied in round-detail's
   roundBadges (display only — lifetime "rounds under 100" counts are unaffected).
2. Repeatable counts now show ×N. Birdie ×2, eagles, par-3 birdies, bounce-backs, etc. render a gold ×N
   bubble on the badge when value > 1 (the award already carried the value; the tile just never showed it).
3. Net bogey-free streaks count each SEPARATE run. evaluateRound now counts distinct net-par-or-better runs
   (≥3 for bogey_free_3, ≥5 for bogey_free_5) instead of only the longest, so 3 separate 3+ streaks show ×3.
   (Changes those lifetime counts to sum-of-streaks — more granular; recomputed on backfill.)
4. Every badge is tappable → a sheet explaining exactly how it was earned, with the specific holes
   highlighted (e.g. bounce-back: "Birdie right after a bogey — hole 3"). Uses the existing badgeEvidence();
   fixed a real bug there: the net bogey-free evidence was computed on GROSS, now on NET to match the award,
   and it lists ALL qualifying runs. Sheet is built on BottomSheet (dark theme + baked-in × + perimeter fit).
Tests added for streak counting, birdie count, and ladder collapse (badges suite 64 passed).

### 175.1.260717 — popup migration: all bottom sheets now use the BottomSheet primitive (no migration)
Migrated every hand-rolled bottom sheet onto the shared <BottomSheet>, so they all inherit the three
guarantees automatically — perimeter/notch fit (#17), dark-theme contrast (#21), and the top-right × (#18):
• money.tsx (7): Zelle pay, confirm-on-return, pay-method chooser, settle preview, snapshot detail,
  expense detail, per-member balance breakdown. Several also had C.faint on dark green (a #21 issue) — fixed
  to sage while migrating. All seven gained the × they were missing.
• tee-times.tsx (3): "Your response" RSVP, captain picker, captain duties. DutiesModal was a leftover LIGHT
  (C.card/ink) sheet while the other two were dark — converted it to the dark palette so the sheets match.
• manage.tsx (1): the admin stat drill-down drawer (StatDrawerHost) — dropped its bespoke slide animation and
  hand-rolled ×; now a conditional <BottomSheet>.
The confirm-on-return sheet keeps dismissOnBackdrop=false (must decide) but its × acts as "not yet".
Not migrated (different pattern, left as-is): centered modals (player card, finish-round confirm), the
share-card image modals, the hole score-entry editor, the photo lightbox, and the "More" dropdown menu.

### 175.2.260717 — score box shows a greyed par placeholder instead of "no score" (no migration)
On both the individual and group scorecards, an unscored hole now shows the hole's par greyed out (dashed
box) instead of a "+"/"·" — consistent with how the putts field shows a grey default. The hole editor
likewise shows par greyed with a "grey = par, tap to record" hint. A score is now recorded ONLY when the
scorer taps a selection: removed the two places that silently auto-committed par — the individual card's
open-hole handler (openEdit) and the group card's "Next" advance (goNext). This makes group and individual
behave identically and prevents accidental par entries. Editor +/-, quick-picks, and pickup still register
on tap as before.

### 176.0.260728 — side contests foundation: schema + engine (migration 0122 — MUST RUN)
Data layer + reduction engine for CTP / longest-drive / straightest side contests (large events). No UI yet
— that's the next increment (Contests view: create/edit/void + leaderboard + self/scorer entry, then a
contextual hole chip). Ships:
- migration 0122_side_contests.sql — game_contests + APPEND-ONLY game_contest_entries + RLS (participants
  read via can_see_game; ALL writes via SECURITY DEFINER RPCs) + create/update/delete_game_contest,
  log_contest_entry (self-entry any member; for-others = organizer or a scorer/marker), void_contest_entry
  (organizer or the recorder). RUN THIS IN THE SUPABASE SQL EDITOR (after 0121) — full SQL printed inline.
- lib/contests.ts — the order-independent per-hole min/max reduction (the append-only sync guarantee),
  overall-leader tally, par-3 detection, value format/parse. 26 unit tests (order-independence, ties,
  voids, per-hole CTP, formatting) wired into `npm test`.
Nothing user-visible changes until the UI lands; the migration is safe to run now (additive, idempotent).

### 176.1.260728 — side contests UI (no migration; needs 0122 from 176.0)
The Contests view is live in the game room's play tab (new components/contests-view.tsx), built on the 176.0
engine + RPCs:
- Everyone in the event sees a "SIDE CONTESTS" card with each contest's per-hole leader (CTP shows a row per
  par-3; longest/straightest show their hole). Tap "N attempts" to expand the full list.
- Organizer (+ Add): pick closest-to-pin (auto-fills all par-3s), longest drive, or straightest (pick the
  hole); remove a contest (× ). Editable during the event, not just at setup.
- Logging: "Log" on any hole opens a sheet — feet+inches for CTP/straightest, yards for longest. Defaults to
  the current player (self-entry, any member); a scorer/organizer can pick another member or a guest.
- Void: expand a hole's attempts; the organizer or the person who recorded an entry can void a bad one.
- Live: subscribes to game_contests / game_contest_entries realtime so leaders update as groups post.
Dogfoods the rules — both sheets are BottomSheet (dark theme, perimeter fit, baked-in ×). Requires migration
0122 (shipped 176.0) to be run first, or the card shows a load error.

### 176.2.260728 — side contests: contextual hole chip (no migration; needs 0122)
The score-entry modal now nudges at the hole. HoleScoreModal gained an optional belowPicker slot; the group
score modal fills it with a new ContestHoleChip (components/contests-view.tsx) that shows any contest applying
to this hole ("🎯 Closest to pin — best 6'3\" (Priya)"), with an inline Log form (feet+inches / yards, no
nested sheet) defaulting to self; a scorer can attribute to another player or guest. Styled for the light
modal. Individual round editor passes no slot, so it's unaffected. Completes the side-contests spec (setup +
Contests view + hole chip); requires migration 0122.

### 176.3.260728 — fix: app updated without confirmation (PWA regression)
Root cause: the "App version & updates" card (UpdateChecker in manage.tsx) ran check() on mount and posted
SKIP_WAITING to any waiting/installing service worker UNCONDITIONALLY — the autoReload flag only guarded the
version-json reload branch, not the SW activation. Activating the worker fires controllerchange in
register-sw.tsx → window.location.reload(). So simply opening the Manage/Admin screen silently applied a
pending update and reloaded, bypassing register-sw.tsx's "A new version is available — [Update]" banner. It
surfaced now because today's several back-to-back deploys mean clients frequently have a worker waiting when
they open that screen. Fix: check(apply) now only ACTIVATES/reloads when apply=true (the explicit "Update to X"
tap). On mount and "Check for updates" (apply=false) it detects only — reports status and surfaces the Update
button, never posting SKIP_WAITING and never reloading. sw.js and register-sw.tsx unchanged (both already
user-driven). Confirm-before-update is restored.

### 176.4.260729 — security batch (external review, "before next deploy" items) — migration 0123 MUST RUN
Addresses the highest-priority findings from the code review:
- /api/analyze-round now REQUIRES an authenticated Supabase session; enforces a DB-backed atomic daily
  limit (per-user + global via bump_ai_usage) instead of a bypassable in-memory counter; rejects bodies
  >24KB, clamps history to 40 rounds; adds fetch timeouts (5s model discovery, 25s generation).
- /api/courses now REQUIRES auth; enforces min query length 3, strict numeric id validation, an 8s upstream
  timeout, and a 60s per-instance cache for identical searches.
- record_migration execute revoked from authenticated/anon/public (owner/service role only).
- New helper lib/supabase-route.ts (server client bound to request cookies for route auth).

BEHAVIOR CHANGES (per standing rule — anything that alters existing behavior is called out):
- AI analysis and course search now return 401 if called without a signed-in session. Both are only used
  from inside the logged-in app, so no user-facing flow should break; noting it explicitly.
- The AI per-user cap is now enforced server-side (2/day, env GEMINI_USER_DAILY_LIMIT), so it can no longer
  be bypassed by clearing client state. Global cap stays env GEMINI_DAILY_LIMIT (default 200).

NOT changed in this batch (tracked as follow-ups): tee-specific par/SI storage (finding 4), the raise-vs-
return consistency across older admin RPCs (finding 14), migration-directory consolidation (finding 12).

### 176.5.260729 — refactor groundwork: extract shared game types (no behavior change)
Modularity stage 0. Moved the Game and Player type definitions out of components/tournaments.tsx into
lib/game-types.ts and imported them back. Types only — no runtime code — so this cannot change behavior;
tsc + build confirm. This unblocks moving the many self-contained components currently trapped in the
7,272-line tournaments.tsx into their own files (stage 1, next). No migration.

### 176.6.260729 — refactor stage 1: split leaf components out of tournaments.tsx (no behavior change)
Moved two contiguous, self-contained blocks out of the 7,272-line tournaments.tsx into their own files:
- components/game/scoring-views.tsx — ScoreHistory, SkinsView, MatchView, FourballView, StrokesSummary +
  the sweep banners (SweepBroom, CleanSweepBanner, SweepTrophy, SweepAchievedBanner, TeamClinchLine).
- components/game/segment-views.tsx — LegConfigEditor, SegmentBoard, GroupSegmentSummary.
Shared helpers they used were extracted to reusable modules: lib/game-colors.ts (teamAccent +
TEAM_COLOR_BY_NAME) and lib/game-types.ts (Game/Player, from stage 0). tournaments.tsx: 7,272 -> 5,645 lines.
Behavior-preserving: pure relocation, no logic changed; tsc + build + tests + 8 guards all green.
Also fixed a safety-net gap the move exposed: 5 CI guards used a non-recursive glob("*.tsx") that would have
skipped components/game/*; switched them to rglob so subdir components stay covered. No migration.

BEHAVIOR CHANGES: none (relocation only).

### 176.7.260729 — refactor stage 1b: move the game panels, under a real test protocol (no behavior change)
Moved the four larger, side-effect-bearing panels out of tournaments.tsx:
- components/game/scorecard-views.tsx — GroupScorecard, GroupsBuilder, ShareControl.
- components/game/organizer-panel.tsx — OrganizerPanel, BettingPanel.
tournaments.tsx: 5,645 -> 4,011 lines (7,272 -> 4,011 across the whole refactor, -45%).

Verified under TEST_PLAN.md (new):
- Tier A automated equivalence: ci/verify-relocation.py (new) proved all four components are BYTE-IDENTICAL
  to their pre-move source (hashes the component body, normalizing only the added `export`); tsc clean;
  next build compiles; npm test green; all 8 guards green.
- Because these do ~23 Supabase writes, TEST_PLAN.md includes a Tier C manual QA click-through (post/unpost/
  repost a bet, set/randomize tee groups, claim/take-over/release a group, format switch + structure restore,
  share toggle, end game) to run on the "App Testing" club after deploy — the only way to exercise the writes.
No migration. BEHAVIOR CHANGES: none (relocation only; byte-identity proven).

### 176.8.260806 — resume scoring at the right hole after a lock/refresh (group card)
When a phone locks or the PWA is evicted and reopens, the game-level resume already returned you to the game,
but the group scorecard reset to the top (hole 1). Now it returns you to where you were scoring:
- lib/draft.ts: the active-game resume record gained an optional holeIdx; new saveActiveHole(gameId, holeIdx)
  merges it without clobbering the tab; loadActiveGame() returns it.
- components/game/scorecard-views.tsx (GroupScorecard): persists the hole whenever a cell is opened/advanced;
  on first mount with players loaded, scrolls to the resume hole using OPTION 3 — the hole you were on if it's
  still incomplete, otherwise the next hole that still needs scores. Fresh games (no stored hole, nothing
  scored) stay at the top, so nothing changes for a new round.
Scores were always safe (autosave); this restores VIEW position only. Group card only for now — the individual
round editor is a fast-follow if wanted.

BEHAVIOR CHANGE (per standing rule): on opening a group scorecard that has a saved position, the card now
auto-scrolls to the resume hole instead of starting at hole 1. It never changes data and never opens a sheet.
Manual QA: score holes 1–5, lock the phone mid-round, reopen → lands on hole 5 (if incomplete) or 6 (if 5 done).

### 176.9.260806 — resume-hole on the individual round editor (Piece 1 of the "come back to where I was" work)
Extends 176.8's group-card resume to the solo scorecard. lib/draft.ts: saveDraftHole/loadDraftHole (keyed by
round id; cleared with the draft). components/ui.tsx ScoreEntryCard gained onActiveHole (fires when a hole's
editor opens) + resumeHole (scrolls that hole into view on mount, via new sehole-N anchors).
components/round-editor.tsx computes the option-3 target once at mount (the hole you were on if incomplete,
else the next hole needing a score) and passes both. Scores were already draft-safe; this restores view
position. BEHAVIOR CHANGE: opening the solo editor with a saved position scrolls to that hole instead of the
top. No migration.

### 176.10.260806 — unsaved-changes machinery + guard on the course editor (Piece 2, part 1)
Reusable core for "don't lose my edits":
- lib/draft.ts: saveEditorDraft/loadEditorDraft/clearEditorDraft — generic keyed form-draft persistence
  (12h TTL). This is the piece that will let edits survive a phone lock/background (persistence still to be
  wired per-form — see below).
- components/ui.tsx: useUnsavedGuard(dirty) (beforeunload on desktop refresh/close) + <UnsavedChangesSheet>
  (shared Save / Discard & leave / Keep editing confirm, built on BottomSheet).
First consumer — round-setup course editor: Cancel now checks hasMaterialCourseChanges(originalPicked, picked)
and, if you've edited rating/slope/yardage/par/SI without saving, shows the sheet instead of discarding
silently. Save runs the existing course-correction save; Discard leaves; Keep editing returns.

HONEST SCOPE: this is the WARNING half (intentional navigation). The persistence half — auto-restoring
in-progress edits after a phone lock/background — is NOT yet wired into round-setup; it's the delicate part
(seeding a 15-field critical flow) and gets its own pass with manual QA. On mobile, beforeunload does not fire
on lock, so only persistence fixes the lock case; the guard fixes accidental in-app Cancel.

BEHAVIOR CHANGE: tapping Cancel in round setup with unsaved course edits now warns instead of discarding.
Manual QA: edit a course's rating/slope in setup, tap Cancel → sheet appears; Keep editing / Discard / Save all behave.

### 176.11.260806 — round-setup edits survive a phone lock/background (Piece 2, part 2 — persistence)
Wires the 176.10 editor-draft store into the round-setup flow so an involuntary interruption no longer wipes
in-progress edits (the case beforeunload can't catch on mobile):
- On change, the setup's meaningful fields (picked course incl. edited tees, originalPicked baseline, teeIdx,
  handicap index, play date, custom-course fields, gross entry, course-correction reason, editingTee,
  loadedFavId) are saved under key "round-setup" (12h TTL).
- On mount the state is SEEDED from that draft via lazy initializers (not post-mount setters), so it doesn't
  fight the existing effects. The one hazard — the effect that re-snapshots originalPicked from picked on mount
  — is suppressed for the first render when restoring (skipSnapshotRef), so "edited vs original" (and thus the
  correction-reason prompt + the unsaved-changes guard) survive the restore.
- The draft is cleared on create (onReady), on gross-round save, and on any intentional Cancel/Discard — so it
  ONLY persists across an involuntary lock/background, never after you deliberately leave. Fresh opens with no
  draft behave exactly as before.

BEHAVIOR CHANGE: opening round setup after a lock/background now restores your in-progress course edits and
setup instead of a blank form.
HIGH-VALUE MANUAL QA (critical flow — please run): (1) pick a course, edit a tee's rating/slope/yardage, lock
the phone, reopen → edits are back AND the course-correction reason prompt still shows. (2) Create a round →
reopen setup is blank (draft cleared). (3) Cancel with edits → Discard clears; reopen is blank. (4) Fresh open
with no prior draft → normal empty form. (5) Gross-only round save → leaves clean, no stale draft.

### 176.12.260806 — fix resume-hole: land on the last SCORED hole, keep the hole number visible
Feedback on 176.8/176.9: after scoring 2 holes + 3 of 4 players on hole 3, reopen landed on hole 4 (skipping
the incomplete hole 3) and the scroll hid the hole number behind the sticky header. Fixes both:
- Target is now the LAST hole that has ANY score (data-derived), not "next unscored". So you land on the hole
  you were working on — an incomplete hole is shown, not skipped — with the next holes just below.
- Scroll now offsets by the sticky header's measured height (tagged id="scorecard-sticky"; solo editor uses the
  same, default 72px), so the hole number stays visible instead of being covered.
Applies to both the group card (scorecard-views.tsx) and the solo editor (round-editor.tsx + ScoreEntryCard).
The old edit-based stored-hole persistence is no longer used for targeting (kept, harmless). No migration.

### 176.13.260806 — two fixes: sticky per-section scorecard header + reopen INTO the course editor
Fix 1 (individual scorecard header): the solo scorecard renders front 9 and back 9 as two cards, each with a
column header (Par/Score/FW/GIR/Putt/Pts). Each card's header is now position:sticky so it stays pinned while
you scroll that section, and the back-9 header takes over when you reach it (components/ui.tsx ScoreEntryCard
GridRow header branch).

Fix 2 (course-edit resume — the real bug behind "changes lost"): 176.11 persisted round-setup edits, but on
reopen the app landed on the DASHBOARD, never back in the editor, so the restore never showed and edits looked
lost. home.tsx's reopen-resume now checks for a pending round-setup draft (loadEditorDraft("round-setup")) and,
if present, reopens the setup screen — where 176.11's field restore then repopulates the course + edits.
Priority sits after the active-game and in-progress-round resumes, before the server round check. The draft is
still cleared on create/cancel/discard, so this only fires after an involuntary interruption. No migration.

BEHAVIOR CHANGE: after a lock/background while editing a course in round setup, the app now reopens into the
course editor with your edits restored, instead of the dashboard.

### 176.14.260806 — reopen INTO the Manage course editor + sticky FRONT/BACK NINE header
Fix 1 (the real "course tab" bug): editing a course via Manage → Courses is a SEPARATE editor (CourseEditor/
CourseForm) from round setup. Its edits were already persisted (form-draft), but on reopen the app landed on
the dashboard, so the restore never showed. Added a resume: openEditor saves an active-course-edit marker
(lib/draft saveActiveCourseEdit); home boot routes to the Courses tab when the marker exists; CoursesLibrary
reopens the editor on mount; the marker clears on cancel/save. The editor's existing form-draft then restores
the edited rating/slope/yardage. So editing a course on the Courses tab now survives a lock and reopens into
the editor. (Note: the Manage editor already keeps edits recoverable via its form-draft, so no separate
warn-on-cancel popup was added there — offer if you want it for consistency.)

Fix 2 (sticky scorecard header): the FRONT NINE / BACK NINE label now sticks WITH the column header as one
clean pinned bar (components/ui.tsx ScoreEntryCard), instead of the columns pinning alone at the very top.

BEHAVIOR CHANGE: after a lock/background while editing a course on the Courses tab, the app reopens into that
course editor. No migration.

### 176.15.260806 — two fixes: existing-course edits now persist/restore; sticky header keeps card top
Fix 1 (course edits not saved — the real cause): the course form-draft only saved/loaded for NEW courses
(isNewCourse gate). Editing an EXISTING course persisted nothing, so the reopen had nothing to restore. Now the
draft is keyed per course (bnn_course_draft:group:id) and saves + restores for existing edits too — on reopen it
auto-restores your rating/slope/yardage changes. Cancel now clears the draft (handleCancel) so a cancelled edit
doesn't resurface. (manage.tsx CourseEditor.)
Fix 2 (sticky header polish): the pinned FRONT/BACK NINE bar now keeps the card's rounded top corners + a top
border (and the card gained a light border), so it reads as the card's top staying put rather than a flat bar.

BEHAVIOR CHANGE: editing an existing course now persists across a lock/refresh and auto-restores on reopen;
Cancel discards the in-progress course draft. No migration.

### 176.16.260806 — course-freshness feature: foundation (diff helper + data layer) — migration 0124
First piece of the "flag upstream course changes" feature (design locked with Amit). No user-facing behavior
yet — sets up the pieces the next increment wires into round-setup:
- lib/course-diff.ts: buildFreshnessDiff (stored vs API: per-tee rating/slope + per-hole yardages) + applyFreshness.
- migration 0124: course_freshness cache table + record_course_freshness RPC (daily throttle cache; notifies
  group admins when a change is newly detected; preserves dismissed/applied decisions).
NEXT (increment 2): on course select in round-setup, daily-throttled check → cache → admin-only prompt (play
with updated / keep / submit for review) and silent fresh-yardages for non-admins.

### 176.17.260806 — course-freshness feature: the visible half (round-setup) — migration 0124 (updated)
Wires the freshness check into round setup. When you pick a SAVED library course that has an API id:
- Daily-throttled check: reads the course_freshness cache; only if stale (>24h) does it hit the API, diff via
  buildFreshnessDiff, and record the result (which flags admins on a newly-detected change). First person
  triggers it; everyone else that day reads the cache.
- ADMIN (group role='admin'): a sheet shows the per-hole yardage changes + any rating/slope change, with
  "Play this round with the updated data" / "Update the stored course (applies for everyone)" / "Keep current".
  "Update stored course" writes favorite_courses.data and clears the flag; "Keep current" marks it dismissed.
- NON-ADMIN: no prompt — silently plays the round with the fresh yardages (rating/slope untouched, so handicap
  math is unaffected until an admin approves).
Migration 0124 now also includes set_course_freshness_status (dismiss/apply). RUN 0124 (updated) if you ran the
earlier copy, re-running is safe (idempotent — it re-creates the function).

BEHAVIOR CHANGE: picking a saved course with upstream changes now flags admins (prompt + notification) and gives
non-admins fresh yardages for the round. Handicap-affecting rating/slope only change via admin approval.

### 176.18.260806 — scorecard sticky header: keep the card's rounded top corners when pinned
The pinned FRONT/BACK NINE bar was inset from the card's border by 1px, so when the card's rounded top scrolled
away the straight side borders met the header's inset corners and the top read as square. Aligned the sticky
header to the card's OUTER edge (margin -11 vs -10) so its rounded corners + border ARE the card's top corners,
and stay rounded while scrolling. (components/ui.tsx ScoreEntryCard.) No migration.

### 176.19.260806 — scorecard sticky header: rounded corners fold into the green (approved mockup)
Per the approved mockup: the pinned FRONT/BACK NINE header is now a two-layer bar — a square GREEN backing
(matches the page) behind a cream bar with rounded top corners + border. The green shows through the bar's
rounded corner notches, so the header folds into the background instead of showing square cream corners.
(components/ui.tsx ScoreEntryCard.) No migration.

### 176.20.260806 — refactor: move GameList out of tournaments.tsx (no behavior change)
Moved GameList (the games list) into components/game/game-list.tsx. The shared GameSeed type (a tee-time
handoff seed used by CreateGame + home) that physically sat after GameList moved to lib/game-types.ts and is
re-exported from tournaments so home's import is unchanged. tournaments.tsx: 4,011 -> 3,807 lines. GameList's
function body is byte-identical; tsc + build + tests + guards all green. What remains in tournaments.tsx is now
essentially just the two god-components (CreateGame ~1,050, GameRoom ~2,470) + small helpers. No migration.

### 176.21.260806 — Stage 2 begins: extract player-scoring logic to a tested lib module (no behavior change)
First pure-logic extraction out of the GameRoom god-component, done tests-first per the plan:
- lib/player-scoring.ts: playerHoles / playerPoints / playerThru / playerGross / playerNet / relToParStr /
  parThru / leaderName — moved VERBATIM from GameRoom, now pure functions of (player, game).
- GameRoom keeps thin wrappers that delegate to the lib functions, so every call site is unchanged.
- lib/player-scoring.test.ts: 45 assertions covering every path — null game; stroke allocation at ch 0/2/10(+50%
  allowance)/20; partial/full/empty/null/zero scores; Stableford par/birdie/eagle/bogey/double + net-par-via-stroke;
  net with/without received strokes incl. strokes on unplayed holes; rel-to-par under/even/over; parThru on mixed
  pars; and leaderName across all branches. Wired into `npm test`.
- Also made lib/game-types.ts import LegConfig via a relative path (./legs) so the bare test compiler resolves it.
Verification: 45/45 new tests pass, full suite green, tsc clean, build compiles, 8 guards pass. Behavior is
preserved by construction (verbatim move + unchanged call sites) and proven by the exhaustive tests.
tournaments.tsx: 3,807 -> 3,774. No migration.

### 176.22.260806 — differential verification of the player-scoring extraction (test infra only)
Per the new standard (REFACTOR_VERIFICATION.md): added lib/player-scoring.baseline.ts (the ORIGINAL inline
logic, verbatim) and lib/player-scoring.diff.test.ts, which runs the structured edge cases + a 7,000-case
deterministic fuzz through BOTH old and new and asserts identical outputs. Result: 32,463 comparisons, 0
mismatches — the 176.21 extraction is proven behavior-identical to the pre-change code. Test-only files; no app
change. This differential (old-vs-new) method is now the standard for every future logic extraction.

### 176.23.260806 — extract finish-gap logic (differentially verified)
Second Stage-2 extraction, following REFACTOR_VERIFICATION.md. Moved computeFinishGaps + finishListFmt +
FinishGap type out of GameRoom into lib/finish-gaps.ts (pure, given players + holes_meta); GameRoom keeps thin
wrappers so call sites are unchanged. Verification: lib/finish-gaps.test.ts (18 unit assertions across every
path — no-show, no scores, missing scores, putts/fairways tracking on/off, par-3 fairway exclusion, combined,
multi-player) + lib/finish-gaps.diff.test.ts vs a verbatim baseline (7,490 comparisons, 0 mismatches). tsc clean,
build compiles, guards pass. No behavior change; no migration.

### 176.24.260806 — extract ranking values (ouVal/strokeTotal/rankVal), differentially verified
Third Stage-2 extraction. Added ouVal / strokeTotal / rankVal to lib/player-scoring.ts — they REUSE the
already-extracted playerThru/playerPoints/playerNet/playerGross (the point of the modular path). GameRoom keeps
thin wrappers; isStroke/strokeNet stay local (used elsewhere too). Verification extended the existing suite:
player-scoring unit 45 -> 54, differential 32,463 -> 44,471 comparisons, 0 mismatches (baseline transcribed
independently from the original; fuzz now varies game_type + stroke_basis to hit every ranking branch). tsc
clean, build compiles, guards pass. No behavior change; no migration. tournaments.tsx now ~3,754 lines.

### 176.25.260806 — extract six-hole segment helpers (segOf/segLeadersFrom), differentially verified
Fourth Stage-2 extraction. lib/segments.ts: segOf + segLeadersFrom + SEG_LABELS + SegLeader type — REUSE
playerHoles (lib/player-scoring) and netBySix/stablefordBySix (lib/golf). GameRoom keeps thin wrappers; the
local segLabels const is gone (now SEG_LABELS in the module). Verification per REFACTOR_VERIFICATION.md:
lib/segments.test.ts (20 unit assertions — stableford/stroke segOf, single leader, ties, partial-segment
started/complete/thru flags, empty rows) + lib/segments.diff.test.ts vs an independently transcribed baseline
(13,867 comparisons across 4,000 fuzzed multi-player games, 0 mismatches). tsc clean, build compiles, guards
pass, full suite green. No behavior change; no migration. tournaments.tsx ~3,730 lines.

### 176.26.260806 — extract leaderboard ordering (sortLeaderboard/posWithin/tiedWithin), differentially verified
Fifth Stage-2 extraction. Added sortLeaderboard / posWithin / tiedWithin to lib/player-scoring.ts — REUSE
rankVal + playerPoints (stableford tiebreak: same rank value, more raw points first; stroke: stable order).
GameRoom keeps thin wrappers; renderLeaderRow (JSX) stays put. Verification: unit 54 -> 63 (order, no input
mutation, positions, ties, the points tiebreaker with a corrected expectation — the first version of the new
test had a wrong expected value, caught by the suite itself and fixed to genuinely exercise the tiebreak path;
two-Infinity stable order documented) + differential 44,471 -> 60,429 comparisons, 0 mismatches (board fuzz:
2,000 multi-player leaderboards with forced ties + not-started players). tsc clean, build compiles, guards pass.
No behavior change; no migration.

### 176.27.260806 — extract game-setup utilities (game-utils), differentially verified
Sixth Stage-2 extraction: lib/game-utils.ts = makeCode, defaultTeeIdx, todayLocalStr,
normalizeFavoriteCourse, GP_STATE_DEFAULTS, refTee, blankCard — moved verbatim from tournaments.tsx
(module-level helpers + the GameRoom refTee/blankCard closures, now wrappers). Verification per
REFACTOR_VERIFICATION.md: unit 21 assertions (code format, tee-default branches incl. member-name and
closest-to-6400, date format, course normalization branches, refTee fallbacks, blankCard sizing) +
differential vs an independently transcribed baseline: 12,003 comparisons, 0 mismatches. makeCode is
compared under a stubbed deterministic Math.random (identical streams -> identical codes). NOTE: the first
diff run reported 333 mismatches — a bug in the TEST HARNESS (different `smart` args drawn for old vs new),
not in the extraction; fixed so both sides receive identical inputs, then clean. tsc clean, build compiles,
guards pass. No behavior change; no migration. tournaments.tsx 3,723 -> 3,678 lines.

### 176.28.260806 — extract game-creation logic (game-create), differentially verified — STAGE 2 COMPLETE
Seventh and final Stage-2 extraction: lib/game-create.ts = buildGamePayload (the full games-insert object
with every team/foursome/score-mode/flight branch), buildPlayerRows (creator+members+guests rows with course
handicaps, flight assignment via lib/flights flightForIndex, and the <=4 tee-group default), splitSkinsTooBig,
and gameTypeLabel. CreateGame's create() now calls these; all supabase side-effects stay in the component.
REUSES courseHandicap (golf), flightForIndex (flights), GP_STATE_DEFAULTS (game-utils). Verification: 38 unit
assertions across the branch matrix + differential vs an independently transcribed baseline: 9,000 comparisons
(4,000 payload option combos, 2,000 skins checks, 3,000 roster/guest row sets), 0 mismatches. (One in-progress
diff-harness line that would have passed different args to old/new was caught in review and removed before the
run.) tsc clean, build compiles, guards pass. tournaments.tsx 3,678 -> ~3,580 lines. No migration.

STAGE 2 IS COMPLETE: all pure logic in GameRoom + CreateGame now lives in tested lib modules
(player-scoring, finish-gaps, segments, game-utils, game-create + reused golf/flights/game-shape). Cumulative
differential proof this stage: ~103,000 old-vs-new comparisons, 0 mismatches. Remaining god-component mass is
stateful sync + render trees = Stage 3/4 (hooks + view decomposition), a separate careful campaign.

### 176.29.260806 — cold-eyes code review of the recent arc: two real bugs fixed
Fresh-eyes review of everything shipped in the 176.x arc. Two REAL bugs found and fixed:
1. Course freshness: a DISMISSED (or applied) change re-prompted after the 24h cache expired — the client
   returned status "pending" after any fresh re-check, ignoring the dismissed/applied status the RPC
   deliberately preserves. Now reads the resulting status back after recording (lib/course-freshness.ts).
   (Slipped past testing because C4 re-picked within the cache window.)
2. Courses-tab resume: the reopen marker was only cleared on Cancel/Save, so deliberately TABBING AWAY from an
   open course editor left it set — the next app open (within 12h) dropped you back into the abandoned editor.
   CoursesLibrary now clears the marker on unmount (deliberate navigation unmounts; a lock/refresh doesn't, so
   real interruptions still resume). (manage.tsx)
Reviewed and intentionally NOT changed (noted for the record): playWithFresh sets originalPicked inside a state
updater (works correctly in production; refactoring it risks more than it fixes — candidate for the Stage-3
hooks pass); the solo-editor resume scroll uses a 72px fallback because the per-section pinned header carries no
id (measured behavior fine in testing); GP_STATE_DEFAULTS spreads shared empty-array references into new rows
(pre-existing, harmless for inserts since values are serialized, flagged as a mutation footgun for later);
"update stored course" replaces data wholesale but the corrected flag survives via the row column fallback.
No migration.

### 176.30.260808 — security batch 1 (external review response) + the prevention standard — MIGRATION 0125 REQUIRED
Response to the Aug 2026 external security review. PREVENTION (the lesson, made mechanical):
- SECURITY_CHECKLIST.md — same status as REFACTOR_VERIFICATION.md; gates any new SECURITY DEFINER fn,
  broad EXECUTE grant, API route, or client-supplied id crossing into privileged code.
- ci/check_migration_authorization.py — new guard (in npm run guards + npm run ci): migrations >= 0125
  containing SECURITY DEFINER / broad grants MUST carry an "-- AUTHORIZATION:" header. Self-tested
  (passes with header, fails without).
- npm run ci — single command: tsc + guards + tests + build.
FIXES:
- Migration 0125 (REQUIRED — the client now calls the new signature): record_course_freshness derives
  the owning group SERVER-SIDE from favorite_courses and requires group membership (p_group_id removed
  from the signature and the client); set_course_freshness_status requires ADMIN of the owning group and
  validates the status; course_freshness.status gets a DB CHECK. Threat model: worst an arbitrary
  authenticated token can now do is record a freshness check for a course in a group it belongs to —
  notifications can only ever go to that same group's admins; status changes require that group's admin.
- Push (app/api/push): success now RESETS fail_count (transient blips can no longer accumulate into a
  permanent disable); missing configuration returns 503 (loud) instead of 200 (silent drop).
- Auth callback: exchangeCodeForSession failure now redirects to /?auth_error=1 instead of proceeding
  as if signed in.
- API error hygiene: analyze-round + courses log provider error detail server-side and return generic
  messages to clients (no upstream internals in responses).
- Baseline security headers app-wide (nosniff, frame DENY, referrer policy, permissions policy). CSP
  deliberately deferred to its own tested pass (BACKLOG).
- Sign-out now sweeps ALL bnn_* localStorage (drafts, caches, resume markers) so nothing lingers on a
  shared device.
Review findings assessed as overstated/deferred are recorded in BACKLOG (Next 15 upgrade = batch 2).

### 177.0.260808 — Next.js 16 + React 19 upgrade (framework majors; QA REQUIRED before relying on it)
Off the EOL Next 14 line onto Next 16.3.0 (Active LTS) + React 19.2.8, in one pass (skipping 15, which
itself EOLs Oct 2026). recharts pinned to 2.15.4 (React-19-compatible; deliberately NOT the 3.x major, to
keep QA surface minimal). 0 npm vulnerabilities; Node pinned >=20.9 (Next 16 min) via engines + .nvmrc.
CODE CHANGES (all the async-migration Next 15+ requires — blast radius was small, BNN being a client-heavy
single-page app):
- cookies() is async → lib/supabase-route.ts createRouteClient() is now async; its two callers
  (/api/courses, /api/analyze-round) await it; app/auth/callback awaits cookies().
- dynamic-route params is async → /join/[code], /live/[token], /organize/[gameId] now read the code/token/
  gameId via the client useParams() hook (was a sync params prop — a runtime bug tsc could NOT catch because
  the old type lied about being sync). /organize already used useParams.
- one React-19 ref typing fix (useRef<T>(null) now RefObject<T|null>) in the share-card export helper.
VERIFICATION BOUNDARY: tsc clean, full Next 16 build succeeds (all 9 routes generate), all unit + 5
differential suites pass (103k comparisons, 0 mismatches — logic untouched), 0 vulnerabilities. This proves it
COMPILES and pure logic is intact; it does NOT prove the running app (auth, realtime, PWA/service worker,
charts, image export, all interactivity under React 19) is correct — a framework major has no differential
proof. TEST_PLAN_177.0_NEXT16.md is the required manual sweep; rollback = redeploy 176.30 (0125 is
backward-compatible, no DB rollback needed).
MONITORING (so the next EOL is scheduled, not discovered): scripts/check-deps.mjs flags any watched major
behind (runs at the top of npm run ci; TypeScript held at 5.x since Next rejects TS>=7). Primary admin alert =
GitHub Dependabot — ENABLE IT: repo Settings → Code security → Dependabot alerts + security updates.
No migration.

### 177.1.260808 — recharts 2 → 3 upgrade (its own pass, as planned)
Now that the framework churn is done, moved recharts 2.15.4 → 3.10.1 deliberately. Assessed the 3.0
breaking changes against BNN's actual usage (dashboard.tsx + manage.tsx: Line/Bar/ComposedChart, custom
Tooltip content, ReferenceLine, LabelList, Cell): nothing blocking. tsc clean (our custom ChartTip is
loosely typed so the TooltipContentProps label-type change doesn't bite; all imports still export), Next 16
build succeeds, 0 vulnerabilities, all tests pass.
Notes for QA / future:
- Cell (used for per-bar conditional colors, dashboard L383/L490) is DEPRECATED in recharts 3.x but still
  works; it's removed in 4.0. Kept as-is this pass; migrate to the shape/content prop when we go to 4.0.
- recharts 3.x renders XAxis/YAxis axis lines even without ticks, and enables accessibilityLayer by default —
  minor visual/behavior changes to eyeball on the chart screens.
- Legend is imported in dashboard but never rendered, so the 3.x z-index-by-render-order change is moot.
VERIFICATION BOUNDARY: compiles/builds/tests clean, but chart RENDERING is visual — only a look at the
Dashboard + Manage charts confirms trends/bars draw, tooltips show correct values on hover, bar colors apply,
and axes look right. Small, isolated QA surface (two screens). Rollback = redeploy 177.0. No migration.

### 177.2.260808 — recharts: migrate Cell → shape (4.0-ready; functionality identical)
recharts 4.0 is NOT released yet (latest published = 3.10.1, which we're on), so there was no "4" to move to —
but we did the one 4.0-prep item now so there's nothing to revisit later: replaced the two deprecated <Cell>
usages (per-bar conditional colors in dashboard.tsx) with the Bar `shape` prop rendering <Rectangle>, preserving
the EXACT coloring logic (chart 1: at/under form-avg = green #4ADE80 else red #FB7185; chart 2: barColor(val)).
Cell is now gone entirely (import + both call sites), so the 3.x deprecation console warning is cleared and the
future 4.0 Cell removal can't affect us. Same radius [3,3,0,0], same maxBarSize, same fills — bars render
identically. tsc clean, Next 16 build succeeds, tests pass, 0 vulnerabilities.
QA: same small visual surface as 177.1 — glance at the Dashboard differential bar chart and the per-stat detail
bar chart; green/red bar colors should look exactly as before. Rollback = 177.1. No migration.

### 177.3.260808 — FIX: recharts shape color regression (recent-form bars showed one color)
177.2's Cell→shape migration read props.payload[key] to pick each bar's color — but recharts builds a bar's
shape props as { ...entry, value: value[1], payload: entry }, so props.payload is a WRAPPER (no .diff/.val);
props.payload.diff resolved to undefined → the conditional was always false → every bar got the "else" color.
The Profiles "recent form" differential chart (and the per-stat detail chart) lost their green/red trend
coloring. Fix: new tested helper lib/chart-helpers.ts barShapeValue(props, key) reads props.value (the numeric
bar value recharts reliably sets), falling back through the payload nesting; both dashboard bar shapes use it.
lib/chart-helpers.test.ts (10 assertions) pins the behavior against the ACTUAL recharts prop shape so this
can't silently regress again. tsc/guards/build/tests all green. Coloring logic itself unchanged (at/under form
avg = green, over = red; barColor(val)). No migration. (Only affects the ≤30-round bar path; the >30-round
AdaptiveTrend gradient path was never involved.)

### 177.4.260808 — FIX (the real one): Profiles "Recent form" chart now colors green/red vs average
The chart the user actually reported is FormChart in components/player-card.tsx — a HAND-DRAWN SVG, not
recharts, so the 177.1–177.3 recharts work never touched it (177.3 fixed the dashboard's recharts bar charts,
a different, also-real bug — but not this card). FormChart was drawing the whole series in ONE color derived
only from first-vs-last point (green because the user is improving overall). Replaced with an average-relative
scheme: a vertical SVG linearGradient that flips at the avg line's y — red above the average (worse; higher
differential), green at/below (better) — applied to the line and the area fill, with each dot + the end value
colored per-point via colorFor(v)= v<=avg?green:red. Uses useId() for a stable unique gradient id (SSR-safe).
Matches the gold "avg" line on the card and the dashboard trend chart's documented green/under-red/over behavior.
Verified the coloring on the reported data (avg 15.32 -> dots green/red/green/green/red/green/red/red/green/green;
gradient flip at offset 0.66, both colors present). tsc/build/guards/tests green. No migration.
NOTE: this is custom SVG untouched by my recharts changes; the single-color logic predates this arc, so it
wasn't a regression I introduced here — but I initially fixed the wrong (recharts) charts by assuming which
component "recent form" referred to. Lesson: locate the exact component before claiming a fix.

### 177.5.260808 — security follow-up review: FIX removed-member auth bypass (HIGH) + harden the guard — MIGRATION 0126 REQUIRED
Second external review found 0125 hand-rolled its membership/admin checks (group_members by user_id + role)
WITHOUT status='active'. Since removed members keep a status='removed' row (the app updates status, doesn't
delete), a removed member could still call record_course_freshness and a removed admin could still call
set_course_freshness_status + receive notifications. HIGH (real authorization bypass, narrow blast radius).
- Migration 0126 (REQUIRED, run after 0125; same function signatures so NO client change): both RPCs now
  delegate to the canonical helpers public.is_group_member / public.is_group_admin (0034), which enforce
  status='active' AND not-banned; the admin-notification query now filters status='active' + excludes banned.
  Also adds revoke ... from anon alongside from public.
- Guard hardened (finding #3: the v1 guard checked for an -- AUTHORIZATION: comment, not the actual auth):
  ci/check_migration_authorization.py now mechanically flags, for migrations >= 0126: granting EXECUTE to an
  app role without REVOKE-from-public; a SECURITY DEFINER granted to an app role with no auth.uid()/helper;
  and (the exact 0125 bug) a direct group_members role='admin'/user_id auth check lacking status='active' and
  not using the canonical helpers. Self-tested: 0126 passes, a 0125-style migration fails with the right msgs.
- SECURITY_CHECKLIST updated: prefer canonical helpers over reimplementing auth predicates.
DELIBERATELY DEFERRED to security batch 3 (reviewer MEDIUM/LOW, honest triage — none is a HIGH):
system-maintenance SECURITY DEFINER fns still executable by authenticated + missing input validation
(expire_support_sessions negative p_max_hours, finish_stale_rounds, sweep_friction, purge_old_notifications,
send_tee_reminders) → one audit migration locking them to service/owner + validating inputs; standardize
revoke-from-public on older privileged fns; DB source-of-truth doc clarity (SCHEMA.md = docs only, not
authoritative); AI endpoint runtime input schema + structured output; /api/courses per-user quota; migration
deployment automation (PR→CI→staged). tsc/guards/tests/build green.

### 177.6.260808 — security batch 3 (follow-up review #4/#5/#6/#8/#10) — MIGRATIONS 0127 + 0128 REQUIRED
Finishes the follow-up review's non-HIGH items.
- 0127 (system function lockdown): expire_support_sessions now requires is_admin() AND validates p_max_hours
  in [1,8760] (a negative value inverted the interval and deleted ACTIVE support sessions); pg_cron-only
  reapers (purge_old_notifications, send_tee_reminders) revoked from all app roles (cron runs as owner, so
  unaffected); finish_stale_rounds kept for authenticated (self-healing by design) but PUBLIC/anon revoked;
  sweep_friction (already is_admin-gated) tightened. Verified callers first so nothing legitimate breaks.
- 0128 (rate limit): generic per-user limiter — api_rate_limits table (RLS-locked, no policies) + bump_rate_limit
  RPC (identity = auth.uid() server-side; bucket allowlisted). /api/courses now capped at 120 lookups/hour/user
  (fails open on limiter error). Reusable for future endpoints.
- AI input hardening (#8): lib/ai-sanitize.ts (11 tests) — deep-clones current/history/aggregate keeping numbers,
  truncating strings to 80 chars, flattening newlines, capping array/keys/depth, before they're embedded in the
  Gemini prompt, so user free-text can't act as instructions. Output-integrity (Gemini has no tools).
- Docs (#6): SCHEMA.md relabeled "documentation only, not authoritative" — the migration ledger is canonical.
Deferred (honestly, lower value): #9 AI output structured-schema (endpoint already checks non-empty + requests
labels; strict validation risks rejecting valid output); #7 migration-deploy automation; a broad revoke-from-public
hygiene sweep on all older privileged functions; CSP. tsc/guards/tests/build green; guard passes on 0127+0128.

### 177.7.260808 — Stage 3 pass 1: extract flightTagColor (extraction-verification standard) — no migration
First god-component decomposition pass under the new EXTRACTION_VERIFICATION.md standard. Extracted the pure
flightTagColor(key)->color helper out of GameRoom into lib/flights.ts (reused at 2 call sites, both unchanged).
Four gates all shown/met: (1) body char-for-char identical; (2) free-variable ledger balances — the only input
is `key` (param, same identifiers at both call sites); `C` is a module import, not closure state; (3) tsc clean,
typed, no `any` at the seam; (4) no reactive/effect seams (pure). Because it's pure it also gets the strongest
proof: lib/flights-tagcolor.diff.test.ts vs an independently transcribed baseline — 5,012 comparisons, 0
mismatches. GameRoom -1 line of inline logic; the point is the process, proven on the safest possible block
first. tsc/guards/tests/build green.

### 177.8.260808 — Stage 3 pass 2: extract LeaderRow from GameRoom (extraction-verification standard) — no migration
Moved the ~46-line leaderboard-row JSX out of GameRoom into components/game/leader-row.tsx as <LeaderRow>.
GameRoom keeps a thin renderLeaderRow wrapper so the 3 call sites are UNCHANGED. Four gates shown/met:
(1) body char-for-char identical (verified programmatically); (2) free-variable ledger balances — 10 closure
vars (user, isStroke, strokeNet, playerPoints/Thru/Net/Gross, parThru, relToParStr, leaderName) each became a
typed prop the wrapper passes by the same identifier; C/Avatar/flightTagColor are module imports, not closure
state; (3) tsc clean, no `any` at the seam (user prop typed {id:string}, stricter than GameRoom's any — removed
an any rather than propagating it); (4) reactive seams: renderLeaderRow now returns a <LeaderRow/> boundary vs
inline JSX — LeaderRow is stateless/effect-free so output-identical, key moved to the element for list
reconciliation; no effect timing, so the ledger fully closes it. No differential test (JSX, nothing to fuzz).
tournaments.tsx 3591->3549. tsc/guards/tests/build green.

### 177.9.260808 — Stage 3 pass 3: extract roundStats (pure, tested, reused) — no migration
The putt/GIR/fairway math was inline in MyStatsLine AND duplicated across ~4 spots in components/ui.tsx.
Extracted to lib/round-stats.ts: roundStats(holes) (+ an isGIR(hole) predicate for the ui.tsx dedup next),
pure and differentially tested — lib/round-stats.diff.test.ts vs an independently transcribed baseline: 6,000
comparisons, 0 mismatches (strongest proof, since it's pure). MyStatsLine now destructures the 5 derived counts
from roundStats; its withPutts/fwHoles arrays are kept so the JSX (`withPutts.length`, `fwHoles.length`) is
byte-identical — the render is untouched, only the stat computation moved. tsc clean, no `any` at the seam, no
reactive seams (pure). This pass is about REUSE + test coverage (the modular-path rule), not GameRoom line count;
follow-up: point the 4 ui.tsx GIR sites at isGIR to finish the dedup. ci green.

### 177.10.260808 — Stage 3 batch: split the Courses cluster out of manage.tsx (891 lines) — no migration
Larger batch now that the extraction methodology is proven. Moved the entire course-library cluster —
CourseChangeSummary, CoursesLibrary, CourseEditor, CourseForm + their helpers (normalize, courseCardTitle,
formatDateTime) and types (LibCourse, CourseEditRequest, CourseTab) — VERBATIM out of components/manage.tsx
into a new self-contained components/manage/courses.tsx. Verified: (1) bodies byte-identical (sliced directly;
the only change is `function`->`export function` on the 3 non-exported components — the export mechanism, not
a body edit); (2) ledger — the cluster is fully self-contained (its only cross-refs are to each other; confirmed
it uses no manage-local helper that stays behind), courses.tsx carries its own `const supabase = createClient()`
and the cluster's import surface; home.tsx repointed to import CoursesLibrary from the new path; tsc 0 errors
confirms every wire resolves; (3) build compiles (module boundaries + use-client OK); (4) no reactive seams —
whole components moved intact, their internal effects/state unchanged and unmoved relative to their own bodies.
No differential test (JSX components). manage.tsx 3831 -> 2941 lines. ci green.

### 177.11.260808 — workflow atomicity + simulated-failure hardening — SUPERSEDED / NOT FOR DEPLOYMENT
Historical note only: this unreleased working build originally referred to migration 0129. The production-ready v177.13 sequence intentionally skips 0129 and renumbers this workflow migration to 0130.
Fresh end-to-end workflow review focused on partial failures and cross-screen state consistency rather than
carrying forward prior audit findings.
- 0129 adds transactional RPCs for Money expense create/edit, whole-game end+round posting+clock freeze,
  safe club deletion, course correction submission, and tee-time RSVP ordering.
- Money edits can no longer update the expense and then lose its split/payers on a later write failure.
- End Game is now one DB transaction: if posting rounds fails, the game does not remain ended with missing history;
  the End Game button no longer performs the destructive client-side round rewrite afterward.
- Club deletion moved from a chain of client mutations to a single admin-gated DB transaction.
- Course corrections now link + override + create the review request atomically; validation happens before writes.
- Course identity matching no longer treats a course name as globally unique; API id wins, manual matching requires
  facility/location context, and the round editor no longer falls back to unsafe global name-only lookups.
- Course-library helpers now throw on query/link errors so callers cannot report false success or convert a refresh
  failure into an empty library; key course screens preserve their last good state on refresh failure.
- Tee-time RSVP signup order is allocated under a DB advisory lock, removing concurrent `length + 1` collisions.
- Signup deadline dates now mean end-of-day rather than noon.
- Course API limit remains 120/hour for normal users but gives global admins 1000/hour for the explicit bulk refresh tool.
- Course freshness results now distinguish a successful no-change check from a failed/unavailable check internally.
- Static UI/security guard suite remains green after the changes.


### 177.12.260808 — fault-injection verification + course-review atomicity — SUPERSEDED / NOT FOR DEPLOYMENT
Historical note only: v177.13 uses the final deployment sequence 0130 → 0131 → 0132; migration 0129 is intentionally skipped/reserved.
Post-fix verification pass. Added model-based fault injection across transactional workflows and corrected two gaps found by the tests.
- Course-library reads now propagate query errors instead of silently converting failed reads into empty libraries.
- Repeated/retried course-correction submissions reuse the existing pending request for that course+group.
- Global approval / group-only / reject+remove review actions now run through one admin-gated DB transaction.
- 131 workflow simulation/source-contract checks passed, including rollback injection at each expense stage, game-post rollback, club-delete rollback, correction submit/review rollback, duplicate retry handling, double-review rejection, and 50,000 randomized RSVP edits/order checks.
- Static repository guard suite remains green.
- PostgreSQL runtime execution still requires staging verification because this review environment has no PostgreSQL/Supabase service.


### 177.13.260808 — production workflow hardening + schema reconciliation — MIGRATIONS 0130, 0131, 0132 REQUIRED
**Important migration numbering note:** migration **0129 is intentionally skipped/reserved** in this release. There is no `0129_workflow_atomicity.sql` in the v177.13 bundle. This is deliberate to avoid a numbering collision with a separately-used production 0129 identifier. **Deploy exactly 0130 → 0131 → 0132, then deploy v177.13.**
- 0130_workflow_atomicity.sql: transactional Money expense saves/edits, game finish+round posting, tee-group finish+posting, safe club deletion, atomic course-correction submission, and collision-safe RSVP ordering.
- 0131_workflow_retry_and_review_atomicity.sql: retry-safe/idempotent pending course-correction submissions and atomic admin review.
- 0132_course_schema_reconciliation_and_privilege_hardening.sql: reconciles the two course-correction tables for fresh/partial environments, ensures the `(group_id, course_id)` unique key, enables RLS, preserves member-readable SELECT access, and revokes direct browser-role mutation privileges so writes flow through SECURITY DEFINER RPCs.
- Live DB compatibility was checked from supplied schema output: `group_course_overrides` and `course_change_requests` both exist with the columns required by the RPCs; `group_course_overrides` has the required UNIQUE `(group_id, course_id)` constraint.
- Existing product decision preserved: every active club member may read that club's course corrections and overrides.
- Verification: repository guards green; schema-contract guard green; workflow fault simulation green, including 50,000 randomized RSVP operations. Real PostgreSQL/Supabase staging execution remains the final deployment gate.

### 177.14.260808 — automated staging integration + reliability gates — MIGRATION 0133 REQUIRED
Builds the pre-deployment proving ground requested after the 177.13 hardening release.
- Adds `npm run test:staging`: a destructive-but-self-cleaning staging Supabase integration suite. It creates disposable auth users/groups/course/game/tee-time fixtures, exercises real authenticated RLS/RPC behavior, verifies course-correction visibility and direct-write denial, proves correction retry idempotency, injects an expense replacement failure and verifies rollback, races parallel tee-time RSVPs, injects a bet re-post failure and verifies the original posting survives, and verifies safe group deletion behavior. It refuses to run unless `BNN_STAGING_ALLOW_MUTATION=YES` is explicitly set.
- Adds `npm run ci:staging`, which runs the normal compile/guards/unit/build pipeline and then the real staging integration suite. This is the release-candidate gate; `npm run ci` remains suitable for environments without staging credentials.
- AI analysis now validates request shape/field bounds before consuming quota and asks Gemini for schema-constrained JSON; model output is parsed/validated before being converted back to the existing user-facing coaching text.
- Course search now uses a bounded 300-entry TTL/LRU cache instead of an unbounded process Map.
- Adds an effect-suppression baseline guard: the 22 reviewed legacy `react-hooks/exhaustive-deps` suppressions are frozen; any new suppression fails CI and requires explicit review.
- 0133_testing_and_money_atomicity.sql reconciles the `group_courses(group_id,course_id)` conflict key required by course-correction RPCs and makes TGC bet post/re-post/un-post transactional. A failed corrected bet re-post now leaves the previous posting intact instead of ending cleanly-but-unposted.
- Baseline schema now includes `UNIQUE(group_id,course_id)` on `group_courses` so fresh environments match the RPC contract.
- No user-facing redesign; this is reliability/test infrastructure plus one betting-Money atomicity fix discovered while building the real integration suite.
- Adds GitHub Actions: normal CI on PR/main, plus a protected manual `Staging integration` workflow that runs the real Supabase test harness with staging-only secrets.


### 177.15.260808 — staging-proven bet RPC runtime hotfix — MIGRATION 0134 REQUIRED
Corrective release after the new v177.14 real staging gate found a PostgreSQL runtime ambiguity in the TGC bet RPC.
- Real staging integration exposed `column reference "id" is ambiguous` on the first call to `save_bet_expense_atomic` from 0133. The function returns `TABLE(id, created_at)`, making those output names PL/pgSQL variables; 0133 also used bare `id` table references, which PostgreSQL correctly rejected at runtime.
- 0134 replaces only `save_bet_expense_atomic` with the same signature/authorization/transaction semantics while qualifying collision-prone table columns (`g.id`, `ge.id`, `gg.id`, `e.id`, `e.created_at`). No application data or table shape changes.
- The staging workflow now exposes the staging URL/anon key to the normal Next.js build as `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, while retaining the dedicated `BNN_STAGING_*` variables for destructive integration fixtures.
- The bet atomicity static guard now requires the 0134 ambiguity fix, preventing a future release from dropping the corrective migration.
- Real GitHub Actions staging integration passed after the hotfix, including course correction RLS/retry/review, Money rollback, concurrent RSVP ordering, atomic TGC bet post/re-post rollback, safe group delete, and cleanup.
- Deployment order from an existing v177.14 production DB: apply **0134**, verify the migration ledger, then deploy v177.15. Fresh environments apply 0130 → 0131 → 0132 → 0133 → 0134; 0129 remains intentionally skipped/reserved.

### 177.16.260809 — production promotion CI hardening
- Fixed the pull-request CI workflow so the Next.js build receives the staging Supabase public URL and anon key.
- PR verification uses the protected GitHub `staging` environment.
- Added branch protection for `main`: changes require a pull request and the `verify` status check must pass before merge.
- No application behavior, database schema, or production data changes.

### 177.17.260811 — restore durable per-player tee setup
Restores and hardens player-level tee selection in Organizer → Manage Game without changing the underlying `game_players` data contract.
- The Players step now always renders a tee selector for every player, in individual and team formats. If the full course tee list cannot be resolved, saved player tee snapshots remain selectable instead of silently degrading to read-only text.
- Tee availability no longer depends on yardage. Yardages remain optional display metadata; tee name/rating/slope drive course-handicap calculation.
- Game-room course resolution now falls back to the global `favorite_courses` record by exact game course name when the group-course link is stale or missing, while preserving the last saved tee snapshot if the lookup still fails.
- Handicap overrides now use only the selected player's own rating/slope. The previous fallback that could borrow another player's tee values was removed to prevent valid-looking but incorrect course handicaps.
- Existing `setPlayerTee` input/output contract is preserved: selecting a tee writes that player's `tee_name`, `rating`, `slope`, and recalculated `course_handicap`.
- Added a blocking source-contract guard covering always-visible player tee selection, yardage independence, no cross-player tee borrowing, fallback course lookup, and per-player course-handicap recalculation.
- No database migration required.


### 177.18.260811 — staging compile gate + tee restore type-safety fix
- Fixes the 177.17 staging/Vercel TypeScript failure in the course-tee fallback loader by capturing the validated `group_id` and course name before entering the async closure. Runtime behavior is unchanged from the intended 177.17 tee-selection fix; this is a type-safety correction.
- CI now runs on every push to `staging` as well as pull requests and `main`, so `npx tsc --noEmit`, guards, tests, and the production build must pass before a staging candidate can be considered clean.
- Retains 177.17 behavior: player-level tee selection remains visible in Manage Game → Players, does not depend on yardage, recalculates course handicap from the selected tee's rating/slope, and does not borrow another player's rating/slope.
- No database migration.
### 177.19.260813 — refactor integrity hardening + Courses editor reachability
- Restores the missing `CoursesLibrary -> CourseEditor` render bridge, fixing Add New Course, editing an existing course, and resuming an interrupted course edit.
- Preserves the current canonical/duplicate-course identity logic; no fallback to older name-only duplicate detection.
- Adds explicit `OrganizerPanelProps` and `satisfies OrganizerPanelProps` at the parent spread-prop boundary; removes stale unused tee-group prop wiring and orphan `addMemberId` state.
- Adds permanent extraction reachability, orphan-state hygiene, and import-debt-ratchet guards to `npm run guards`.
- Process hardening: byte-identical moves are no longer sufficient; stateful extraction verification now covers entry/reachability, inputs/outputs, downstream side effects, effect timing, exit paths, and permanent CI characterization.
- Candidate-baseline hardening: every release candidate must be built from the latest clean synchronized `staging/main` baseline to prevent stale ZIPs from reverting later CI/config changes.
- No database migration.

### 177.20.260813 — GolfCourseAPI contract migration + explicit PWA updates
- GolfCourseAPI ids are now treated as opaque provider-owned strings. Search and detail routes share the same bounded safe-token validator; legacy numeric ids and the provider's current alphanumeric ids are both valid.
- Fixes Add Course, Round Setup, Yardage Backfill, course freshness, and admin facility refresh for the provider's 2026 id migration. Search results normalize ids to strings and every detail caller URL-encodes them.
- Adds 18 real current provider ids as permanent regression fixtures, including Francis Byrne (`5wng1nrq`), plus unsafe-id rejection tests.
- Adds a weekly GitHub `External API Contracts` workflow. It verifies all 18 known courses across search/detail endpoints and opens/updates an admin GitHub issue if ids, metadata, required detail fields, availability, or response shape drift. Requires repository secret `GOLF_API_KEY`.
- PWA updates are release-version driven rather than service-worker-build driven. The active worker now pins the installed app shell cache-first until the user explicitly taps Update; same-version rebuilds no longer create user-visible update prompts. Live API/auth/Supabase traffic remains network-only.
- Help's Current/Latest display no longer reports a waiting same-version worker as a newer release.
- Cleans the duplicate 177.16 release-note block left from the prior merge-conflict resolution.
- No database migration. Production course ids/metadata were reconciled separately before this code release; the app change prevents recurrence.

### 177.21.260814 — staging marker + course source transparency
- Adds a persistent yellow viewport border and STAGING badge only when Vercel builds the `staging` branch, so staging is visually distinct from Production without changing production styling.
- Add New Course now resolves a selected provider course against the BNN canonical course library immediately. If the course already exists, stored BNN data is shown as the primary data source and the UI explicitly labels it `ALREADY IN BNN`.
- Fresh GolfCourseAPI data is retained separately for comparison. Provider differences are shown without silently overwriting stored BNN values; the golfer can explicitly load provider data for review, after which the existing correction/reason workflow applies on save.
- New provider-only courses are explicitly labeled `NEW COURSE FROM GOLFCOURSEAPI`.
- Adds permanent CI guards for the staging environment marker and course-source transparency contract.
- 177.21 is intentionally the first real transition test of the 177.20 PWA hold-until-Update contract: a Production browser on 177.20 must remain on 177.20 after 177.21 deploys until the user presses Update.
- No database migration.

### 177.22.260814 — provider-review state propagation hardening
- Fixes the 177.21 staging defect where `Load provider data for review` replaced the underlying course object but left independent rating text buffers and provenance UI stale.
- Provider review is now an explicit source mode: stored BNN -> provider review -> stored BNN, with all editable rating fields synchronized on each transition and a clear return action.
- Draft persistence retains the selected source mode.
- Adds executable course-source transition tests plus stronger source-contract guards.
- Permanently tightens the engineering process: stateful UI changes must verify observable state propagation and distinguish MODELLED, EXECUTED, and BROWSER-VALIDATED evidence.
- Supersedes unreleased 177.21; no database migration.


### 177.23.260814 — provider correction submission completion
- Fixes the existing-course provider-review path so the required correction reason input is visible when fresh provider data materially differs from stored BNN data.
- Changes the primary CTA to `Submit for approval` while reviewing changed provider data and explains that stored BNN data is not silently overwritten.
- Adds executable regression coverage for when the correction-reason UI must appear and extends the permanent observable-outcome contract through the terminal submission path.
- No database migration.

### 177.24.260814 — complete-round putting trend + targeted stats nudges
- Replaces Dashboard `Putts / hole` with `Putts / round`. Only 18-hole rounds with putts recorded on all 18 holes are eligible for the whole-round putting metric and trend; no missing putts are inferred or scaled.
- Preserves partial-hole data for other metrics where numerator and denominator are known; the stricter completeness rule applies specifically to the total-round putting metric.
- Adds shared round-stat completeness logic reused by Dashboard, Rounds, and the existing post-round stats reminder.
- Rounds now nudges only near-complete stat tracking: putts recorded on 15–17 of 18 holes show exact missing hole numbers and explain that completion makes the round eligible for the dashboard putting trend. Abandoned/low-coverage stat tracking is not nagged.
- Fairway completeness remains par-3 aware and uses the same conservative near-complete nudge principle.
- Adds executable boundary tests for 18/18, 17/18, 15/18, 14/18, 9/18, 0/18, partial 15-hole rounds, and par-3 fairway exclusion.
- No database migration.


### 177.25.260814 — repository integrity / reproducibility hardening (IN PROGRESS)
- Fixes the `FormChart` React hook-order defect by calling `useId()` before the conditional early return.
- Repairs the migration-checklist generator so emphasized checked entries and hand-written notes survive regeneration; repeated generation is byte-identical.
- Adds executable self-record calls to legacy migrations 0122-0128 and migration 0135 for evidence-based ledger backfill. 0135 must run as DB owner/postgres because 0123 intentionally revoked `record_migration` from app roles.
- Adds a permanent semantic migration-ledger guard and documents the historical 0064/0129 numbering gaps.
- Extends bottom-sheet, contrast, date-input, popup-close, and safe-area guards across both `components/` and `app/` UI roots.
- Hardens `.gitignore` for `.env`/`.env.*`, documents all referenced environment variables in `.env.example`, and adds an environment-hygiene guard.
- Removes the unused Courses `HelpSearch` import. The two verified but inert tracked orphan files are documented for a later delete-capable cleanup rather than requiring manual deletion during this overlay release.
- Replaces direct `round.ai_analysis` prop mutation with an explicit immutable parent update callback.
- Adds zero-tolerance React hook lint wiring and makes the non-blocking dependency check explicit with `|| true`.
- Captures the authoritative live Production database security contract in source: `0136_core_rls_helpers.sql` recreates the six exact SECURITY DEFINER policy helpers; `0137_core_rls_baseline.sql` recreates RLS state, all 60 core policies, and the exported table grants for the 12 legacy core tables.
- Adds exact helper/policy manifests, source-closure guards, and a disposable Supabase fresh-database reconstruction step inside required `CI / verify`.
- Replaces the old total-import cap with an actual TypeScript unused-symbol per-file ratchet (512 grandfathered diagnostics / 27 files; no increases or headroom).
- Makes pace-of-play clocks reactive, prevents direct round prop mutation after AI analysis, adds VAPID key drift protection, and pins the build/runtime contract to Node 22 across CI and Vercel package metadata.
- **BLOCKED before release:** the new fresh-database reconstruction must execute successfully in GitHub CI, 0135-0137 must pass staging database validation, and the normal dependency-backed type/test/build/release gates must pass.

### 177.26.260814 — fresh-DB ordering + staged RLS gate sequencing
- Corrects the first 177.25 GitHub execution of the new database-reproducibility gate. The original harness sorted full paths across `migrations/` and `supabase/migrations/`, which could execute `0014_round_clock.sql` before `0001_baseline.sql`; migration ordering is now parsed globally from the numeric filename prefix, with duplicate-number rejection and an executable monotonic-order contract.
- Separates pre-migration reproducibility proof from post-migration live-environment equality. `ci/schema-check.sh` always runs the existing live schema/default checks, but the exact Production-derived core-RLS equality gate becomes mandatory only after `0137_core_rls_baseline` is recorded in that environment's `schema_migrations` ledger.
- Before 0137 is applied, source-contract guards plus disposable fresh-database reconstruction are the hard pre-migration proof. After 0137 is applied to staging/Production, the live RLS equality check automatically becomes a hard gate.
- This resolves the circular release gate exposed by staging: CI must approve the migration before staging is changed, while live staging cannot equal the new baseline until that migration is deliberately applied.
- No application behavior or Production database change in this corrective candidate. Migrations 0135-0137 remain unapplied pending a successful disposable fresh-database rebuild.

### 177.27.260814 — declare fresh-database extension prerequisites
- Fresh-database CI exposed a real reconstruction gap: `0001_baseline.sql` uses the PostgreSQL `citext` type before historical migration `0038` declares that extension.
- Added `ci/fresh_db_bootstrap.sql` as the source-controlled prerequisite stage before migration `0001`; it installs `citext` idempotently without rewriting historical migration files.
- Added `ci/check_db_extension_prereqs.py`, which walks the actual globally ordered migration stream and fails when a known extension-owned SQL surface is used before that extension is bootstrap-installed or declared by an earlier migration.
- `pg_cron` remains declared by migration `0074` before its first `cron.*` use, so it does not need to be promoted into the pre-0001 bootstrap today.
- Fresh-database reconstruction remains a required GitHub gate. No staging or Production database migrations should be run until that disposable rebuild passes.


### 177.28.260814 — fresh-database historical RLS compatibility
- Completes a full static audit of non-idempotent historical migration prerequisites after the disposable rebuild reached migration 0017.
- Recreates the pre-0017 `create notifications` INSERT policy in the baseline so `0017_notifications_lockdown.sql` can tighten that policy exactly as it did in the original live database.
- Adds a semantic historical-prerequisite guard covering ALTER POLICY, ALTER FUNCTION, GRANT/REVOKE EXECUTE ON FUNCTION, and non-idempotent DROP FUNCTION dependencies across the globally ordered migration stream.
- Audit found no other unresolved pre-existing object dependency of those classes; future additions fail CI if they introduce one.
- No Production or staging database changes are to be applied until the disposable fresh-database rebuild passes the complete migration stream.

### 177.29.260814 — comprehensive historical migration dependency closure
- Expanded the historical migration prerequisite audit from DDL-only checks to the complete globally ordered migration stream: 135 migrations, 43 repo-created relations, 134 repo-created functions, 1,086 relation dependencies, 462 function dependencies, 148 policy dependency operations, and 98 explicit column-state operations.
- Restored the three pre-0034 auth helper definitions (`is_admin`, `is_group_member`, `is_group_admin`) in `0001_baseline.sql`. Migration 0034 still performs the historical behavior change that adds banned-user enforcement.
- The audit now checks ordinary function calls inside SQL bodies, not only ALTER/GRANT/REVOKE/DROP operations; this closes the gap that allowed `0025_group_roster.sql` to reach CI with a missing `is_group_member(uuid,uuid)` prerequisite.
- Negative-tested the guard by temporarily removing the baseline `is_group_member` helper: the audit failed at migration 0025 as intended, then passed after restoration.
- No Production or staging database migration has been applied as part of this source correction. Disposable fresh-database replay remains required before 0135-0137 may be applied to staging.

### 177.30.260814 — historical baseline column closure + stronger column dependency audit
- Fresh-database CI #39 proved migration ordering/extension/function/policy prerequisites through migration 0042, then exposed a genuine historical baseline gap at 0043: `rounds.game_id` existed in the live historical schema but was never recreated by committed migrations.
- Reconciled the Production-derived 177.14 schema bootstrap against baseline-created tables and restored nine historical out-of-band compatibility columns to `supabase/migrations/0001_baseline.sql`: `profiles.deactivated`, `profiles.dashboard_ai`, `favorite_courses.external_id`, `favorite_courses.facility`, `favorite_courses.corrected`, `rounds.ai_analysis`, `rounds.game_id`, `games.score_epoch`, and `game_players.no_show`.
- Added `ci/assert-historical-baseline-columns.sql` and execute it in every disposable fresh-database rebuild so silent schema omissions fail even when PostgreSQL defers validation inside PL/pgSQL bodies.
- Strengthened `check_legacy_migration_prereqs.py` to check executable column dependencies including simple CREATE INDEX column lists and fully-qualified table.column references, in addition to relation/function/policy/type/ALTER-column closure.
- Negative-tested the 0043 failure pattern: removing `rounds.game_id` from the baseline makes the static guard fail on `0043_round_game_unique.sql` before CI reaches PostgreSQL.
- No live database migration has been applied. 0135-0137 remain blocked until disposable fresh-db replay passes the complete migration stream.


### 177.31.260814 — diagnostic RLS parity gate
- Fresh-database replay now reaches the end of the 135-migration stream and passes the historical nine-column compatibility assertion, but the final exact RLS comparison reports policy drift without identifying the affected policies.
- Reworks `ci/assert-core-rls-live.sql` to materialize expected vs actual policy state, emit one `CORE_RLS_DIFF` row per affected policy with field-level expected/actual values, then fail the hard gate.
- Adds diagnostic-only whitespace comparison flags for policy expressions; exact raw Production parity remains the release requirement until each difference is reviewed.
- Strengthens `ci/check_fresh_db_ci_contract.py` so future RLS parity failures must remain actionable rather than count-only.
- No RLS policy, grant, helper, application behavior, staging database, or Production database change in this diagnostic corrective candidate.
- **BLOCKED before release:** rerun disposable fresh-DB CI, inspect all emitted `CORE_RLS_DIFF` rows, classify true semantic drift vs PostgreSQL rendering differences, and correct only evidence-backed mismatches.


### 177.32.260815 — RLS diagnostic transaction lifetime correction
- Encloses the complete read-only core-RLS verifier in an explicit transaction so `_core_rls_expected` and `_core_rls_actual` temporary tables declared `ON COMMIT DROP` survive through diagnostic SELECTs and the final hard gate under psql autocommit.
- Strengthens the fresh-DB source contract to require the transaction to begin before the temporary diagnostic tables and commit only after the final PASS path.
- No RLS policy, grant, helper, migration, application behavior, staging database, or Production database change.
- **STAGING-DIAGNOSTIC ONLY:** package this correction only to run the disposable fresh-database GitHub gate. It is not a deployable release. Production and the real staging database remain untouched until executable matching and deliberately mismatched PostgreSQL scenarios pass and the final RLS/security gate is green.


### 177.33.260815 — PostgreSQL-native RLS expression canonicalization
- CI 177.32 successfully completed all 135 migrations and the RLS diagnostic, isolating 15 policy keys whose roles/commands/predicates were logically unchanged but whose `pg_policies` expression text was re-rendered by the disposable PostgreSQL instance.
- The live RLS gate no longer compares raw Production deparser text directly. It parses the checked-in expected expressions on session-local shadow tables in the SAME PostgreSQL engine, then compares that runtime-canonical `USING`/`WITH CHECK` output to the real public policies. Policy keys, permissive mode, roles, commands, RLS table state, and grants remain exact hard gates.
- Raw Production export text is still emitted beside runtime-canonical/actual values. Harmless deparser-only differences are labelled `CORE_RLS_RENDERING`; genuine contract mismatches remain `CORE_RLS_DIFF` and hard-fail.
- Adds PostgreSQL version diagnostics and executable semantic canaries proving equivalent formatting converges while removed admin/ownership/guest/active-member predicates, AND-to-OR changes, and organizer-condition changes remain distinguishable.
- No RLS policy, grant, helper, migration, application behavior, real staging database, or Production database change.
- **STAGING-DIAGNOSTIC ONLY / NOT DEPLOYABLE:** GitHub disposable fresh-DB execution must prove `CORE_RLS_CANARY_PASS` and zero `CORE_RLS_DIFF` before any further database or release action.


### 177.34.260815 — split RLS structural / semantic / behavior verification
- Replaces the flawed 177.33 pg_temp deparser-canonicalization approach. PostgreSQL deparsed text is no longer treated as a stable security semantic contract.
- `ci/assert-core-rls-live.sql` is again production-safe/read-only and hard-gates stable runtime structure only: 12 RLS table states, exact 60 policy identities/permissive modes/roles/commands, and exported grants.
- New fresh-DB-only `ci/assert-core-rls-behavior.sql` exercises authenticated owner-vs-other authorization for notifications, rounds, and holes, including allowed writes and denied cross-user writes. All fixtures and trigger-disable changes roll back.
- `ci/test_fresh_db_rebuild.sh` now requires structural and behavior RLS gates after the full migration replay; `ci/check_fresh_db_ci_contract.py` permanently guards that architecture and rejects a return to pg_temp expression canonicalization.
- No application code, RLS policy, grant, helper, migration, staging database, or Production database behavior is changed.
- **NOT DEPLOYABLE:** PostgreSQL execution of the new structural/behavior gates, full dependency-backed CI/type/test/build, Vercel staging, staging regression validation, PR verify, Production Ready and smoke remain mandatory.

### 177.35.260815 — hook-lint gate reconciliation
- Root cause of the 177.34 `npm run ci` failure: the repository had 23 stale ESLint disable directives while `lint:hooks` runs with `--max-warnings=0`. Twenty-two referenced `react-hooks/exhaustive-deps`; one was a generic inline disable. The active ESLint config enables only `react-hooks/rules-of-hooks`, so the directives suppress no active rule and ESLint correctly reports them as unused.
- Removes exactly those 23 comments and makes no executable TS/TSX change: no effect body, dependency array, state, prop, callback, import, API/RPC, database write, or render logic is changed.
- Retires the 22-entry legacy suppression baseline and changes `ci/check_effect_suppressions.py` to a zero-suppression invariant for `react-hooks/exhaustive-deps`. The rule itself remains disabled; the broader exhaustive-deps dependency audit stays deferred because enabling it is a behavior-sensitive refactor, not part of this corrective.
- No migration or database change. 177.34 RLS structural/behavior verifier architecture is preserved unchanged.
- **NOT DEPLOYABLE until validation completes:** local `npm ci` timed out in this environment, so dependency-backed hook lint, TypeScript, unit/differential tests, full build, disposable fresh-DB/RLS behavior checks, Vercel staging and adjacent workflow validation must pass in GitHub/staging before promotion.



### 177.36.260815 — CI severity alignment for advisory unused-symbol debt
- 177.35 GitHub CI cleared the hook-lint corrective and reached the guard suite, where the unused-symbol debt ratchet stopped the run despite APP_RULES #26 explicitly classifying unused props/state/imports as boundary-drift warnings.
- `ci/check_extracted_import_debt.py` continues to measure and print every per-file unused-symbol baseline delta, but those technical-debt findings are now ADVISORY and return success. The baseline is deliberately not reset, so existing drift remains visible.
- Formalizes BLOCKING vs ADVISORY release-gate semantics in APP_RULES/HANDOFF. Security/RLS, disaster-recovery migration reconstruction, secrets, TypeScript correctness, unit/differential behavior, build, reachability/source contracts, and feature correctness remain blocking.
- No application code cleanup, migration, RLS, grant, helper, schema/data, or runtime behavior change.
- **NOT DEPLOYABLE:** complete GitHub CI/fresh-database execution, Vercel staging, targeted/adjacent staging validation, PR verify, Production Ready and smoke remain mandatory.


### 177.37.260815 — staging integration safety
- Makes the real staging Supabase integration part of the required staging-to-main PR verification path, blocks the known Production Supabase project, requires explicit manual mutation confirmation, and cleans/verifies staging `money_audit` fixtures. No migration or app behavior change.

### 177.38.260815 — staging integration URL constructor corrective
- Corrects the staging harness variable shadowing Node's global `URL` constructor (`URL` -> `STAGING_URL`) and adds regression protection. No migration or app behavior change.

### 177.39.260815 — historical round rating/slope correction
- Round Editor now lets an already-recorded round correct its historical Course rating and Slope snapshot. The app recalculates that round's course handicap from the handicap index stored on the round, refreshes per-hole stroke allocation for differential math, and the existing round reload recalculates the app-estimated handicap history.
- Gross-only rounds preserve their stored total during a metadata-only correction. Game-linked personal rounds do not rewrite game results. Course-library data is not silently changed.
- Adds targeted pure-logic tests and a permanent source contract for the correction/save/cancel boundaries.
- No database migration.


### 177.40.260815 — Game setup workspace extraction (behavior-preserving)
- **NO migration.** Preparatory modularization only; no intended user-visible behavior change.
- Extracts the existing organizer setup stepper/progress/render boundary from `GameRoom` into `components/game/setup/game-setup-workspace.tsx`.
- All Supabase writes, mutation handlers, reload behavior, structure stash/restore, scoring logic, Matchups/StrokesSummary path, and existing setup navigation state remain owned by `GameRoom`.
- The parent keeps explicit typed contracts for both `OrganizerPanelProps` and `GameSetupWorkspace` props; a permanent source guard verifies Players/Teams/Groups reachability, tee/handicap/member/guest/group callback wiring, Matchups reachability, and that the workspace owns no database side effects.
- `MIGRATIONS.md` is reconciled to the directly verified Production ledger through 0137. Staging and Production both have 0135-0137 applied; the 12 core RLS tables expose the expected 60 policies; staging integration and Production smoke validation passed.
- This release intentionally does **not** introduce the new persistent Game Control Center UX or post-scoring transition rules. Those follow only after this extraction proves behavior-identical through staging.

## 177.42 setup roster ordering stability
- Fixes the Manage Game / Players regression where changing a player's tee could make that player jump to the bottom of the list after the save. Root cause: the tee writer correctly called `load()`, but the subsequent `game_players` SELECT has no guaranteed row order; the setup editor rendered that database return order directly. PostgreSQL does not promise row order without ORDER BY, and an UPDATE can expose a different physical tuple order.
- Organizer setup now derives a presentation-only `orderedPlayers` array sorted alphabetically by `display_name` (case-insensitive), with `id` as a deterministic tie-breaker. The same canonical order is used for the player editor, sponsor list, and team-assignment roster. `GameRoom.players` itself is not reordered, so scoring/realtime/business logic contracts are untouched.
- Extends the permanent Game Control Center contract guard to require the alphabetical sort, stable tie-breaker, and use of the canonical roster in the player editor.
- No migration.


## 177.44.260816 — policy test fixture typecheck correction
- Corrective release for the 177.43 PR CI failure.
- Root cause: `lib/game-setup-policy.test.ts` constructed a typed `Game` fixture without the required `code` field, so dependency-backed TypeScript correctly rejected the test before the policy suite/build could run.
- Fix: add the required `code` field to the fixture; no runtime behavior or policy logic changes.
- No migration.

## 177.43.260816 — centralized Game Control Center transition policy
- Adds `lib/game-setup-policy.ts` as the single source of truth for organizer setup edits once play has started. Every covered mutation now resolves to **ALLOW / CONFIRM / BLOCK** before any write.
- Locks the agreed competition-integrity rule: once scoring starts, structural identity freezes. Scored players cannot be removed, moved to another team, or moved to another tee group; individual/team conversions and skins structure conversions are blocked.
- Preserves flexibility where raw scorecards remain valid: Stableford ↔ Stroke ↔ Individual Skins may be reinterpreted with confirmation; Four-ball ↔ Trifecta may be reinterpreted with confirmation when the same foursomes remain in place; handicap allowance, team-score mode, skins tie handling, Trifecta scoring and leg settings may be changed with explicit consequence warnings.
- Tee and handicap corrections remain possible after that player has scored, but require confirmation and explicitly preserve gross scores. A tee correction means the entire round was recorded against the wrong tee; BNN still does not support a player physically changing tees partway through one round.
- Remove is now blocked for a player with scores and directs the organizer to No-show / Out instead so played holes remain. Mid-round additions are allowed with confirmation only for individual Stableford/Stroke/Individual Skins; match/team contests block them once scoring starts.
- Tee-group randomization remains pre-round only. Manual tee-group edits now obey the same policy: scored/locked players cannot move; an unscored player may join an active group with confirmation. Legacy Match pairing and Four-ball/Trifecta foursome editors are also policy-gated, so direct structural writers cannot bypass the Control Center rule.
- Ended games show `FINAL` in the Control Center. Competition edits require reopen first; reopening does not bypass score-state rules. Rename/share remain safe metadata actions; game-date correction remains available with confirmation because the existing RPC moves posted rounds together.
- Adds 41 executable policy assertions plus a permanent source-contract guard proving UI and write handlers both consume the same pure policy module.
- **No database migration.** Course replacement remains intentionally out of scope: it is allowed conceptually only before any score, but still requires a separate coordinated course/hole/player-tee implementation.


## 177.46.260816 — Game Control Center terminology and summary polish
- Renames the Game section's destructive-control heading from **Danger Zone** to **Destructive Actions** and adds the explicit warning **These actions cannot be undone.**
- Keeps Reset Scores and Delete This Game visually separated from routine game controls; no mutation handlers or confirmation behavior change.
- Corrects the Control Center overview summary for individual Match games so it reports matched players rather than team assignments. Team formats continue to report team assignments; non-team/non-match formats report tee-group placement.
- Presentation-only release: no scoring, setup-policy, database-write, RPC, migration, or schema behavior changes.
- Version 177.46.260816. No migration.

## 177.47.260816 — Create Game convergence Stage 1: canonical draft contract
- **NO migration. No intended user-visible behavior change.** Introduces `lib/game-setup-draft.ts`, a typed canonical model for the meaningful Create Game setup state, while leaving the existing component state, UI, `create()` transaction, game/player payloads and post-create routing unchanged.
- The existing device-local `SetupDraft` storage shape remains backward-compatible. CreateGame now maps its state into `GameSetupDraft`, then adapts it back through `toLegacySetupData()` before the existing `saveSetupDraft()` call. 2,004 assertions verify the serialized legacy shape and old-draft round-trip.
- Adds a permanent state-inventory guard: all 35 CreateGame `useState` cells and 3 refs are explicitly classified as domain, loaded context, transient editor, runtime, or control refs. New state cannot silently cross the future extraction boundary.
- Audit finding recorded but deliberately not fixed here: live `hcpOverrides` are not persisted by the legacy local setup draft, so an interrupted flight-handicap override can be lost. Fixing that requires an intentional draft-schema version later; Stage 1 preserves current behavior.


## 177.48.260816 — Create Game convergence Stage 2: pure structure mutations
- **NO migration. No intended user-visible behavior change.** Extracts the structural calculations currently embedded in Manage Game into `lib/game-structure.ts`, while leaving the existing Supabase writers, setup policy checks, alerts/confirms, refresh callbacks and UI in place.
- Shared pure helpers now calculate: format transition patches; skins structure stash/restore; Match individual/team stash/restore; pairing add/remove; foursome add/remove/rename/assign/unassign; and the existing rule that each saved foursome maps to its 1-based tee group.
- `components/tournaments.tsx` continues to own persisted format/skins/match writes. `components/game/scoring-views.tsx` continues to own persisted pairing/foursome/player tee-group writes. The extraction changes only how the next structure value is calculated.
- Differential characterization freezes the 177.47 implementations in `lib/game-structure.test.ts` and compares the extracted helpers across a fixed transition matrix plus 40,000 randomized pairing/foursome assertions.
- Adds `ci/check_game_structure_contract.py` to require every existing runtime mutation path to reach the pure helpers and to prohibit Supabase/browser side effects inside the structure module.
- Stage 2 remains part of the staging-only Create Game convergence train. Production remains on the pre-convergence release until the complete flow passes end-to-end release validation.

## 177.49.260816 — Create Game convergence Stage 3A: shared section workspace
- **Staging-only convergence checkpoint. No migration.** Introduces the shared Create Game navigation shell with the target section model: **Game → Players → Format → Teams & groups → Review**.
- Reuses the existing Create Game state and handlers rather than moving persistence ownership. Game/course/default-tee fields, roster/guest controls, and format/flight controls are the same existing controls, now organized into the shared section flow.
- Renames the creation-time tee concept to **Default tee for the field**, matching actual existing behavior: the selected tee is still applied to all initial player rows by the unchanged `buildPlayerRows()` path.
- Review now provides a pre-create summary and is the only section that exposes the final Create game action. The underlying `create()` function, Supabase writes, tee-time linkage, notifications, draft persistence, player-row payloads, and post-create routing are unchanged.
- Structural formats deliberately retain today's behavior in this checkpoint: detailed team/matchup/foursome assignment still occurs immediately after creation. Stage 3B will move those existing structural rules into draft mode and add flight/player tee overrides before this convergence train is eligible for Production.
- Adds a permanent Create Game workspace contract guard proving five-section reachability and that the shared workspace owns no Supabase/RPC/local persistence.

## 177.50.260816 — Create Game convergence Stage 3B: tee inheritance
- **Staging-only convergence checkpoint. No migration.** Adds the agreed creation-time tee hierarchy: **individual player override → one-off flight tee → game default tee**.
- The Game section still sets one convenient default tee for the field. Players can now override exceptions individually, and one-off Flights can choose a tee for each flight. Explicit player overrides always win over flight/default choices.
- Changing the field default updates only inherited players; it does not erase flight or player overrides. Changing course clears all tee-index overrides because those indexes belong to the prior course.
- Resume Setup persists the new optional player/flight tee maps while remaining backward-compatible with pre-177.50 drafts, which resume with empty maps.
- `buildPlayerRows()` resolves the effective tee once at Create and writes explicit per-player `tee_name`, `rating`, `slope`, and `course_handicap` snapshots. There is no post-create inheritance. Existing callers that omit the new optional inputs remain differentially identical to 177.49 behavior.
- New pure `lib/game-tee-assignment.ts` centralizes resolution and is protected by `ci/check_create_game_tee_inheritance.py`. Dedicated tests cover 5,011 precedence/sanitization assertions; draft compatibility has 2,006 assertions; existing `game-create` baseline differential remains 9,000/9,000 identical when hierarchy inputs are absent.
- Detailed teams/matchups/foursomes/tee-groups are still post-create in this checkpoint. Stage 3C will move those existing structural editors into draft mode before Stage 4 atomic creation.



## 177.51.260816 — Stage 3 corrective: resume durability + TGC betting scope + CI fixture typing
- **Staging-only convergence checkpoint. No migration.** Corrects two browser regressions found during 177.49/177.50 staging QA and the 177.50 GitHub TypeScript failure.
- **Resume Setup durability:** Create Game now checkpoints the latest draft on normal state changes, `pagehide`, visibility-hidden, and unmount. Resume restores the five-section workspace location, player/flight tee overrides, and live handicap overrides. Older drafts remain valid. The progress detector now recognizes meaningful format/structure/tee work, not only course/name/roster changes.
- **TGC betting scope:** the `· no bet` leaderboard label is shown only when the effective group is TGC. New guest rows use the guest-default-out betting semantic only for TGC; ordinary groups such as staging Main receive the neutral/default `bets=true` value. The same gate is applied to guests added after game creation. BettingPanel itself remains TGC-gated as before.
- **CI correction:** `game-tee-assignment.test.ts` now explicitly types the randomized override maps as `Record<string, number>`, fixing TS2322 caused by TypeScript inferring optional `undefined` properties from `{...} : {}` test branches. Runtime tee logic is unchanged by this typing correction.
- Adds `ci/check_create_game_resume_and_betting_scope.py` and extends the Create Game state inventory to the new latest-draft ref.
- Local executed validation: 5,011 tee-assignment assertions; 43 game-create assertions; 2,007 setup-draft assertions; full `npm run guards` including 50,087 workflow/fault simulations. Dependency-backed `tsc/build` remains a GitHub CI gate in this source environment.

## 177.52.260816 — Lean Create pivot: core setup first, structure in Manage Game
- **Staging-only convergence checkpoint. No migration.** Simplifies Create Game to **Game → Players → Format → Review**. The abandoned Stage 3C pre-create structure draft was not deployed and is not part of this release.
- Create Game retains the high-value convergence work: canonical draft/resume behavior, roster/guests, default tee → flight tee → individual tee override, format/scoring choices, and core validation.
- Teams, matchups, foursomes, tee groups, structure stash/restore, and transition-policy enforcement remain owned by persisted **Manage Game** instead of being duplicated into a second draft-state system.
- Review explicitly tells the organizer when additional setup is required. After Create, Stableford/Stroke go directly to Play; formats requiring structure open Manage Game at the relevant section (Teams, Matchups, or Groups).
- Split-Skins field-size validation now runs **before the first database write**, preventing an invalid >4-player split-Skins attempt from leaving an orphan game row.
- Backward compatibility: a saved 177.49–177.51 draft whose workspace section was `structure` resumes safely at Review rather than being discarded.
- Validation: dedicated game-create helper compile PASS; game-create tests 52/52 PASS in the local dependency-light harness; full source guards and workflow simulation are required below/GitHub before this staging candidate advances.


## 177.53.260816 — Format Selection Convergence: clearer Create Game choices, same game model
- **Staging-only convergence checkpoint. No migration.** Redesigns only the Create Game format selector; scoring algorithms, games/game_players schema, Manage Game writers, and post-create structure ownership are unchanged.
- Replaces the old Stroke-vs-Match family tree and duplicate Team toggles with six direct formats: Stableford, Stroke Play, Match Play, Four-ball, Trifecta, Skins.
- Match Play now asks one clear structural question: **Players — Individual / Team**. The old contradictory secondary `Team match` checkbox is removed.
- Four-ball now asks **Competition — 2 v 2 Match / Team vs Team**, followed independently by **Team score — Best ball / Shootout (aggregate)**. This preserves ordinary independent foursomes and Ryder-Cup-style overall teams without labeling both decisions `Team`.
- Skins now exposes the three existing structures directly: **Individual / 1:1 Teams / 2 v 2 Best-ball**, with Carry over/Halved and the existing 2v2 Best ball/Aggregate option. No skins scoring behavior changed.
- Trifecta retains Best ball/Shootout and Per-hole/Ryder-Cup scoring; Stroke retains Net/Gross; allowance and flights remain unchanged.
- Review now prints the full selected interpretation (for example `Four-ball · 2 v 2 Match · Best ball`) rather than only the base game type.
- New pure `lib/create-game-format.ts` maps user-facing selectors onto the existing persisted state fields and resets irrelevant top-level team state when changing base formats. A permanent CI source contract prevents the ambiguous legacy selector labels from returning.
- Executed locally: new format mapping 35/35 PASS; game-create 52/52 PASS; historical game-create differential 9,000 comparisons / 0 mismatches; setup-draft 2,007/2,007 PASS; tee inheritance 5,011/5,011 PASS; full `npm run guards` including 50,087 workflow/fault simulations PASS. Full dependency-backed app type/build remains the GitHub staging gate.


## 177.57.260816 — Authoritative guided-format helpers + exact next-step guidance
- **Staging-only convergence checkpoint. No migration.** Replaces the stale flat-format helper semantics from 177.53 with pure helpers that characterize the restored Production-style guided Create Game actions: family selection, Stroke-format selection, Individual/Team branch selection, team-format selection, and team-mode toggle.
- The live Create Game buttons now delegate to those helpers through one patch applier. The helper tests freeze the exact 177.56 working handler behavior, including Stroke → Match → Stroke round trips, before runtime delegation.
- Review now derives its **Next:** message from the same `postCreateDestination()` result used after Create, via `postCreateDestinationLabel()`, so guidance and actual navigation cannot drift.
- No scoring logic, persisted game fields, Manage Game policy, database schema, or migration behavior changes.
