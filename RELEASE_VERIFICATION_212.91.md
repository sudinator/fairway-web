# 212.91.261106 — simpler Clubs, inline engagement and published report

Full-source candidate based on 212.90. No staging, live database or production changes were made here. Not production-release approval.

## Intentional behavior and contract review

- ClubHub has Members and Club settings only. Activity is removed. Existing Home/Players/Admin entry contracts, club permissions and callbacks are unchanged.
- One new local showCourses boolean controls the existing ClubEngagement.compact prop. See courses & participation expands; Hide course details collapses. Both controls toggle the same state, without changing the selected section, refetching merely because of expansion, or altering directory search/filter state. Club context keys reset expansion on switching clubs. Role-specific controls stay intact.
- ClubEngagement retains groupId/now/refreshKey/compact/onDetails inputs, its read-only fetch/abort/retry state and output metric contracts. The details callback is now reachable when expanded as well as compact; its text reflects the current state. Metric inclusion rules, time window, current-member denominator, shared-ball/personal-round counting, course ranking, endpoint authentication and access checks are unchanged.
- The existing ClubLatestReport instance moves into Members above the directory. It stays mounted while Members is hidden in Settings, preserving its loaded snapshot/expansion. No duplicate report is mounted in Settings. Same group ID and showEmpty props; original saved snapshot loader, loading/absent/error/retry and expansion behavior are unchanged. No fabricated report is created. No database writes are added.
- Actual report cadence in lib/club-report.ts and migrations/0195_club_reports.sql is July 1 for January–June and October 1 for July–September. The existing webhook route publishes queued snapshots, even without Gmail configuration; email delivery needs mail configuration and existing recipient settings. No monthly generation or cadence change is implemented. Live pg_cron/webhook/published-data status is UNVERIFIED.

## EXECUTED with MODELLED reads

51 combined-directory checks passed. This extends the prior 44 checks without dropping assertions: no Activity tab; expand/collapse keeps Members selected; search survives Members → Settings → Members; no invented report; report error distinct from absent snapshot; retry displays the actual published period label; actual report view expands; report instance is not duplicated in Settings; club switching resets details. Existing role-write failure/retry, club admin vs member, legacy entry, read-error/deletion guard, delayed response, A → B → A and 1,001-member pagination scenarios remain covered.

Eight actual client component snapshots exercise both roles, both sections and collapsed/expanded details. Four explicit expand/collapse round trips pass. Chromium checks these eight states at 320/390/430px: 24 layout checks pass with no horizontal overflow. Evidence uses modelled data, not live app sessions. Preview contains no published report and clearly labels the sample data.

Full local CI: PASS, process exit 0 (`npm run ci`, Node 22). Includes TypeScript, full unit/differential/source guards, modelled lifecycle failures/retries, actual worker/update browser checks and complete production compile/build. Assertion guard passes: 441,196 assertions across 104 registered suites, none lost. All 167 ticking-clock suites pass. Targeted directory checks: 51/51. Preview controls: six Chromium role/section/expand-collapse round trips pass with no browser errors.

Source/package verification: all 313 SQL files are byte-identical to 212.90; all existing files outside the documented two components, regression test, metadata/release docs and assertion registry are byte-identical. Existing engagement math/server endpoint, report generation/view/loader, membership writes and scoring/updater components are unchanged. Dependency/devDependency versions and package scripts are unchanged. Worker body is byte-identical except version stamp. Package uses the exact prior full-source contents plus current verification records, excludes dependencies/build output/private environments and passes CRC and SHA-256 manifest checks. See release-verification/212.91/package-audit.json.

## External gates NOT executed

GitHub verify, Vercel staging Ready, staging integration and actual phone checks remain pending. On staging check member/admin views, role restrictions, Members/Settings round trips with a search, expand/collapse and club switches, real published/no-report/error states and adjacent score-saving/reloading. Check existing report jobs and the authenticated publishing webhook separately before claiming live reports are being produced. No SQL changed, so no new migration is required. Do not merge production before required gates pass; after a later authorized merge confirm production Ready and run a non-destructive smoke test.
