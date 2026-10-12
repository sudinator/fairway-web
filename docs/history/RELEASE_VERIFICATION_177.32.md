# Release Verification — 177.32.260815

## Scope
Diagnostic-only correction to the transaction lifetime of `ci/assert-core-rls-live.sql`. No policy, grant, helper, migration, application behavior, staging database, or Production database change.

## Implemented
- Added an explicit transaction around the complete read-only verifier.
- `ON COMMIT DROP` temporary diagnostic tables now remain alive until all diagnostics and the final hard gate complete.
- Added a source-contract assertion that the transaction begins before `_core_rls_expected` is created and commits only after the final PASS path.

## Validation
- Python syntax check for `ci/check_fresh_db_ci_contract.py`: **EXECUTED PASS**.
- Transaction source-contract predicate on the corrected SQL: **EXECUTED PASS**.
- Negative source-contract mutation checks (missing transaction start; early/missing final commit): **EXECUTED PASS** — each malformed fixture is rejected.
- Full repository `npm run ci` / build / tests: **NOT EXECUTED in this isolated overlay**; the complete repository is not present in this runtime.
- Actual disposable PostgreSQL execution, matching fixture: **BLOCKED — local runtime has no PostgreSQL server/client binaries.**
- Actual disposable PostgreSQL execution, deliberate mismatch / `CORE_RLS_DIFF`: **BLOCKED — same environment limitation.**

## Release status
**PACKAGED FOR STAGING DIAGNOSTIC ONLY / NOT DEPLOYABLE.** This overlay exists only to run the disposable fresh-database GitHub gate that cannot be executed in the current runtime. Do not apply database migrations to real staging or Production and do not promote to `main` until executable PostgreSQL scenarios and the complete release gate pass.
