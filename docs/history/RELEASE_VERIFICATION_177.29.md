# Release Verification 177.29.260814

Status: STAGING CORRECTIVE CANDIDATE — NOT DEPLOYABLE.

## Scope
- Close the migration dependency-audit gap exposed when fresh replay reached `0025_group_roster.sql` and found `is_group_member(uuid,uuid)` missing.
- Restore historical pre-0034 definitions for `is_admin`, `is_group_member`, and `is_group_admin` in the source-controlled baseline, preserving 0034 as the later banned-user hardening transition.
- Expand the prerequisite guard from selected DDL operations to the complete globally ordered migration stream.

## Comprehensive static audit evidence
- EXECUTED: all 135 ordered migrations scanned, not sampled.
- EXECUTED: 43 repo-created relations and 1,086 relation dependency references checked.
- EXECUTED: 134 repo-created functions and 462 function dependency references checked, including calls inside SQL/function bodies.
- EXECUTED: 148 policy dependency operations checked.
- EXECUTED: 98 explicit column-state operations checked statement-by-statement.
- EXECUTED: custom-type dependency scan completed (0 repository-defined custom types in this stream).
- EXECUTED: extension prerequisite contract PASS (`citext` bootstrap; `pg_cron` remains self-declared before use).
- EXECUTED: negative mutation test PASS — removing baseline `is_group_member` makes the guard fail at migration 0025, then restoration returns PASS.
- EXECUTED: `npm run guards` PASS, including 50,087 workflow-fault simulation checks.

## Historical contract conclusion
The static audit found exactly the historical prerequisites already identified by executable replay and deeper analysis: the pre-0017 `create notifications` policy and the pre-0034 auth helpers `is_admin`, `is_group_member`, and `is_group_admin`. They are now reconstructed in `0001_baseline.sql`. No additional use-before-create relation, repository-defined function, policy, explicit-column, custom-type, or extension prerequisite remains in the committed stream under the guard's coverage.

## Remaining mandatory gates
- PENDING: GitHub disposable fresh-Supabase replay of all migrations through 0137.
- PENDING: dependency-backed hook lint, `npx tsc --noEmit`, full unit/differential suite, and Next build in GitHub CI.
- PENDING: after fresh replay passes, apply 0135-0137 to staging in order and require live staging RLS equality to the verified Production baseline.
- PENDING: targeted adjacent application checks and normal staging -> main promotion gates.

Do not apply 0135-0137 to staging or Production until the disposable fresh-database replay passes completely.
