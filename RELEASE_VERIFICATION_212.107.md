# BNN 212.107.261114 — analytics cleanup

Status: all required local validation passed; candidate for native staging validation. Native GitHub/Supabase CI, Vercel staging build/feature checks and the existing production data-profile review remain open. No production-ready claim; no deployment or production write performed.

## Baseline and scope

The owner confirmed green GitHub CI for 212.106. Baseline source is fairway-web-212_106_261114.zip, SHA-256 a1eb261d029d0504e0294e5f0b6cf65b032f78a62296c062b3e871e917349ff9. All approved analytics cleanups are implemented inside the existing screens and readers; ANALYTICS_212.107.md maps every intentional behavior difference and data definition. Old source/migration comparisons use this exact baseline.

## Validation record

Final clean `npm run ci` exited 0. No required local gate was skipped or weakened.

| Gate | Executed result |
|---|---|
| Code/contract consistency | Reviewed against exact 212.106 baseline; intentional differences mapped in ANALYTICS_212.107.md |
| Hooks lint and TypeScript | Passed, including `npx tsc --noEmit` |
| Complete unit/render/differential suite | 447,336 counted assertions across 110 suites; none removed |
| Moving-clock regression | All 172 suites passed; four adjacent async suites also passed an independent repeat |
| Source/security/guard checks | Full existing guard lane passed, including version, migration immutability, permissions, CI lanes and gallery overflow |
| Chart/browser differential checks | 1,393 assertions across 324 data/viewport cases passed |
| New analytics browser scenarios | 50 assertions passed against real components and synthetic read-only RPC responses |
| Full production build | Optimized compile, TypeScript, static generation and route build passed |
| Full disposable DB migration chain | All 233 migrations replayed, all registered SQL assertions and new analytics/cohort cases passed |
| Database security contract | RLS, 138 policies, 47 table grants, 216 privileged functions matched reviewed snapshot |
| Actual daily-cleanup concurrency | Competing score writes preserved; overlapping maintenance rejected |
| Provider contracts | All five success/quota/drift/ledger-failure/freshness outcomes passed |
| Visual review | 63 gallery screens photographed; actual before/after analytics renders inspected at phone width; browser widths 320/390/430/768 passed |
| Hosted CI / Vercel / production data profile | Pending external gates; no production approval |

Exploratory validation failures were corrected or rechecked before packaging. An intermediate moving-clock run overlapped local generation of test output and reported four adjacent suites failing without diagnostics; the final clean build passed every moving-clock suite, and those four also passed independently. Overlapping output generation is the inferred explanation, not a proven application defect; no unrelated application behavior or test requirement was changed to clear it.

## Simulation and regression coverage

- Normal/edge/invalid: known, missing and manual-zero handicaps; complete 9/18 cards; sparse/zero/negative putting; provisional/established index histories; tied records, including two rounds on the same played date; no false record email/recap; stretch-versus-rest arithmetic; sparse per-stat evidence; unsupported benchmark indexes; bounded AI scope/coverage.
- State transitions: course/tee/length/window intersections and A/B/A; changing course clears tee; existing Insights opens record observations; daily/admin panels fail visibly and recover; the shared drill retries without cross-query data.
- Retry/failure/re-entry: same-scope successful data retained with warning; new scope clears old figures; out-of-order responses, empty payloads, deadlines and unmounts cannot commit stale data. Observation retry IDs are deduplicated, while separate uses count separately.
- Real disposable SQL: eligible/ineligible/Test/future/empty/no-show/shared participation; unchanged historical denominator after draft deletion; mature signup and return windows; deactivation; event spoof/ownership/ACL/RLS; reminder resume/completion; archive metadata and parent-group cascade safety; push summary/drill agreement.
- Adjacent full-chain scenarios: account signup/merge/removal, isolation, player/organizer permissions, manual/nine-hole posting, canonical shared-ball scores, financial/contest preservation, daily maintenance concurrency and all provider-contract outcomes. Existing pure scoring differential tests remain mandatory.
- UI: real 212.106 before-renders and real 212.107 after-renders from identical synthetic read-only fixtures; Dashboard, admin, Insights, personal bests, daily, engagement, power users, devices and Operations photographed at phone width. Browser scenarios cover 320/390/430/768px. Gallery entries reuse real components; no fabricated before screenshot or live production data.

## Contract/consistency review

Existing Dashboard props/callbacks, AI output schema, admin RPC signatures and power-user columns are preserved. Added inputs are local scope/evidence, bounded event metadata and an enabled flag on the shared read hook. Side effects are limited to feature observations, aggregate lifecycle provenance and retained event metadata. No scoring, handicap arithmetic, posting, tee-selection, bets or scheduler implementation is rewritten. The card's trend and round three-putt statistic intentionally change as documented. Existing differential baselines are retained; only tests asserting intentionally corrected provisional-trend semantics are updated, with a new established-improvement case.

Security snapshot changes are reviewed: one admin-read-only lifecycle policy, one authenticated SELECT table grant, three private analytical SECURITY DEFINER functions and one authenticated event RPC. No anon permission is added. Existing admin push reader ACLs remain unchanged. Private helpers pin search_path; event insertion derives the actor and rejects direct analytics-action forgery.

All 219 pre-existing numbered files in migrations/ compare byte-identically with 212.106; the replay also includes historical baseline files, giving 233 total migrations after adding 0235. Package dependencies are unchanged. Package/lockfile/worker/app-version metadata agree. Release documentation, schema, test plan, gallery and backlog are updated.

## Environment and limits

Local execution uses Node 24.22.1, PostgreSQL 17.11 with pg_cron 1.6.5, the repository's disposable Supabase shim and real headless Chromium. Native CI specifies Node 22 and Supabase; local checks do not prove identical hosted permissions/runtime behavior. No GitHub connection is available here. The ZIP workflow remains the handoff for native validation; it is not production approval.

Lifecycle counts start with games present at installation and subsequent games, including later deletions. Earlier deletions cannot be reconstructed. Feature observations start with this release; 28-day returns need a mature cohort. No causal reminder/feature effect is asserted. Fixture-scale SQL checks do not substitute for production data-shape/performance review. Before shipping the statistics change, retain the existing HANDOFF gate to review docs/sql/data_profile.sql from production. Then follow staging → green native CI/Vercel → required feature checks → staging-to-main PR/verify → Ready production → non-destructive smoke test.

## Evidence locations

Authoring evidence: /workspace/scratch/02068af8b213/analytics107-evidence. Final CI/database logs, targeted tests and phone renders are retained there. Browser responses and provider-contract HTTP responses are explicitly synthetic; actual application components, PostgreSQL queries, RLS and concurrency behavior execute normally. The full source ZIP excludes dependencies, builds, test output, local database/runtime files, credentials and browser screenshots.
