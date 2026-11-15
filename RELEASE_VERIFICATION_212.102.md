# 212.102 — Organizer tee fallback correction

Status: LOCAL APPLICATION CHECKS PASSED; live GitHub/Vercel/staging checks pending. Not production clearance.

Baseline: main 795a6278c5757cd747872b3640473845933fa7b7 (212.101.261113).

## Contract review

- Inputs: course-library/cached tee array, player tee snapshots, course par; save also reads selected player, selected name, handicap index and current setup policy.
- UI output: exact-name library-first options plus same-name snapshot fallbacks; yardages optional. Missing/non-finite/non-positive rating/slope now excludes that option intentionally.
- Save output: existing rating/slope/name/course-handicap patch, same player ID, same success/error reporting and load callback. Manual source, scores, stats and all unrelated fields unchanged.
- Reachability: actual Organizer selector onChange invokes onSetTee; existing GameRoom callback is setPlayerTee. Both now use gameTeeOptions.
- Dependencies: existing CourseTee type, courseHandicap, setup policy, database update, saved notifier and load. No dependency, database, authorization or stale-game-policy change.
- Intentional behavior changes: a snapshot-only offered tee can save; unresolved name shows recovery message; unusable rating/slope options excluded.
- No automatic course refresh/overwrite added. Existing load/cache fallback retained.

## Targeted evidence — EXECUTED with MODELLED boundaries

161 assertions passed in ci/test-game-tee-options.cjs. Executes actual selector JSX in jsdom and the TypeScript-extracted final save handler. Database responses, policy outcome and parent reload are modelled, not live staging/browser evidence.

Negative control: the baseline handler reproduces the snapshot-only silent no-op through the same selector.

Covers library-only and snapshot-only selection, same-name library precedence, no yardages, invalid/missing rating/slope, no unrelated-name substitution, handicap recalculation and missing index, score/stat preservation, selected-value rendering after reload, Blue → White → Blue, policy denial, failed write and preserved prior display, unresolved selection feedback, and retry.

Differential: executes baseline handler preserved byte-for-byte from the pinned main commit for 12 normal library cases (six index values × two tees); compares write payload, final player state, messages and reload count. Snapshot-only saving is the intentional difference.

Targeted source guards: player tee setup PASS; shared setup-policy contract PASS; version ledger PASS. Final local application checks: PASS — lint/hooks, TypeScript no-emit, full unit/render/differential suites, 171 moving-clock suites, all source guards, update/offline/redirect Chromium browser checks, diagnostics privacy/persistence/browser checks and chart layout (1,393 assertions across 324 data/viewport cases). The assertion gate reported 447,288 assertions across its 108 counted suites. The new tee test passed 161 assertions separately.

The final npm run ci reached the production build with every preceding check passing. That build rejected the temporary node_modules symlink pointing outside this worktree. Replaced the symlink with an unchanged local copy of the baseline dependencies and reran npm run build: PASS (compile, TypeScript, static generation and routes). No source workaround or test weakening. Local validation is recorded across the final CI log and successful build log, not as a single uninterrupted successful CI invocation.

Initial validation history (retained): an existing offline-navigation browser case timed out at ci/test-update-browser.cjs:42. It passed unchanged on targeted retry, and the unchanged 212.101 baseline passed the same test. Root cause of the intermittent timeout remains unproven; no test was weakened or skipped. The subsequent diagnostic browser check correctly detected generated app-version metadata still at 212.101 while package.json had moved to 212.102. Regenerated metadata using the normal prebuild script, with the public VAPID key from committed CI configuration, then restarted the full local CI command. An initial prebuild attempt without that public environment value was correctly rejected; no bypass was used.

## Remaining external gates

- GitHub CI including fresh database assertions and required verify check.
- Vercel staging Ready, test real save/reopen in existing course setup and simulated-missing-library fixture where available.
- Phone update and small staging smoke check.
- PR staging → main only after staging gates pass; production Ready and non-destructive smoke check after merge.

No migrations introduced; migrations and SQL assertions remain unchanged. Fresh-database execution was not performed locally (no PostgreSQL/Docker runtime). Node runtime here is v24.22.1; repository CI pins Node 22.

## Stale games — proposal only

Recommend hourly scheduled execution with observable success/failure; do not depend on app opening. Complete cards after 24 hours without scoring changes and after the scheduled play date; use intended 9/18-hole length and the canonical team card in one-ball formats. Optional stats must not block completion. Proposed eligibility includes all actual participants, including guests; empty player cards require an explicit no-show/withdrawal decision rather than assuming absence. Partial games should prompt organizer review at 48 hours and offer explicit close-as-incomplete, preserving recorded holes without fabricating scores or automatically qualifying rounds for handicap. Empty drafts could archive after seven days of inactivity once their scheduled play date has passed (or if unscheduled), reversibly, without statistics/round posting. Future scheduled games must not be auto-archived. Preserve Test-club exclusion. Evaluate one-ball formats, recent offline sync, activity timestamps, historical backlog, retries and posting rollback before implementation.

This proposal has not been approved or implemented.
