# Birdie Num Num 212.104.261114 — verification

Status: locally validated candidate; staging and production release gates remain open.

## Behavior
- One server-only daily job, 4 a.m. America/New_York, using pg_cron. The same job adjusts its schedule across daylight saving without changing other jobs’ timezone.
- Empty games expire seven Eastern calendar days after the later of creation or scheduled game date. Future games and Test clubs are excluded. Meaningful scores/stats and financial/history dependencies prevent empty deletion. Linked Cup sessions survive with their game reference cleared.
- Fully scored games become eligible after 24 hours without scoring changes. Existing posting, date and handicap contracts are reused. Fully scored personal rounds also finalize; personal rounds are never deleted by this job.
- Partial games trigger one organizer review notification after 48 hours without scoring changes; scores remain intact. New scoring resets that review state.
- Existing unfinished scored cards receive an installation-time inactivity baseline because their historical scoring times were not reliably recorded. This creates an initial 24/48-hour grace period; empty-game expiry still uses creation/game dates.
- Existing Operations UI shows schedule and latest results. Browser-open maintenance calls are removed. Local recovery clears only acknowledged, finalized server cards after successful reads; pending/offline drafts remain.
- Includes prior 212.102 tee fixes and 212.103 yellow recovery panel consolidation.

## Validation completed
- Full npm run ci passed: lint, TypeScript, unit/render/differential tests, guard/source contracts, browser recovery/offline/update/redirect checks, diagnostics checks, charts and production build.
- Assertion gate: 447,288 assertions across 108 suites; 171 moving-clock suites. Chart checks: 1,393 assertions across 324 cases.
- Added 15 recovery reconciliation assertions and 9 Operations rendering assertions. Existing 58 recovery and 161 tee assertions retained.
- Real disposable PostgreSQL 17.11 with pg_cron 1.6.5: all 232 migration-chain steps and existing rebuild assertions passed. The harness uses the repository’s Supabase compatibility shim; hosted Supabase CI remains an external gate.
- SQL scenarios: seven-day boundary, later date, future/Test exclusion, full nine/eighteen, guests, no-shows, optional zero-putt stats, scramble/alternate-shot sides, partial cards, notification retry, changed scores versus optional stats, personal card length, injected posting failure and transactional rollback, same-day deduplication, daylight-saving transitions, UTC/Eastern behavior.
- Real competing database sessions: canonical game lock 163 and personal save lock 159 protect concurrent corrections; global job lock prevents overlap. Test cleanup restores the scheduler’s original enabled state; final readback was true.
- RLS/grants checked against the fully migrated database: 137 policies, 46 table grants, 212 privileged function contracts. Public-table manifest exactly matches 61 tables. Ordinary members cannot read job history, execute maintenance, or spoof server-maintained timestamps; admin read behavior verified.
- Older migrations remain byte-identical to 212.103. Version metadata is consistent; package dependencies unchanged. Source ZIP excludes runtime dependencies, build products, local database/runtime files and credentials.

## Evidence files
Application: stale-work/release-application-ci.log
Database chain: stale-work/release-verified-db.log
UTC scenarios: stale-work/release-utc.log
Scheduler readback: stale-work/release-job-active.txt
Source tests: ci/assert-daily-stale-games.sql, ci/test_daily_stale_concurrency.sh, ci/test-stale-round-reconcile.cjs, ci/test-stale-ops.cjs
Implementation: migrations/0234_daily_stale_games.sql, components/home.tsx, components/manage.tsx

## Remaining release gates
1. Apply migration 0234 on staging and run hosted GitHub/native Supabase CI.
2. Confirm Vercel staging build Ready; validate recovery, game posting, organizer notification and Operations display on staging, including phone layout.
3. Observe a real scheduled 4 a.m. Eastern run and inspect job/run history using the read-only queries in README.md.
4. Follow staging-to-main PR/verify workflow. Confirm Production Ready and perform a small non-destructive smoke test. No destructive production tests are authorized by this report.

No external CI, Vercel deployment or live scheduler execution is claimed here.

Baseline source ZIP SHA-256: 601a09b6b2022666e1c0b22b4f399335c69477c784bbb1f7cfa7ccf5b24fc862.
