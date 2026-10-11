# Release verification — 177.24.260814

## Scope
- Dashboard putting metric changes from `Putts / hole` to `Putts / round`.
- Whole-round putting trend includes only 18-hole rounds with putts recorded on all 18 holes.
- Partial putting data remains usable by per-hole/other metrics where numerator and denominator are known; no missing putts are inferred.
- Rounds reuses shared post-round stat-completeness logic and shows exact missing hole numbers only for near-complete stat tracking.
- No database migration.

## Behavioral contract
- 18 played holes + 18 putt entries -> eligible for Putts / round.
- 18 played holes + 15–17 putt entries -> excluded from Putts / round and prominently nudged with exact missing holes.
- 18 played holes + <=14 putt entries -> excluded, no prominent putting nudge.
- Partial rounds -> excluded from Putts / round even when every played hole has a putt value; their known hole-level data remains valid for other statistics.
- Fairway completeness ignores par 3s.

## Evidence
- EXECUTED: `npm run guards` — PASS, including 50,087 workflow simulations.
- EXECUTED: `lib/round-stat-completeness.test.ts` — 8/8 PASS.
- EXECUTED: `ci/check_dashboard_putts_round_contract.py` — PASS.
- NOT COMPLETED LOCALLY: full repository `npm test`, `npx tsc --noEmit`, and Next production build because the isolated workspace does not have the installed Node dependency/type tree. These remain mandatory GitHub CI/Vercel staging gates.
- BROWSER-VALIDATED: pending Production data validation after automated staging gates; staging has no representative round history for this metric.

## Release status
Not deployable until GitHub CI, Robustness, Vercel staging build, PR verify, and Production smoke validation pass.
