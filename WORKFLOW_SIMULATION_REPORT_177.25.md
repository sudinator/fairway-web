# Workflow simulation report — 177.25.260814

Evidence labels:
- **EXECUTED** — code/guard/test actually ran in this workspace.
- **MODELLED** — scenario traced against source/contracts but requires dependency/database/browser execution elsewhere.
- **BROWSER-VALIDATED** — exercised in a deployed browser environment.

## Repository / migration integrity

| Scenario | Evidence | Result |
|---|---|---|
| Migration checklist is regenerated twice | EXECUTED | PASS — second output byte-identical; emphasized ticks and preserved notes survive. |
| Post-ledger migration omits or misnames `record_migration()` | EXECUTED | PASS — semantic ledger guard rejects the defect pattern; current 0113+ contract passes. |
| Legacy 0122–0128 were applied but are absent from ledger | MODELLED + source-guarded | 0135 records only rows whose sentinel objects/privileges prove deployment; `record_migration` is idempotent. Staging DB execution pending. |
| Legacy migration genuinely never ran | MODELLED | 0135 sentinel condition remains false, so it does not manufacture a ledger row. Staging DB execution pending. |
| Fresh database applies migrations in wrong order / has missing dependency | MODELLED + CI-wired | Disposable DB script sorts both migration trees and uses `psql -v ON_ERROR_STOP=1`; first execution is pending GitHub CI. |

## RLS reconstruction

| Scenario | Evidence | Result |
|---|---|---|
| Fresh rebuild lacks one of six policy helper functions | EXECUTED source-closure guard | PASS — source closure covers all six Production-exported helper signatures before 0137. |
| RLS baseline omits a core table | EXECUTED | PASS — exact baseline guard requires all 12 Production-exported tables. |
| RLS baseline omits/changes a Production policy | EXECUTED | PASS — exact manifest comparison requires 60 policies and their definitions. |
| Policy recreation is rerun | EXECUTED source contract | PASS — each known policy is preceded by `DROP POLICY IF EXISTS`. |
| Full empty Supabase DB → all migrations → 12 tables / 60 policies | MODELLED + CI-wired | PENDING — must execute successfully in GitHub's Docker/Supabase environment before release promotion. |
| Staging DB after 0135→0136→0137 matches Production core RLS | MODELLED | PENDING staging migration application and read-only live assertion. |

## Application/runtime integrity

| Scenario | Evidence | Result |
|---|---|---|
| PlayerCard renders with fewer than two data points then later with two or more | EXECUTED source review / lint gate wired | `useId()` now executes before the early return. Dependency-backed React hooks lint pending GitHub. |
| Pace display remains open while a game is active | EXECUTED source contract | PASS — active pace rendering uses reactive `useNowTick()` state rather than a frozen render-time `Date.now()`. |
| AI analysis save succeeds | EXECUTED source contract | PASS — no prop mutation; immutable updated round is sent to the parent callback and local text state is updated. |
| VAPID environment key differs from service-worker public key | EXECUTED contract | PASS — prebuild fails on a mismatch when the environment key is supplied. |
| New UI is added under `app/` and violates scanner rules | EXECUTED guard coverage review | PASS — relevant UI scanners now include both `components/` and `app/`. |
| New `.env` / `.env.*` secret file is created locally | EXECUTED | PASS — Git ignore rules cover it while explicitly keeping `.env.example`. |
| New unused symbol is introduced | EXECUTED | PASS — TypeScript unused-diagnostic ratchet fails on increases/new-file debt and has no cleanup headroom. |

## Adjacent existing workflows

`npm run guards` was **EXECUTED PASS**, including the existing 50,087-check workflow fault simulation, course provider-ID contract, player tee contract, betting atomicity contract, PWA update contract, course-source transparency contract, refactor reachability/state checks, and dashboard Putts/round contract.

## Not yet executable in this workspace

The local dependency tree is incomplete, so dependency-backed `eslint`, full TypeScript typecheck, compiled unit/differential suite, and Next production build are **PENDING GitHub CI/Vercel**. Docker/Supabase CLI are also unavailable locally, so the disposable fresh-database reconstruction is **PENDING GitHub CI**. No scenario in those categories is reported as an executed PASS here.
