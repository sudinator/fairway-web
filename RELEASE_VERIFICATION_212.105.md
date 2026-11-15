# Birdie Num Num 212.105.261114 — CI permission-test correction

Locally validated candidate. Hosted GitHub/Supabase and Vercel staging checks remain mandatory; this report does not approve production promotion.

## Diagnosis and evidence
The supplied GitHub screenshot shows `DAILY_STALE_GAMES_PASS`, then a lost server connection at the end of the authenticated-role DO block in `ci/assert-daily-stale-games.sql` (212.104 line 145). Inside that block, line 142 deliberately calls `public.run_daily_stale_games()` after EXECUTE has been revoked from authenticated. The repository already documents this precise unsafe test pattern in HANDOFF.md and `ci/assert-no-app-call-to-revoked.sql` (208.4), and CI remains pinned to Supabase CLI 2.101.0 for hosted-grant compatibility.

Confirmed source defect: the new test violated the existing rule against calling EXECUTE-revoked functions as app roles. Likely server crash mechanism: the documented Supabase supautils defect. The screenshot does not show the expanded database/container diagnostics, so the exact native crash signature has not been independently confirmed. The main behavior scenarios passed before the failure; that alone is not a complete permission-test pass.

## Correction
- Replace the forbidden call with `has_function_privilege(current_user, 'public.run_daily_stale_games(timestamptz)', 'execute')`. Keep real authorized timestamp-tampering attempts and actual admin/member RLS reads.
- Add all seven private stale-maintenance functions to the existing central server-only permission catalogue.
- Extend the existing recurrence guard to reject direct calls to catalogue functions in anon/authenticated SQL sections, including DO blocks. Nine canaries exercise caught-denial calls, anon/multiline calls, unqualified calls, authorized owner calls, role resets, catalogue strings and comments. Dynamic SQL is outside this source guard; database ACL/security-contract checks remain authoritative.
- Run that guard before database startup/replay in both existing fresh-database entry points.
- Update version and release documentation. No application feature changes.

## Behavior and dependency comparison
All migration SQL, including 0234, is byte-identical to 212.104. All application source under app/components/lib is byte-identical except generated lib/app-version.ts. Package dependencies and scripts are unchanged except version metadata. Database grants, policies, function bodies, scheduling rules, scoring and UI behavior are unchanged. The ZIP retains the cumulative 212.104 features, including the tee corrections and yellow recovery panel.

No new migration. If 0234 is already installed, no additional SQL is needed for this correction.

## Executed validation
- Actual 212.104 failing call reintroduced temporarily: the new recurrence guard failed with the expected server-only call diagnostic. Restored correction: guard passed.
- Nine scanner canaries passed. Shell syntax, version ledger and migration manifest passed.
- Full disposable UTF-8 PostgreSQL 17.11 + pg_cron 1.6.5 replay: 232 migrations, all existing and new SQL assertions, actual competing-session maintenance concurrency, and all five external-provider contract harness outcomes passed.
- Security contract passed: 137 policies, 46 table grants, 212 privileged functions. Actual authenticated timestamp guards and admin/member job-history RLS passed. UTC stale-game scenarios passed separately.
- Initial local database setup used SQL_ASCII and stopped on an existing Unicode fixture. Recreated the disposable cluster as UTF-8; no source/test changes were made for that environment issue.
- Local application chain passed lint, TypeScript, complete unit/render/differential suites, 171 moving-clock suites and setup-navigation/lifecycle gates before stopping at missing Playwright default Chromium path. Pointed that path to the existing Chromium binary; repeated all guards and the browser/chart/build stages. All repeated guards, real browser suites and chart checks passed (1,393 assertions / 324 cases). The first build precheck required the configured public VAPID key; reran with the public key already embedded in public/sw.js, and the strict key check plus full production compile/TypeScript/static-generation build passed. No gate was bypassed. Unit assertion ledger: 447,288 assertions across 108 suites.
- Local Node runtime: 24.22.1; GitHub uses the repository's Node 22 setting. Native GitHub/Supabase confirmation remains required.

## Source and execution references
- Baseline: fairway-web-212_104_261114.zip, SHA-256 84ae7dad3b9110fca9af3b4867c2e644813c34542a0196d5c3791de812eae3ae.
- `ci/assert-daily-stale-games.sql`, `ci/assert-no-app-call-to-revoked.sql`, `ci/check_recurrence_guards.py`, `ci/test_fresh_db_local.sh`, `ci/test_fresh_db_rebuild.sh`.
- `/workspace/scratch/02068af8b213/analytics-review/212105-ci.log`.
- `/workspace/scratch/02068af8b213/analytics-review/212105-browser-build.log`.
- `/workspace/scratch/02068af8b213/analytics-review/212105-build.log`.
- `/workspace/scratch/02068af8b213/analytics-review/212105-database-utf8.log`.
- `/workspace/scratch/02068af8b213/analytics-review/212105-database-utc.log`.

## Outstanding gates
A fresh native GitHub database lane must confirm the correction on the Supabase image that failed. Confirm other GitHub lanes and Vercel staging Ready, then relevant staging smoke checks before staging-to-main PR/verify and production gates. No production tests or deployments were performed. Analytics review is paused; no analytics changes are included.
