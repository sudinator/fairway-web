# Release Verification — 177.31.260814

## Scope
Diagnostic-only correction to the final core-RLS parity gate after CI #40 completed the full migration stream but reported 30 count-only policy-difference rows. No policy definitions, grants, helpers, application code behavior, or live database state are changed.

## Evidence before change
- CI #40 reached `0137_core_rls_baseline.sql`.
- `ci/assert-historical-baseline-columns.sql` reported PASS for all 9 compatibility columns.
- Final `ci/assert-core-rls-live.sql` failed with `30 differing row(s)` but did not identify the policies or fields.

## Implemented
- Materialize expected and actual core policy rows in temporary tables.
- Emit a `CORE_RLS_DIFF` row for every affected policy key before raising the hard-gate exception.
- Report field-level expected/actual values for permissive mode, roles, command, USING (`qual`) and WITH CHECK.
- Report diagnostic whitespace-only flags for expressions while retaining exact raw equality as the hard requirement.
- Add source-contract checks ensuring RLS failures remain diagnostically actionable.

## Local/source validation
- `python3 ci/check_fresh_db_ci_contract.py`: **EXECUTED PASS**.
- `npm run guards`: **EXECUTED PASS**, including 50,087 workflow fault simulations and all existing RLS/migration/source-contract guards.
- Disposable fresh Supabase replay: PENDING GITHUB CI.
- Dependency-backed TypeScript/unit/build: PENDING GITHUB CI.

## Release status
**NOT DEPLOYABLE.** 177.31 exists to reveal the exact final RLS discrepancies. No staging/Production migration should be applied until those differences are reviewed and the disposable fresh-database RLS parity gate is green.
