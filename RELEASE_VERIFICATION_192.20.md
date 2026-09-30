# 192.20.260930 — Fresh-database CI correction and staging test plan

Status: CANDIDATE; local checks PASS. GitHub fresh-Supabase confirmation remains outstanding. Based on 192.19. Production remains deferred. No new migration.

## Observed evidence

The user's GitHub screenshot shows ci/assert-game-round-manual-handicap.sql completed its main posting-matrix DO block and the authenticated outsider post_group_rounds call. At line 131, the final DO block deliberately calling the revoked internal posting function lost its database connection. psql reports “server closed the connection unexpectedly” and exit code 2. This is a connection/backend failure, not the fixture raising a failed handicap assertion. The screenshot alone cannot establish whether the backend crashed, was killed, or encountered another provider/extension problem.

## Change and evidence boundary

Replace the deliberate permission-error/catch subtransaction with direct has_function_privilege verification for the ACTUAL current caller; assert current_user is authenticated. This still checks internal execution is denied. Retain the explicit authenticated/anonymous grant checks, the actual outsider group-posting call and its no-change data assertion, plus all 48 posting cases, actual insert-conflict assignments, reposts, date/audit fields and format exclusions. No application, database grant, RLS policy, function or migration changes.

Inference: avoiding the exception-based probe may avoid the failure point observed in this environment. The underlying database termination cause is unconfirmed; only a GitHub rerun establishes whether this correction resolves that environment's failure. Do not claim the server cause is fixed based on isolated local tests.

Fresh-database cleanup now prints only this temporary project's database container state, OOMKilled flag, exit code/error and last 100 server-log lines before stopping/removing it on failure. Successful runs stay quiet. Diagnostic errors do not mask the original failure status. These logs provide actionable evidence if GitHub fails again.

TEST_PLAN_192.20.html provides the requested standalone staging plan: 16 cases, clear steps/expected outcomes, PASS/FAIL/BLOCKED records, notes, print and downloaded results. All manual results start NOT RUN. It distinguishes two devices using Amit's account from a genuinely separate login for non-marker permission checks, genuine reload from an in-memory resume, and same-device reset ordering from the unresolved cross-device race inference. This is a test document, not an application UI mockup.

## EXECUTED local checks

- Node 22.23.3 full npm run ci PASS, exit 0: actual personal editor and game-recovery regressions, lint, TypeScript, existing math/differential/render/screen/navigation suites, source/lifecycle/release guards and production build. VAPID public key verified.
- Actual unchanged 0161 migration plus revised committed SQL assertion PASS in isolated PGlite/PostgreSQL. Full 48-case matrix, insert/repost/conflict, source/audit/date fields, excluded formats, outsider call, current-role ACL and rollback retained. This is not a fresh Supabase replay.
- Actual rebuild script failure-trap test with simulated CLI/container commands PASS: original exit code 7 preserved, diagnostics restricted to the configured test project, cleanup executed; repeated with diagnostics themselves failing (exit 42), still preserved original exit 7. bash -n PASS. Docker/Supabase CLI remain unavailable locally, so real container failure logs are not locally exercised.
- Test-plan document EXECUTED with jsdom: 16 cases, NOT RUN defaults, result counts, browser-local state and export action PASS. No claim of live device QA.
- All application source and migrations through 0161 byte-identical to 192.19, apart from generated release-version assets. Only CI assertion/diagnostics, version/docs and test-plan document change.

## User next steps

1. Extract this changed-files ZIP over 192.19; commit on staging with GitHub Desktop. Suggested commit: “192.20: correct posting privilege CI probe and capture rebuild diagnostics”.
2. Re-run GitHub CI. No new SQL to run for 192.20. If 0161 from 192.19 is not yet applied to STAGING, it is still required before live migration parity can pass.
3. If rebuild fails again, capture the new Fresh database failure diagnostics section with the first SQL error. Keep staging validation blocked; do not merge to production.
4. Once CI/Vercel are green and staging shows 192.20, open TEST_PLAN_192.20.html and record the live results. Remaining audit bugs still prevent production clearance even if this plan passes.

Sources: user-supplied GitHub CI screenshot; baseline ci/assert-game-round-manual-handicap.sql lines 126–131; revised assertion; ci/test_fresh_db_rebuild.sh; unchanged 0161; prior TEST_PLAN.md / TEST_PLAN_RESUME_PERSISTENCE.md; RELEASE_VERIFICATION_192.19.md; executed local CI, isolated SQL, failure-trap and document checks.
