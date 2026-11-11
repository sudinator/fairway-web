# 212.97 — touch tooltip and CI interaction correction (candidate)

Baseline: full 212.96.261109 source. This is an incremental correction; 20% recent-form behavior and all independent CI lanes remain.

## Root-cause evidence and scope

The reported GitHub charts failure is `profile touch next point reopens`. The original flow also fails in a slower-browser replay. Event/geometry inspection found that raw coordinate taps could hit HTML outside the viewport after tooltip-close scrolling. Replacing sleeps alone did not resolve all failures: the shared held-dismissal tooltip defaulted to Recharts hover interactions, which could disappear after a touch tap. Recharts records click and hover interaction states separately. Touch input now selects click mode; mouse input returns to hover mode. The close control still suppresses the tooltip until deliberate re-entry.

The shared default ChartTip markup, formatter, close event and non-held dashboard remount behavior are preserved. DismissableChart receives the same height/margin/children/holdDismissed props. New internal state records only tooltip trigger mode; outputs are context settings and rendered tooltip visibility. Pointer handlers update only suppression/trigger state; no data/API/persistence callbacks exist. Chart inputs, plotted values, axes, ranges and recent-form calculations remain unchanged. Existing explicit caller props have no trigger overrides in current callers.

CI fixtures now identify committed renders before interactions. Locator taps wait for stable positioning and re-scroll the element; assertions wait for actual visibility, verify different-point payloads and exercise touch→mouse→touch without unmounting. No failed interaction is made to pass by repeating a tap, dropping a case or disabling an assertion.

## Executed and pending validation

Focused EXECUTED browser reproduction with MODELLED data: original flow fails; corrected shared component/test flow passes mouse and touch interactions at CPU throttling rates 1, 4 and 8. Final complete local npm run ci: PASS (exit 0), Node 22.23.4. Hook lint, npx tsc --noEmit, full unit/differential/scenario suite, all 170 moving-clock suites, navigation/source/security/lifecycle/style/version guards, update/worker regressions, chart browser suite and a complete production build passed. The assertion ratchet remains 447,223 across 107 registered suites with none removed. Chart browser validation reports 1,393 assertions across the original 324 data/viewport cases and all 15 dashboard selectors, plus explicit next-point payload and profile/admin mixed-input close/re-entry checks. Focused slowdown validation passes 674 checks across rates 1/4/8. These are actual component executions with modelled read-only input, not physical-phone or live-staging proof.

Phone updating is not claimed fixed: current installed code reports 212.95; the user supplied staging metadata for 212.96/build 0d002fec2ba4c77c211e9d88207783771fea4b15. An unauthenticated external staging metadata request redirects to Vercel login. This is environment evidence, not proof of the phone's cause. Await installed Latest version/status and cold-open/origin/authentication confirmation. No updater policy, banner, version-fetch, score storage or service-worker behavior change is included beyond generated version metadata.

External GitHub CI, fresh-database reconstruction, live staging parity/integration, Vercel staging and physical iPhone/PWA gates remain pending. No production mutation or deployment has been performed. This candidate is not approved for production.

## Detailed diagnostic evidence

The unmodified interaction flow failed in a normal/slower-browser replay. A diagnostic run of the raw second-tap path recorded a pointer target of HTML, with the intended chart beyond the 1,100px viewport after close-control scrolling. Increasing the wait to three seconds alone still failed. Touch-specific click mode fixed the independent hover/tap state problem. Hybrid tests also ensure that approaching or pressing the tooltip close control does not switch interaction modes underneath that control; axis labels do not unsuppress an old point. Mouse hover/close/re-entry assertions from the original suite are retained. No automatic interaction retries were added.

The authoring runtime's default Playwright cache path changed to /home/agent. Its initially missing local browser path was provisioned outside the repository, and the entire local CI chain was rerun successfully afterward. GitHub still installs its own headless browser; no production browser-discovery or test-skipping workaround was introduced.

## Source/package review

All existing updater modules, worker behavior (apart from generated version), API routes, SQL, golf/statistics helpers, recent-form helper and CI job graph remain byte-identical to 212.96. Only the held-tooltip interaction controller, browser fixture/readiness/actions, version metadata and release documentation change. Default ChartTip markup remains identical under the historical differential tests; existing explicit tooltip trigger props remain supported. No migration, dependency update, score write or authentication change is included.

Full-source ZIP: 1,301 files, including all 313 SQL files. Every source entry from 212.96 remains; this release adds only this verification record. Dependencies, caches, private environments, test outputs, local diagnostic tools and logs are excluded. Per-entry byte/hash comparison and archive CRC validation run during packaging.
