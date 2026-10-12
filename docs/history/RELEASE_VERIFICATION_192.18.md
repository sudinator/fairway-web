# 192.18.260930 — New personal-round payload conversion hotfix

Status: CANDIDATE. Based on 192.17.260930. Production unchanged; live staging confirmation is outstanding.

## Confirmed cause

RoundSetup calls onReady with id="" for a new personal round. RoundEditor sends that object as p_round while sending a separate valid UUID as p_round_id. Migration 0159 parsed the entire p_round JSON as public.rounds, so PostgreSQL attempted to convert the unused empty id to UUID and raised 22P02. This was reproduced against the actual 0159 function in an isolated PostgreSQL fixture: `invalid input syntax for type uuid: ""`.

This is an implementation defect in 0159. The earlier SQL fixture omitted the frontend id placeholder; separate editor and SQL tests therefore missed the interface mismatch. The migration is not retrospectively edited.

## Fix and contracts

Follow-up migration 0160 replaces only save_personal_round. Both round and hole record conversion now receive explicit maps of fields consumed by persistence. Unused JSON id/user_id/game_id/round_id fields are ignored rather than converted. The separate p_round_id, auth.uid() and existing locked database row remain authoritative for identities.

No frontend handlers, component props, scoring functions, profile authorization or database policies change. Authentication, RLS (SECURITY INVOKER), transaction lock, atomic rollback, final/background boundary, manual handicap source, gross-total preservation, callbacks and scoped Discard retain their 192.17 behavior. Migration 0159 is byte-identical to its prior release. No existing records are changed by applying 0160.

## EXECUTED validation

- Before: actual 0159 + the new-round id="" payload reproduced PostgreSQL error 22P02.
- After: actual 0159 followed by 0160 (0160 applied twice) passed the authenticated-role/RLS SQL suite with empty round/hole IDs and forged unused identity values. New backup, immediate completion, retries, same UUID reuse and existing-round edits passed. The actual saved owner is auth.uid(); game identity remains unchanged.
- Existing SQL scenarios passed: mid-save rollback, failed creation rollback, final/background protection, manual value/source, scoped Discard/retry, cross-user denial, total-only historical correction and anonymous execution denial. Isolated PGlite fixture with repository own-round/own-hole policies, not a full Supabase replay.
- Actual React editor regression suite retained: historical Cancel/reopen, lifecycle flush, recovery identity/date, save failure/retry, manual override/new Finish, deliberate deletion, Discard failure/retry, in-flight backup/Finish ordering and gross-only corrections. Simulated network/database; no live account writes.
- Full local Node 22 CI, TypeScript check, unit/differential/render tests, source/lifecycle guards and production build passed.
- All 192.17 app source files are unchanged. Only migration, SQL fixture, release/version metadata and documentation change. No credentials or generated test artifacts are packaged.

## Remaining gates and next staging test

GitHub CI/fresh Supabase reconstruction must pass with 0160 and the expanded SQL fixture. Live staging migration parity, staging deployment and browser/device tests remain required before production. No production deployment is cleared.

After the upstream gate passes and 0160 is applied to staging: retry Save on the same draft that returned 22P02. Confirm one final round and matching holes; then create a second new round and test backup/reload/Finish. Repeat completed-round edit/Cancel/reopen. Failed 0159 saves were transactional; the fixture confirms no partial rows were committed, but the specific live draft/database state has not been independently inspected.

Sources: components/round-setup.tsx; unchanged components/round-editor.tsx; migrations/0159_personal_round_persistence.sql; migrations/0160_personal_round_payload_contract.sql; expanded ci/assert-personal-round-persistence.sql; executed before/after isolated SQL reproductions and local CI.
