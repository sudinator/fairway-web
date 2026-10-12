# Release Verification — 178.10.260828

## Scope
Two P1 scoring correctness fixes only: exact handicap inputs for singles match scoring, and canonical side-handicap inputs for alternate-shot running match scoring. No migration.

## Code changes
1. `components/game/scoring-views.tsx`: singles `matchStatus` now receives `chBasis(...)` for both players.
2. `components/tournaments.tsx`: individual-card `matchProgress` now receives `chBasis(...)`; alternate-shot `matchRun` now derives side handicaps from `altShotSides(...)`.
3. `ci/check_scoring_input_contract.py`: regression guard for both failure modes, wired into `npm run guards`.
4. Version bumped from 178.9.260827 to 178.10.260828 and this release documented.

## Behavior comparison
- Inputs preserved: scores, holes metadata, allowance percentage, course par, player handicap/rating/slope data, pairing/foursome membership.
- Outputs preserved except the intended correction at rounding boundaries: match hole strokes/results now agree with the canonical exact-handicap calculation and with displayed stroke dots.
- Side effects unchanged: no database writes, callbacks, state transitions, score persistence, round posting, betting settlement, or leaderboard algorithms were modified.

## Executed validation in ChatGPT container
PASS: `python3 ci/check_scoring_input_contract.py`
PASS: `python3 ci/check_single_altshot_source.py`
PASS: `python3 ci/check_nine_hole_basis.py`
PASS: `python3 ci/check_single_stroke_allocator.py`

## Blocked validation
`npm ci` repeatedly timed out in the execution environment, leaving an incomplete dependency tree. Consequently `npx tsc --noEmit` stops before project checking with missing type-definition packages (including React/Node), and the full `npm test`, `npm run guards`, `npm run build`, CI, staging integration, and runtime smoke tests could not be completed here. This is an environment/dependency-install failure, not an executed scoring-test failure.

## Release status
**CANDIDATE ONLY — NOT DEPLOYABLE TO PRODUCTION.** Promotion requires the mandatory normal CI/type/test/build/guard/staging gates to pass.

## Additional executed targeted scoring tests (dependency-independent compile)
Because the full dependency tree was unavailable, the pure scoring modules/tests were compiled with the globally installed TypeScript compiler using an empty ambient type root plus a temporary `process.exit` declaration. This does not replace the normal gate, but it executes the scoring assertions themselves:
- PASS `stroke-rounding.test.ts`: 24 passed, 0 failed.
- PASS `alt-shot-scoring.test.ts`: 28 passed, 0 failed.
- PASS `format-rules.test.ts`: 34 passed, 0 failed.
- PASS `hole-result-consistency.test.ts`: 981 passed, 0 failed.

## Guard execution
The guard chain passed through the scoring, migration dependency, RLS, environment, UI/layout, workflow fault simulation (50,087 checks), staging integration source contract, betting atomicity, tee assignment, course provider, extraction, PWA, dashboard, rating/slope correction, setup/create-game, design/palette/overlay/contrast, version, colour matrix, tap-target and shell-geometry checks. `check_test_assertions.py` correctly blocked because the full `npm test` report could not be produced with the incomplete dependency installation.
