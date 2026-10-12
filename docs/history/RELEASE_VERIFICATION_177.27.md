# Release verification — 177.27.260814

Status: STAGING CORRECTIVE CANDIDATE — NOT DEPLOYABLE.

## Change under test
GitHub fresh-database CI reached the correctly ordered `0001_baseline.sql` and failed because the historical baseline uses the `citext` type before the repository declares the extension. This release makes that prerequisite explicit without rewriting historical migrations.

## Evidence
- EXECUTED: repository extension dependency inventory found only `citext` and `pg_cron` extension declarations in the migration stream.
- EXECUTED: `citext` is used by migration `0001` before its historical `CREATE EXTENSION` in `0038`; it is therefore required in the fresh-DB bootstrap.
- EXECUTED: `pg_cron` is created in `0074` before the first `cron.*` use; no pre-0001 bootstrap dependency is required.
- EXECUTED: `ci/check_db_extension_prereqs.py` validates actual numeric migration order and extension availability.
- EXECUTED: source/guard suite must pass before packaging.
- PENDING: GitHub disposable fresh-Supabase reconstruction through the entire migration stream.
- PENDING: dependency-backed hook lint, TypeScript, tests and Next build in GitHub CI.
- PENDING: staging database application of 0135-0137; do not apply before fresh-DB PASS.

## Release gate
Do not promote or apply database migrations until GitHub CI completes the disposable fresh-database rebuild successfully and all normal BNN gates are green.
