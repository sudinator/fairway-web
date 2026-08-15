# Release verification — 177.25.260814

Status: **IN PROGRESS / NOT DEPLOYABLE**

## EXECUTED locally
- `npm run guards`: PASS with migration-ledger, exact RLS helper/policy/source-closure, fresh-DB CI wiring, runtime, VAPID, reactive-time, round-analysis, environment, UI, refactor, course, PWA, and dashboard contracts.
- Migration checklist regeneration: PASS; second run byte-identical.
- Migration ledger semantic guard: PASS across committed migrations 0113+ and documented numbering gaps.
- Exact Production RLS helper contract: PASS (6 helpers).
- Exact Production core RLS baseline contract: PASS (12 tables / 60 policies / exported grants).
- Core RLS source closure: PASS.
- Unused-symbol debt ratchet: PASS (512 grandfathered diagnostics across 27 files; no headroom).
- Node runtime contract: PASS (Node 22 pinned for CI and Vercel package engines).
- Fresh-database CI wiring contract: PASS (execution pending GitHub).
- Python guard syntax compilation for the expanded UI-root checks: PASS.
- Environment reference inventory: PASS; all 18 referenced variables documented in `.env.example`.

## NOT EXECUTED locally
- Latest `npm run ci` attempt: BLOCKED at `npm run lint:hooks` because this isolated working tree does not contain the installed ESLint binary; registry access is unavailable to repair the dependency tree here.
- `npm run lint:hooks`, `npx tsc --noEmit`, full `npm test`, and `npm run build`: require dependency-backed GitHub CI/Vercel validation.

## DATABASE REPRODUCIBILITY GATE
- Production RLS policy/grant export: CAPTURED (12 core tables / 60 policies).
- Production RLS helper export: CAPTURED (6 SECURITY DEFINER helpers).
- `0136_core_rls_helpers.sql`: authored from the exact Production helper export.
- `0137_core_rls_baseline.sql`: authored from the exact Production RLS/grant export.
- Exact helper/policy/source-closure guards: EXECUTED PASS locally.
- Full fresh-database migration-chain execution: NOT YET EXECUTED; CI now starts a clean Supabase Postgres instance and explicitly applies the combined two-tree migration stream with `psql -v ON_ERROR_STOP=1`, then runs the live RLS assertion. GitHub execution is still required.
- 177.25 remains NOT DEPLOYABLE until fresh-database reconstruction plus normal dependency-backed CI/staging gates pass.


## SIMULATED / SCENARIO TESTING
- Detailed evidence classification and changed/adjacent scenarios: `WORKFLOW_SIMULATION_REPORT_177.25.md`.
- Modelled scenarios are not counted as executed PASSes.
