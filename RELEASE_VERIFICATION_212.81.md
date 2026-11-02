# 212.81.261101 — recap statistic corrections

Status: clean final npm run ci PASS; ready for staging/GitHub review. No production deployment or database writes performed.

## Verified actual incident
Source: user-provided production export for 947286, exported_at 2026-11-01T23:13:15.652644+00:00. Complete fairway/putt cards: Amit 5/14 and 37 putts; Ankur 6/14 and 39; Ashutosh 8/14 and 34; Sanjay 3/14 and 43. PJ, Probir, Rahul and Rajat have no entered fairway/putt data and are excluded from those comparisons. The export has four complete stat cards. All eight posted rounds match the game stroke/putt/fairway arrays.

Fairway winner is Ashutosh 8 of 14; putting winner is Ashutosh 34. Gross/net/Stableford results, all non-stat highlights, outcome signature and personal results remain unchanged. Eight finishers; Probir 37 points, PJ 35, Rajat 32; field net 75.0; out 37.25/in 37.75; gross distribution 4 birdies,31 pars,60 bogeys,49 doubles+; net 23 birdies/3 eagles; most pars-or-better Probir 11; five pars on holes7-11; PJ birdie4 after double3; Group2 net73.0; hardest9 average6.125; easiest10 average4.625; corrected handicap field gap4.3 and standouts Probir5.4/PJ3.4; three sixes PJ13/Probir14/Ankur+Probir13. Scoring timestamp window262minutes, not measured tee-to-putt duration.

## Fixes
- Canonical string fairway results and scheduled eligible-hole completeness; no Boolean hit comparison or manufactured zero from missing data.
- Putts restricted to scheduled holes and valid nonnegative integers; extra array slots cannot qualify missing holes. Explicit zero remains valid.
- Bounce-back descriptions preserve each player's actual holes and birdie/eagle/preceding double/triple score, avoiding shared incorrect hole attribution.
- Accurate best-hole score labels, par-or-better streak label, birdies+ aggregation label and scoring-window wording.
- App net-birdie/eagle positions preserve ties; email keeps every player tied at fifth-place cutoff.
- Production-shaped string fixtures and sanitized-UUID real incident regression. No score/profile/history mutation or migration.

## Executed validation
- Clean final npm run ci exit0 on Node22: lint, typecheck, device/editor/recovery checks, unit/render suite, changing-clock runner, lifecycle/source/style guards, gallery overflow, two-tab update browser test, production build.
- 440,445 assertions across98 reported suites; 59 new recap-stat assertions. 162 suites also pass changing-clock execution.
- Actual app/email/share rendering checked, exact winners/counts, malformed/missing/zero stats, trailing array slots, bounce-back variations and tie cutoff regression.
- Corrected incident rendered and visually reviewed at390px; internal screenshots not included.
- All231 SQL migration files unchanged. Full source package retains212.80 update fixes.
Evidence: release-verification/212.81/local-ci.log and unit-render.log.

## Stale-game investigation — no policy change shipped
The committed0106 sweep excludes test clubs and games created more than30days ago. Any partially scored member prevents completion; empty games do not qualify. Fully scored games wait until Eastern midnight after first observed completion(scored_at). The Home screen invokes it opportunistically, throttled hourly; committed code does not schedule it in cron. The separate0083 personal-round rule requires18 scores after24hours. There is no blanket24–48hour partial-game completion rule in the reviewed source; no later overriding agreement was retrieved.
Legacy game eligibility reads member score arrays, not modern shared-ball score rows; it also does not evaluate guests/no-show treatment comprehensively. Do not schedule or broaden this old rule without live classification and behavioral/security tests.
EXECUTED exact0106 function on an isolated MODELLED PostgreSQL schema with posting stubbed: one eligible fully scored case ended; partial, empty, test-club, over30day and first-observed-now cases stayed active. This is not live staging/full-security-chain proof. See stale-rule-proof.json.
Run diagnostics/staging-stale-games.sql in STAGING and return its one-row CSV. It reads each old game's reason, actual deployed definitions, sweep timestamps and matching cron job metadata. It never calls a sweep or ends/posts/deletes games. SQL executed against a disposable fixture. Cannot assign causes to the actual20+ staging games until their export is available.

## Remaining external checks
GitHub branch parity/CI and staging integration. Actual production947286 displays corrected figures only after deploying/loading this code; reopening the recap recalculates without data repair. Historical emails/images stay unchanged. Personal-best badges require historical-round evidence not present in this export; their implementation was not changed or signed off by this audit.

## Delivery
Full source ZIP fairway-web-212_81_261101.zip. No obsolete-file cleanup, DB migration or automatic completion change. Stale-game diagnostic is included for the next investigation step. No dependencies, environments, build/test caches or internal screenshots packaged.
