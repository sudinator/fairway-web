# Release Verification 177.38.260815

## Scope
Single-bug corrective for the 177.37 staging integration PR gate. No application behavior, migration, RLS policy, grant, schema, integration scenario, cleanup behavior, or Production database change.

## Root cause
`ci/integration/staging.mjs` bound `BNN_STAGING_SUPABASE_URL` to a local constant named `URL`, then called `new URL(URL)`. The local string shadowed Node's global `URL` constructor, causing `TypeError: URL is not a constructor` before the staging harness touched Supabase.

## Fix
- Rename the local binding to `STAGING_URL` and update its direct references.
- Extend `ci/check_integration_contract.py` to require the safe binding and reject the shadowing pattern permanently.

## Executed locally
- `node --check ci/integration/staging.mjs`: PASS.
- `python3 -m py_compile ci/check_integration_contract.py`: PASS.
- `python3 ci/check_integration_contract.py`: PASS.
- Focused runtime path with a temporary Supabase client stub: PASS — a non-Production HTTPS URL proceeds past URL parsing and reaches the deliberate post-parse sentinel; no `URL is not a constructor` error.
- Production project refusal with the same stub: PASS — refusal occurs before client use.
- Version metadata consistency: 177.38.260815.

## Required external gates
Real Supabase staging integration is still authoritative and was not executed locally. Full dependency-backed TypeScript/unit/differential/build and normal release gates remain required.

## Status
NOT DEPLOYABLE until all blocking gates pass.
