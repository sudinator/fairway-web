# Release Verification 177.39.260815

## Scope
Code-only historical-round correction: edit a recorded round's stored course rating/slope and recalculate its course handicap/differential history without altering the course library or original game result.

## Contract inventory
### Inputs
- Recorded `Round`: `rating`, `slope`, `handicap_index`, `course_par`, `course_handicap`, `gross_score`, `game_id`, `status`, and holes.
- User-entered historical Course rating / Slope strings in `RoundEditor`.

### Outputs / side effects
- One `rounds` UPDATE writes `rating`, `slope`, and recalculated `course_handicap` together with the existing final/date fields.
- `course_handicap` is derived only from the handicap index stored on that historical round; current profile handicap is never read/borrowed.
- `onSaved -> loadRounds()` remains the downstream refresh path; existing `roundDifferential()` / `runningHandicap()` recompute the displayed history.
- Gross-only metadata corrections preserve `gross_score` and do not create hole detail.
- Final-round Cancel exits without a destructive round delete.

### Preserved boundaries
- No database migration.
- No `games` or `game_players` write from Round Editor; correcting a game-posted personal round does not rewrite the game result/bets.
- No automatic course-library propagation. The separate `Save course` path continues to use the original round snapshot and still requires its existing correction workflow.
- In-progress round creation/resume remains separate; historical controls render only for an existing non-`in_progress` round.

## Executed validation
- `npm run guards`: PASS, including migration/RLS/security/source-contract guards, 50,087 workflow/fault simulations, UI guards, extraction checks, and the new historical correction contract.
- New historical correction source contract: PASS (13 checks).
- Negative contract mutation: PASS — changing the recorded-round rating write back to `round.rating` makes the guard fail.
- Targeted golf logic compile/run: PASS 53 / FAIL 0. New cases cover recalculated CH from stored index, refreshed per-hole stroke allocation, changed differential, no-index/null-CH behavior, gross-only correction, partial-round eligibility, and preserved game linkage.
- TypeScript syntax/transpile check for `components/round-editor.tsx`, `lib/golf.ts`, and `lib/golf.test.ts`: PASS.
- Advisory unused-symbol ratchet reports `round-editor.tsx` debt improved 24 -> 21; non-blocking by policy.

## Environment-limited validation
The container's dependency install (`npm ci --prefer-offline --no-audit --no-fund`) timed out, and the bundled `node_modules` type-definition directories are incomplete. Therefore the following are **not claimed locally** and remain required in GitHub staging CI:
- `npm run lint:hooks`
- `npx tsc --noEmit`
- full `npm test`
- `npm run build`

## Required staging/browser validation
Before Production promotion:
1. Edit a completed 18-hole round rating/slope; save; reopen and confirm stored values, CH and differential changed.
2. Confirm Dashboard/Profile handicap history refreshes after the save.
3. Correct a gross-only round and confirm its gross score remains intact.
4. Edit a game-posted personal round and confirm the game result is unchanged.
5. Open a recorded round, change rating/slope, Cancel, and confirm no saved change.

## Release status
**READY FOR STAGING; NOT YET DEPLOYABLE.** Dependency-backed CI/build and browser validation remain mandatory.
