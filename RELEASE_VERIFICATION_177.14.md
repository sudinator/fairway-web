# Release Verification — 177.14.260808

## Scope
Reliability/test-infrastructure release. Adds a real staging Supabase integration harness, structured AI request/output contracts, a bounded course-search cache, CI protection against new React effect suppressions, and atomic TGC bet post/re-post/un-post. Migration 0133 is required. Migration 0129 remains intentionally skipped/reserved; 0130/0131/0132 are v177.13 prerequisites already confirmed live by the user.

## Automated checks executed in this build environment
- `npm run guards`: PASS.
- Workflow model/fault simulation: PASS, 50,087 assertions including 50,000 randomized RSVP operations.
- Course schema contract: PASS.
- Staging integration source contract: PASS.
- Bet atomicity source contract: PASS.
- React effect suppression guard: PASS; 22 reviewed legacy suppressions, no new suppressions.
- New pure TypeScript tests for AI contracts and bounded TTL cache: PASS using the available global TypeScript compiler.
- TypeScript parser/transpile syntax check on every modified TS/TSX file: PASS.
- `node --check ci/integration/staging.mjs`: PASS.

## What could not be executed here
The real `npm run test:staging` suite requires staging Supabase URL/anon/service-role credentials and intentionally mutates that staging project. Those credentials are not available in this execution environment, so the staging suite is shipped but not run here. It refuses to run without `BNN_STAGING_ALLOW_MUTATION=YES`.

The repository-wide `npm test` cannot run cleanly in this environment because package dependencies / `@types/node` are not installed; this is the same package-environment limitation seen in prior reviews. The new self-contained TypeScript tests were compiled and executed independently and passed.

## Required deployment gate
1. Apply `0133_testing_and_money_atomicity.sql` to staging.
2. Configure staging CI secrets and run `npm run ci:staging` (or the GitHub `Staging integration` workflow).
3. Only after that passes, apply 0133 to production and deploy v177.14.

## 0133 preflight behavior
0133 verifies that `group_courses` can support `ON CONFLICT(group_id,course_id)`. If historical duplicate pairs exist it intentionally aborts with a clear error rather than silently deleting/deduplicating data.
