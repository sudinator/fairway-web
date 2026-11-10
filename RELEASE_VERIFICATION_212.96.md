# 212.96 — recent-form charts and initial CI optimisation (candidate)

Baseline: full 212.95.261107 source. Candidate 212.96.261109, November 9, 2026.

## Contract review

Dashboard props, closure/state inputs, range selection, existing stat eligibility and per-round calculations remain. Round metadata and existing tooltip dismissal flow remain. New shared recent-form helper is pure, receives recorded values and optional hit/total counts, and returns display-only values. It has no callbacks, writes, network requests or mutation. No score, handicap or game-result calculation uses the helper.

Intentional display changes: all dashboard performance histories use prominent green/red round markers and one cream 20%-weighted recent-form line, with gold pooled overall-average reference. The headline remains the latest five eligible observations (or fewer with an explicit count). Comparisons need ten observations and use two disjoint groups of five. The old single-first-round comparison is removed. Rate statistics pool hits/opportunities for headline/reference and decay both counts for the trend. Consequently the effective influence of a rate observation also depends on its denominator; this is not an equal 20% weight on every round percentage. Missing data never ages the trend or becomes zero. Existing score-vs-par views behind Rounds/Best retain their labels and per-round source. Other chart families, including player cards, season stories and admin participation, retain their own calculations.

Renderer dependencies: existing Recharts axes/date ticks, reference/domain rules, shared tooltip and dismissal frame, golf/stat completeness helpers. Selected marker highlighting and tooltip baseline/opportunity context are display-only. Only the dashboard renderer and the new helper change application behaviour.

CI retains the full local command chain and every existing unit, differential, ticking-clock, browser, source/security/lifecycle guard and build. Four separate runner jobs execute database reconstruction/parity, application checks, chart tests and build independently. Final verify runs even after failed/skipped dependencies and explicitly checks every required result. Staging-to-main PRs still require real staging integration after all four lanes; automated/manual mutation jobs share concurrency without cancelling running cleanup. Production parity/security remain unchanged and restricted to trusted main pushes. Headless-only installation matches the audited default Chromium launch calls (no headed/channel launch). Existing Node 22, pinned Supabase 2.101.0 and database image cache remain.

## Validation status

Targeted executed checks: chart-trend 5,514 assertions; CI workflow 6,270 checks including every combination of five result states across five jobs with both staging requirements (6,250 combinations); browser chart suite 1,382 assertions across 324 fixture/viewport cases and all 15 selectors. Final complete local npm run ci: PASS (exit 0), Node 22.23.4. Hook lint, npx tsc --noEmit, the full unit suite and differential/scenario coverage, all 170 moving-clock suites, setup navigation, all source/security/lifecycle/style/version guards, worker/update regressions, chart browser tests and a full production build passed. The assertion ratchet confirms 447,223 assertions across 107 registered suites, none lost. The first build attempt exposed an authoring-only dependency-directory symlink restriction in Turbopack; replacing that link with a real local dependency directory resolved it. No application workaround was introduced; the entire local CI chain was then rerun successfully on the final code/workflow.

Browser inputs are MODELLED, read-only fixtures; actual React/Recharts code executes in Chromium. No live database or membership messages are used. Scenario checks include empty/single/short/flat/zero/100%/signed/dense histories, invalid/missing observations, unequal rate denominators, outlier/edit propagation, 5/20/Season/All range logic and All-to-5-to-All rendering, selected marker, tooltip close/reopen and unchanged surrounding chart families. Mathematical differential checks compare the EWMA recursion to an independent closed-form oracle; existing historical domain/rolling/tooltip comparisons remain.

## External gates — not executed here

No Docker/Supabase CLI is available in this authoring environment, so fresh database execution is pending in GitHub. GitHub workflow execution/timings, live staging parity/integration, Vercel staging Ready and physical iPhone/Safari/PWA checks remain pending. No production tests or deployment were run. This is not a production-deployable release until those mandatory gates pass. No database migration is introduced.

## CI performance follow-up

Per-lane JSON timing artifacts record elapsed check time, commit, attempt and Node version. They do not include setup/queue time; measure those from GitHub job timelines. Run three warm and one cold run on the same commit before claiming a saving. Roughly three minutes is an engineering target; initial independent lanes do not prove that target. Keep full coverage during subsequent bounded-worker/readiness/cache work listed in BACKLOG.md.

## Final source and package review

Every pre-existing per-round stat calculation and higher/lower direction mapping is unchanged. All SQL migration/security files and API routes are byte-identical to 212.95. Locked dependency records are unchanged; package metadata advances to 212.96.261109. The database lane retains npm ci because its freshness harness compiles actual app helpers; a mutation test prevents accidentally dropping those dependencies. Existing app test commands are all retained.

A pre-existing dashboard range-selector test now clicks the exact button instead of matching arbitrary text; new Last 5 summary text otherwise intercepted its simulated click. Its original assertions and counts are retained. Historical domain/withRolling/default-tooltip differential tests remain unchanged. No guard was disabled or baseline assertion reduced.

The full-source archive contains 1,300 files including 313 SQL files. It preserves every source entry from the 212.95 archive and adds only the new trend helper/tests, CI gate/timing/contract files and this verification record. It excludes dependency folders, caches, generated test output, private environment files, local tools and logs. Only the existing .env.example is included. Archive CRC and per-entry byte/hash comparisons are executed during packaging; the external package-audit JSON records its checksum.

GitHub fresh-database execution, workflow behavior/timings, live staging integration, Vercel staging and physical phone gates remain pending. This candidate is not approved for production deployment.
