# Release verification — 177.26.260814

Status: **NOT DEPLOYABLE — corrective staging candidate**

## Why 177.26 exists
The first GitHub execution of 177.25 exposed two independent defects in the new verification machinery, not in Production application behavior:
1. the disposable fresh-DB harness sorted full migration paths, causing `migrations/0014_round_clock.sql` to execute before `supabase/migrations/0001_baseline.sql`;
2. the live staging RLS equality check was enforced before staging had deliberately received migrations 0135-0137, creating a circular gate.

## Corrective changes
- Added `ci/list_ordered_migrations.py` to produce one numeric migration stream across both migration directories and reject duplicate migration numbers.
- `ci/test_fresh_db_rebuild.sh` now consumes that semantic ordering rather than sorting full paths.
- `ci/check_fresh_db_ci_contract.py` executes the ordering helper and proves 0001 precedes 0014, numeric order is monotonic, and prefixes are unique.
- `ci/schema-check.sh` now gates exact core-RLS live equality on the `0137_core_rls_baseline` migration-ledger sentinel. Existing live schema/default checks remain unconditional.
- Version/release metadata advanced to 177.26 per BNN release rules.

## Evidence
- MODELLED: pre-migration staging remains allowed to differ from the new Production-derived RLS baseline until 0137 is deliberately applied.
- EXECUTED: migration ordering helper emits 0001 first, is numeric-monotonic, and rejects duplicate prefixes.
- EXECUTED: source/guard suite must pass before packaging.
- PENDING: disposable Supabase fresh-database reconstruction in GitHub CI.
- PENDING: dependency-backed hook lint, TypeScript, unit/differential tests, and production build in GitHub CI.
- PENDING: migrations 0135 -> 0136 -> 0137 on staging only, followed by live RLS equality = zero drift.

## Database safety
Do **not** apply 0135, 0136, or 0137 to Production. Do not apply them to staging until the corrected disposable fresh-database GitHub gate passes.

## Local dependency-backed validation note
- `npm run guards`: **EXECUTED PASS**.
- Migration-ordering contract: **EXECUTED PASS**; combined stream begins at `0001_baseline.sql`, places `0014_round_clock.sql` after the baseline, and ends at `0137_core_rls_baseline.sql`.
- `npm run lint:hooks` / full TypeScript / unit suite / Next build: **NOT EXECUTED locally** in this corrective workspace because the available copied dependency tree does not contain the required ESLint binary. These remain mandatory GitHub CI gates and must not be reported as PASS locally.
- Disposable Supabase fresh-DB rebuild: **PENDING GitHub CI**; this is the critical gate this correction is intended to re-run.
