# Release Verification — 178.17.260829

## Scope
Correct the React hook-order lint failure introduced by Alternate Shot side-game suppression and add a permanent dependency-free source backstop.

## Code consistency
- `GroupSegmentSummary` still suppresses Alternate Shot individual side-game output.
- `React.useState` is now called before the Alternate Shot early return, preserving hook order.
- No Alternate Shot scoring engine, score fan-out, persistence, handicap, result, or finalization code changed.

## Executed validation
- `python3 ci/check_react_hook_order_source.py`: PASS.
- Synthetic negative component with early return before `React.useState`: guard correctly FAILS.
- `python3 ci/check_altshot_team_card_contract.py`: PASS.
- `python3 ci/check_altshot_view_contract.py`: PASS.
- `python3 ci/check_version_ledger.py`: PASS.
- `python3 ci/verify_release.py .`: 20/20 PASS.
- `python3 ci/workflow_fault_simulation.py`: 50,087 checks PASS.

## Dependency-backed gates
Local ESLint is unavailable because this extracted environment has no complete `node_modules`. Full ESLint / TypeScript / test / build execution remains authoritative in GitHub CI and Vercel staging. This release is not deployable until those pass.

## Database
No migration.
