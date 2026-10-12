# Release Verification 177.28.260814

Status: STAGING CANDIDATE — NOT DEPLOYABLE.

## Scope
- Restore the historical pre-0017 `create notifications` policy prerequisite in the fresh baseline so migration 0017 can replay from zero.
- Add a semantic historical-migration prerequisite guard covering ALTER POLICY and function-level ALTER/GRANT/REVOKE/DROP dependencies.

## Evidence
- EXECUTED: `python3 ci/check_legacy_migration_prereqs.py` — PASS.
- EXECUTED: `python3 ci/check_db_extension_prereqs.py` — PASS.
- EXECUTED: `python3 ci/check_fresh_db_ci_contract.py` — PASS.
- EXECUTED: `npm run guards` — PASS, including 50,087 workflow-fault simulation checks.
- MODELLED: full static audit found one unresolved pre-existing RLS object dependency in the historical stream: migration 0017 alters `notifications.create notifications`, which baseline 0001 had omitted.
- PENDING: GitHub disposable fresh-database rebuild through the complete migration chain.
- PENDING: dependency-backed TypeScript, unit/differential, lint and Next build in GitHub CI.

## Release gate
Do not apply migrations 0135-0137 to staging or Production until the disposable fresh-database rebuild completes successfully and the post-rebuild core-RLS assertion passes.
