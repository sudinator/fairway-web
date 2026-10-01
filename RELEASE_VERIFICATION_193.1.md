# BNN 193.1 — Reset protection verification

**UNVERIFIED CANDIDATE / NOT READY FOR DEPLOYMENT. Only a CI-test-only changed-files ZIP is issued; it is not a deployable release.**

Baseline: uploaded staging 193.0.260930. Uploaded production/main is 192.15.260928. Neither deployment nor either live database was changed. This candidate adds migration 0163; all prior migration files remain byte-identical.

## Implementation

- Each game has an integer scoring_version. Organizer and system-admin resets increment it transactionally and clear player scores/stats/clocks and Alternate Shot side rows, retaining the existing reset authorization and posted-round behavior.
- Player/marker/stat writes go through save_game_score_bundle with the draft's original version. It uses existing caller RLS for ordinary updates and the existing owner-only stats function for stats-only writes. Alternate Shot uses a versioned wrapper around the unchanged canonical side-score permission checks.
- The primary-device lock is acquired before the per-game advisory lock; version checks happen before row mutation. Reset and accepted writes use the same order. Unversioned legacy writes are rejected. This is the proposed concurrency contract; real independent-connection execution remains a blocking unexecuted gate.
- Backup and Alternate Shot draft versions survive offline reopen. A reset-version mismatch invalidates pre-reset edits without trusting the device clock. A rejected write is never acknowledged as synchronized. Reload is requested before draining the player outbox again.
- Failed organizer resets retain visible scores and unsynced player/side drafts. Local clearing happens after confirmed server success.
- Course and hole-count RPC replacements add the scoring locks/context needed for their blank-array writes. Differential comparison against latest 0138/0153 definitions verifies their existing validation and data writes, including manual-handicap clearing, are preserved.
- APP_RULES.md now includes the explicit mandatory automated-testing requirement from the project operating procedures.

## Executed evidence

| Check | Result | Evidence level and limit |
|---|---|---|
| Final full npm run ci | PASS, exit 0 | EXECUTED locally under Node 24.19.0; required GitHub Node 22 run remains outstanding |
| TypeScript, hook lint, complete existing unit/differential suite | PASS | EXECUTED within full local CI; assertion ratchet retains 439,421 assertions across 49 tracked suites |
| New reset callback tests | PASS | EXECUTED actual callback with MODELLED Supabase responses: viewing denial, cancel, queue idle, failure retention, success-only clearing/reload |
| Recovery/version tests | PASS | EXECUTED actual load/send callbacks with MODELLED network/storage: old draft version retained, version mismatch beats fast device clock, rejection pauses recovery and does not advance watermark |
| Primary-device and personal-round regressions | PASS | EXECUTED actual controllers/components with MODELLED storage/network; actual DOM click/re-entry coverage, not live browser/staging validation |
| Source guards and differential setup-contract check | PASS | EXECUTED; latest course/length validation and data-write bodies retained apart from documented lock/context additions |
| Complete Next.js production build | PASS | EXECUTED locally using the public VAPID value read from committed sw.js |
| Actual 0163 applied twice; reset SQL matrix | PASS | EXECUTED PostgreSQL/PGlite engine against an explicitly MODELLED minimal schema, actual game-player write policies copied from 0137, actual 0067/0141/0162 functions. This is not a full Supabase reconstruction and cannot prove independent-connection lock ordering |
| Nine/18/back-nine setup SQL round trip | PASS | EXECUTED existing SQL regression in the same isolated fixture |
| Historical migration immutability | PASS | EXECUTED byte comparison: zero prior files changed |
| Concurrency test syntax | PASS | Python compilation only; no behavior/concurrency pass claimed |

The SQL matrix covers current/stale/absent versions, positive save and null clear, ordinary and own-stats writes, stale Alternate Shot, repeated organizer/admin resets, direct and legacy-RPC bypass rejection, primary-device transfer, browser version rewind denial, anonymous grants and rejected metadata patches. The fixture simplifies prerequisite tables/read policies/helper functions; full RLS/security closure is still a GitHub gate.

Available nonoptional cached dependencies matched the supplied lockfile. Early build attempts failed for a missing public VAPID value and an external node_modules symlink; both environment issues were corrected. The final local CI/build passed. New isolated-fixture permission failures were corrected in the fixture, then the final SQL matrix passed. These corrections do not waive any gate.

## Blocking checks not executed

1. Complete migration-chain replay and all SQL/security assertions on a fresh disposable Supabase database. Attempted ci/test_fresh_db_rebuild.sh stops with `supabase: command not found`. Supabase CLI, Docker and psql are absent here. An isolated fixture does not substitute for this gate.
2. Real independent-connection reset races. ci/test-game-reset-concurrency.py is wired into the fresh-database job and uses actual PostgreSQL advisory-lock barriers, both orderings, different accounts, player/stat/Alternate Shot requests and a current-version retry. Its local invocation reports `BLOCKED: psql is unavailable`. Syntax was checked; behavior has not run.
3. Authenticated staging integration and actual browser sessions. The integration script includes stale side/stat rejection after an organizer reset. No signed-in staging session or staging test credentials were supplied; no staging pass is claimed.
4. GitHub's required Node 22 CI, Vercel staging validation, final PR verify, Production Ready and non-destructive production smoke. None was executed in this workspace.
5. Physical mobile/PWA suspension/offline reopen check after automated gates pass. No new manual testing is requested while the automated blockers remain.

## Promotion limits

Do not apply 0163 or deploy this candidate yet. Older game-scoring clients lack the versioned write contract and need a reload after migration/deployment. Code rollback alone will not remove the database fencing. Production requires review of the actual migration ledger and coordinated deployment/refresh and recovery steps. Main/staging ZIPs cannot prove applied database state.

Reset protection is not closure of the wider audit. Atomic game creation, club-admin handicap-write outcomes and failed-read behavior still require current-code investigation and a finite production-blocker decision. Optional features and cosmetic backlog should not extend the release indefinitely.

## Evidence files and source

- verification/193.1/local-ci.log
- verification/193.1/isolated-sql.log
- verification/193.1/fresh-db-blocker.log
- migrations/0163_game_reset_fencing.sql
- ci/assert-game-reset-fencing.sql; ci/test-game-reset-concurrency.py; ci/test-game-reset-isolated.cjs
- ci/test-game-score-recovery.cjs; ci/test-game-reset.cjs; ci/check_reset_setup_contract.py
- components/tournaments.tsx; lib/draft.ts; lib/alt-shot-side-scores.ts; lib/game-types.ts

This report distinguishes executed source/components/SQL from modelled environments and unexecuted browser/concurrency/staging gates. No deployment-readiness claim is made.

## Authorized CI handoff

Use CI_TEST_ONLY_193.1.md: branch from staging, publish ci/193.1-reset-protection, open a draft PR targeting staging, and leave it unmerged. This existing pull_request workflow runs fresh Supabase and Node 22 validation without its live staging integration or production parity jobs. No manual migration or live scoring test yet.
