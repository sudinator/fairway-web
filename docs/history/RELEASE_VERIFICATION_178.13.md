# Release Verification — 178.13.260829

## Scope
CI assertion-baseline correction only. No application or scoring behavior changes from 178.12.

## Evidence
- GitHub CI for 178.12 executed the expanded Alternate Shot suites and reported the following deliberate assertion increases: `alt shot` 71→73, `alt shot scores` 45→49, `alt shot scoring` 28→30, `alt shot simulation` 0→178103.
- Baseline updated to 184,887 assertions across 41 suites.
- `ci/check_test_assertions.py` itself was not bypassed or weakened.
- Release/version guards rerun locally after the metadata change.

## Remaining gate
The new staging push must rerun GitHub `npm run ci`, staging integration, and Vercel. This release is not production-deployable until those pass.
