# Release Verification — 177.33.260815

## Scope
Correct the core-RLS runtime parity gate after 177.32 successfully exposed 15 PostgreSQL deparser/rendering differences. No application behavior, RLS policy definition, grant, helper, migration, real staging database, or Production database is changed.

## Evidence before change
- 177.32 disposable fresh-DB replay completed the 135-migration stream and reached the final RLS hard gate.
- Diagnostics reported 15 policy keys rather than the prior 30 symmetric diff rows.
- All 15 retained the expected policy identity, permissive mode, role, and command; the displayed differences were confined to `qual` / `with_check` rendering of subquery expressions.

## Implemented
- Parse/deparse the checked-in expected expressions on session-local shadow tables using the same PostgreSQL server that owns the actual policies.
- Compare actual `qual` / `with_check` against that runtime-canonical expected form; retain exact checks for key/permissive/roles/command, table RLS state, and grants.
- Preserve raw Production export text in diagnostics and emit non-failing `CORE_RLS_RENDERING` rows only when raw text differs but runtime-canonical expected equals actual.
- Preserve `CORE_RLS_DIFF` as the hard-failure channel for genuine mismatches.
- Emit `CORE_RLS_DB_VERSION` diagnostics.
- Add executable PostgreSQL canaries: equivalent formatting must converge; removed admin predicate, AND->OR, removed guest predicate, removed self-ownership, organizer-condition mutation, and removed active-membership predicate must remain distinct.

## Contract / scenario review
- Inputs preserved: checked-in 60-policy Production contract, live `pg_policies`, table RLS state, roles/commands, and grant set. No application inputs or database data rows are read by the canonicalization shadows.
- Outputs preserved: zero genuine differences => PASS; missing/unexpected policy, metadata drift, expression drift, RLS-state drift, or grant drift => hard failure. New informational outputs are `CORE_RLS_DB_VERSION`, `CORE_RLS_RENDERING`, and `CORE_RLS_CANARY_PASS`.
- Side effects: session-local temporary tables and policies only, inside the existing explicit transaction; `ON COMMIT DROP` cleans them up. No persistent schema/data write is introduced.
- MODELLED: raw-only PostgreSQL rendering difference => informational `CORE_RLS_RENDERING`, no hard failure.
- MODELLED: missing policy / role change / command change => hard `CORE_RLS_DIFF`.
- MODELLED: material predicate change => hard `CORE_RLS_DIFF`; representative mutations are also executable PostgreSQL canaries in the script.
- MODELLED: verifier failure before final PASS => transaction abort/session teardown removes temporary objects; persistent application state remains untouched.

## Validation in this workspace
- Python syntax compilation of `ci/check_fresh_db_ci_contract.py`: **EXECUTED PASS**.
- Static source-contract assertions for runtime canonicalization/version/canaries/transaction lifetime: **EXECUTED PASS**.
- Negative source-contract mutations (remove runtime canonicalization, revert hard compare to raw, remove a semantic canary, remove DB-version diagnostic, remove final commit): **EXECUTED PASS** — each malformed fixture is rejected by the local contract predicate.
- Version/release metadata consistency across package/package-lock/app version/public version/docs: **EXECUTED PASS**.
- SQL execution against PostgreSQL: **PENDING GITHUB disposable fresh-DB CI**; this runtime has no PostgreSQL server/client binaries.
- Full dependency-backed `npm run ci`, typecheck, unit/differential tests and Next build: **PENDING GITHUB CI**; the overlay does not contain the full repository/dependencies.

## Release status
**STAGING-DIAGNOSTIC CANDIDATE / NOT DEPLOYABLE.** Do not apply migrations to real staging/Production or promote to `main` until disposable PostgreSQL execution proves the canaries and zero genuine `CORE_RLS_DIFF`, followed by the complete BNN release gate.
