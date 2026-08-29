# Release Verification — 178.12.260829

## Scope
Alternate Shot scoring-integration hardening on top of 178.11. No database migration.

## Root causes fixed
1. `FourballView` was shared for Four-Ball, Trifecta, and Alternate Shot, but its non-Trifecta result path still unconditionally called Four-Ball best-ball scoring. Alternate Shot therefore had correct dedicated helpers in lib while the main Results surface could still calculate a different match.
2. Alternate Shot duplicated one side score onto both partner rows for persistence, but the production read path did not consume the existing `sideScore()` conflict detector. A partial/different partner-row state could therefore be scored silently.
3. Exact half-stroke side differences could land infinitesimally below `.5` in binary floating point and `Math.round` could round the match allowance down by one.

## Behavior change
- Four-Ball and Trifecta retain their existing scoring engines and shared shell.
- Alternate Shot retains the shared foursome/setup/UI infrastructure but uses only the dedicated Alternate Shot scorer for results, hole detail, running score, dots, and team rollup.
- Conflicting duplicated partner rows pause the affected hole and block group/game finalization until repaired.
- Half-up match-stroke rounding is stabilized against floating-point noise.

## Executed validation in build environment
- Alternate Shot example tests: 73/73 PASS.
- Alternate Shot scoring tests: 30/30 PASS.
- Alternate Shot duplicated-row tests: 49/49 PASS.
- Permanent deterministic Alternate Shot simulation: 178,103 assertions across 5,000 matches PASS.
- One-off deep randomized Alternate Shot simulation: 3,472,535 assertions across 100,000 matches PASS. Includes 10,000 injected partner-row conflicts, 100,000 edit/revert cycles, 9/18-hole games, plus handicaps, custom allowances, incomplete holes, and 44,796 multi-stroke cases.
- Exhaustive side-handicap boundary matrix: 1,320,980 combinations PASS against exact rational half-up oracle.
- Adjacent scoring suites: create-game alt-shot 12/12; format rules 34/34; hole-result consistency 981/981; scoring matrix 3,698/3,698; all allocators 253/253; match length 46/46 PASS.
- `ci/check_altshot_view_contract.py`: PASS.

## Remaining release gates
This environment still lacks a complete installed Node dependency tree, so full `npm run ci`, Next build, and real staging Supabase integration must run in GitHub/staging. Do not promote to production until those gates and targeted staging Alternate Shot runtime testing pass.
