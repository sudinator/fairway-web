# Release Verification — 177.34.260815

## Scope
Correct the verification architecture after 177.33 proved that pg_temp shadow relations change PostgreSQL deparser qualification. No application behavior, RLS policy definition, grant, helper, migration, real staging database, or Production database is changed.

## Root cause addressed
177.33 parsed expected expressions on pg_temp clones, while actual policies remained attached to public tables. PostgreSQL therefore deparsed relation references in different namespace contexts (for example `rounds` vs `public.rounds`). Raw `pg_policies.qual/with_check` text is not a stable semantic equality format.

## Implemented contracts
1. **Live structural hard gate (read-only):** 12 core tables present with RLS enabled/NO FORCE; exact 60 policy keys with permissive mode, roles and command; exact exported grants. Expression text is deliberately excluded from this production-safe gate.
2. **Source expression hard gate:** the existing `ci/check_core_rls_baseline.py` remains authoritative for exact 0137 policy expression content against the captured Production manifest; the full migration replay proves those definitions parse and bind on a fresh PostgreSQL engine.
3. **Fresh-DB authorization behavior:** authenticated user A sees/writes their own notification/round/hole fixtures; user A cannot insert rows owned by user B. Unrelated triggers are transactionally disabled so the test isolates RLS.
4. **Permanent CI architecture guard:** fresh rebuild must execute all three layers and must not regress to pg_temp expression canonicalization or live raw-expression hard equality.

## Input / output / dependency inventory
- Inputs: checked-in 60-policy Production contract, rebuilt `public` tables/policies, exact checked-in 0137 policy source/Production manifest, `auth.uid()` JWT claim behavior, table grants, six existing RLS helpers.
- Outputs: structural PASS/fail; real authorization PASS/fail.
- Side effects: live verifier has none. Behavior fixtures and trigger state changes exist only inside an explicit transaction ending in ROLLBACK; the live verifier is read-only.
- Dependencies: full ordered migration replay, Supabase auth schema/functions/roles, PostgreSQL catalogs, 0136 helpers, 0137 policies/grants.

## Validation in this workspace
- Python syntax compilation for `ci/check_fresh_db_ci_contract.py`: EXECUTED below.
- Static architecture/source-contract checks and negative mutations: EXECUTED below.
- Version/release metadata consistency: EXECUTED below.
- PostgreSQL execution: NOT EXECUTED — this runtime has no PostgreSQL/Supabase/Docker binaries. Required GitHub disposable fresh-DB execution remains a hard gate.
- Full `npm run ci`, `npx tsc --noEmit`, unit/differential tests and Next build: NOT EXECUTED in this partial overlay workspace; required GitHub CI gates.

## Release status
**STAGING VALIDATION CANDIDATE / NOT DEPLOYABLE.** Do not apply 0135-0137 to real staging or Production and do not promote to main until the new disposable PostgreSQL gates and the complete BNN release gate are green.
