# BNN 212.106.261114 — scheduler permission-test correction

Status: staging test candidate; native GitHub/Supabase CI, Vercel staging and production release gates remain open. No production-ready claim.

## Problem and correction
The reported CI screenshot shows both stale-game permissions blocks completed and ROLLBACK succeeded, followed by two permission-denied errors on table job. ci/test_daily_stale_concurrency.sh directly updated cron.job once to pause the job and again during cleanup. The local PostgreSQL superuser bypassed that restriction.

Both transitions now use the supported cron.alter_job API. Scheduler restoration runs independently of fixture cleanup, and a final read verifies the original enabled state. A missing API permission fails explicitly before fixtures. No database grants are widened by this correction.

The existing recurrence guard now rejects direct INSERT/UPDATE/DELETE against cron.job in shell/SQL tests, with six canaries including multiline SQL. The previous nine revoked-function-call canaries remain. The exact 212.105 helper is rejected by the guard.

## Executed database and scenario checks
- Full disposable PostgreSQL 17.11 / pg_cron 1.6.5 migration chain: 232 migrations and existing behavioral assertions passed.
- Security contract passed: 137 policies, 46 table grants, 212 privileged functions.
- Full chain concurrency and all five provider-contract harness outcomes passed.
- Restricted-permission reproduction used real PostgreSQL and pg_cron, with a non-superuser test role, SELECT but no UPDATE on provider-owned cron.job, and EXECUTE on the supported scheduler APIs. The old helper reproduced the two permission-denied errors.
- The corrected helper passed real competing-session game/personal-score preservation and overlapping-job rejection under that restricted role.
- Initially enabled and initially disabled scheduler states were restored and verified.
- Injected duplicate fixture setup produced a nonzero test result; cleanup still restored the initially disabled scheduler state.
- The restricted local role requires pg_read_all_settings with inherited membership to read cron.timezone, matching the settings reads already observed passing in the supplied native CI log. This is a local permission-profile simulation, not an exact Supabase runtime.

## Application checks
Full local npm run ci exited 0: scoring-device, recovery and editor scenarios, workflow checks, lint, TypeScript, complete unit/render/differential suite, 171 moving-clock suites, all source/contract guards, real browser update/redirect/recovery/diagnostics checks, charts and the full production compile/static-generation build passed. The assertion gate retained 447,288 assertions across 108 suites; chart checks passed 1,393 assertions across 324 cases. The strict public VAPID-key check ran with the public key already embedded in the worker. No gate was skipped.

## Source and package review
Baseline: fairway-web-212_105_261114.zip (SHA-256 ae2185fd9a8b3b6681fea53f98f998b391e0d391fb054732f9b27b90b7957244).
All numbered migration SQL, including 0234, is unchanged. All app/components/lib source is unchanged except generated lib/app-version.ts. Package dependencies are unchanged. Version metadata and release notes advance to 212.106. No new migration; if 0234 is already installed, no additional SQL is needed.
The full source retains the tee fixes, yellow recovery panel and stale-game handling. Analytics changes are not included. ZIP excludes node_modules, build output, local database/runtime files and credentials.

## Evidence
- analytics-review/212106-chain.log
- analytics-review/212106-cron-runner-profile.log and 212106-final-profile.log
- analytics-review/212106-old-reproduced.log
- analytics-review/212106-restricted-pass.log
- analytics-review/212106-restricted-inactive.log and 212106-inactive-state.txt
- analytics-review/212106-restricted-failure.log and 212106-failure-state.txt
- analytics-review/212106-full-ci.log
- ci/test_daily_stale_concurrency.sh and ci/check_recurrence_guards.py
- Supabase: https://supabase.com/kb/troubleshooting/pgcron-debugging-guide-n1KTaz
- pg_cron: https://github.com/citusdata/pg_cron#altering-a-cron-job

## Remaining release gates
Use the existing staging ZIP workflow to obtain native GitHub/Supabase and other CI results for this exact candidate. Confirm Vercel staging Ready and relevant staging smoke checks before staging-to-main PR/verify and production gates. No GitHub CI, Vercel deployment or production smoke test has been performed by this session. Local Node is 24.22.1; GitHub remains on the repository’s Node 22 setting.
