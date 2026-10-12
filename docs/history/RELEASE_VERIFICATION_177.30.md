# Release Verification 177.30.260814

Status: **NOT DEPLOYABLE — disposable fresh-database replay still pending GitHub CI.**

## Defect addressed
CI #39 replayed clean migrations through 0042 and failed at 0043 because historical `rounds.game_id` was missing from the source-controlled baseline.

## Changes
- Restored nine Production-derived historical compatibility columns to `0001_baseline.sql`.
- Added fresh-database SQL assertion for exact presence/type/nullability/default contract of those columns.
- Strengthened static migration dependency analysis for executable column dependencies.
- Added negative regression coverage for the exact `rounds.game_id` / 0043 failure pattern.
- Version/release documentation updated.

## Executed locally
- `python3 ci/check_legacy_migration_prereqs.py`: PASS.
- Negative test removing `rounds.game_id`: EXPECTED FAIL at 0043; restored tree then PASS.
- `python3 ci/check_fresh_db_ci_contract.py`: PASS.
- `npm run guards`: PASS, including 50,087 workflow fault-simulation checks and all migration/RLS/environment/UI/refactor contracts.

## Pending mandatory gates
- GitHub disposable fresh Supabase replay of all migrations.
- `npm run ci` dependency-backed hook lint, TypeScript, unit/differential tests, guards and production build in GitHub.
- Robustness workflow.
- Staging DB application/verification of 0135-0137 only after fresh-DB replay passes.
- Version/PR/Production release gates and smoke tests.
