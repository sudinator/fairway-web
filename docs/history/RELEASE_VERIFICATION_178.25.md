# Release Verification — 178.25.260830

## Scope
CI-only hardening of the live production migration-parity check after the production PR returned HTTP 404 / PGRST125 `Invalid path specified`.

## Root cause in current code
`ci/check_live_migration_parity.mjs` appended `/rest/v1/schema_migrations...` directly to the configured secret. That only works when the secret is a bare project base URL. A copied REST endpoint therefore creates a duplicate/invalid PostgREST path.

## Behavior change
The checker now canonicalizes a base URL or `/rest/v1` URL to the project origin before constructing the ledger endpoint. Unrelated URL paths fail early with a configuration-specific message.

## Preserved contracts
- same production/staging secret names
- same service-role authentication
- same committed migration inventory
- same ledger comparison
- same fail-closed behavior
- no app runtime change
- no schema or migration change

## Release gate
See command evidence from the 178.25 validation run. GitHub PR CI and Vercel staging must still pass after this patch before merge.
