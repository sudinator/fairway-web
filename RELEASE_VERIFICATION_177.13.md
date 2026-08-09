# 177.13.260808 Release Verification

## Migration numbering

**0129 is intentionally skipped/reserved in this release.** The deployable v177.13 migration sequence is **0130 → 0131 → 0132**. There is no `0129_workflow_atomicity.sql` in this bundle; that numbering was deliberately avoided because a separate production 0129 identifier had already been used.

## Purpose
This release supersedes 177.12 after external review and live-schema inspection identified that `group_course_overrides` and `course_change_requests` existed in production but were absent from the checked-in baseline/migration creation path, and that browser roles retained unnecessary direct-write privileges.

## Live DB facts supplied during review
- `group_course_overrides` exists with: id, group_id, course_id, name, location, data, updated_by, updated_at, created_at.
- It has `UNIQUE (group_id, course_id)`, satisfying the RPC `ON CONFLICT (group_id, course_id)` target.
- `course_change_requests` exists with all fields used by 0131 review/submit functions.
- Both tables had broad anon/authenticated table grants and legacy direct-write RLS policies.
- Product decision: every active member of the relevant group may read submitted course corrections.

## Release changes
1. Renumber workflow migrations to 0130/0131 to avoid the separately-used production 0129 number.
2. Add 0132 schema reconciliation + privilege hardening.
3. Add both course tables to `supabase/migrations/0001_baseline.sql` so fresh DBs create them before app migration 0084 references `course_change_requests`.
4. 0132 uses `CREATE TABLE IF NOT EXISTS`, so it does not replace or destroy the verified live tables.
5. 0132 revokes direct browser-role writes and grants authenticated SELECT only; write policies are removed and writes go through SECURITY DEFINER RPCs.
6. Member-readable SELECT policies are preserved intentionally.
7. Added CI `check_course_schema_contract.py` to prevent schema/provenance/direct-write regression.
8. Added model-based `workflow_fault_simulation.py` to the normal guard suite.

## Verification run
- Existing repository static/UI/security guards: PASS.
- Migration authorization guard: PASS.
- Course schema contract: PASS.
- Workflow fault simulation: PASS (50,082 assertions; 50,000 randomized RSVP operations).
- TypeScript syntax/transpile pass: PASS (115 TS/TSX files).
- Python guard compilation: PASS.

## Mandatory staging gate
This environment does not provide PostgreSQL/Supabase runtime execution. Before production deploy:
1. Apply 0130, 0131, 0132 to staging in that order.
2. Confirm direct INSERT/UPDATE/DELETE by authenticated users against both course tables is denied.
3. Confirm group members can SELECT their group overrides/correction requests.
4. Confirm `submit_course_correction` succeeds for an active member and remains retry-safe.
5. Confirm `review_course_correction` succeeds for an app admin and rejects non-admins/double review.
6. Exercise Money save/edit, game finish/post, group delete, and RSVP flows against staging.
