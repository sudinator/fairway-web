# Release Verification 177.37.260815

## Scope
Staging integration release-gate safety only. No application runtime logic, migration, RLS policy, grant, schema, or Production database change.

## Changed contracts
- Real staging integration runs inside the already-required `CI / verify` job for the exact `staging -> main` PR path.
- Manual destructive runs require `confirm_mutation=YES`.
- Harness refuses the known Production Supabase project before creating the service-role client.
- Harness deletes `money_audit` fixtures after expense deletion and verifies zero audit rows remain per disposable group.
- Source guard permanently requires those controls.

## Executed locally
- `node --check ci/integration/staging.mjs`: PASS.
- `python3 ci/check_integration_contract.py`: PASS.
- Negative source-contract mutation — remove Production refusal: PASS (guard failed as required).
- Negative source-contract mutation — remove audit cleanup: PASS (guard failed as required).
- Negative source-contract mutation — hardcode mutation authorization: PASS (guard failed as required).
- Negative source-contract mutation — remove exact staging PR restriction: PASS (guard failed as required).
- Negative source-contract mutation — remove required-gate service-role wiring: PASS (guard failed as required).
- Workflow YAML parse: PASS for both CI and manual staging-integration workflows.
- Full `npm run guards`: PASS, including 50,087 workflow/fault simulations and all migration/RLS/security/source-contract guards.
- Environment hygiene: PASS after documenting `BNN_PRODUCTION_SUPABASE_PROJECT_REF`.
- Version consistency: 177.37.260815 across package/app/SW metadata.

## Required external gates
NOT EXECUTED locally: dependency-backed TypeScript/unit/differential/build and real Supabase staging integration. GitHub/staging remain authoritative.

## Status
NOT DEPLOYABLE until all blocking gates, real staging integration, Vercel staging, PR verify, Production Ready, and smoke test pass.
