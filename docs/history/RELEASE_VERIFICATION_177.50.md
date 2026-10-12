# Release Verification — 177.50.260816

## Scope
Staging-only Create Game convergence Stage 3B. Adds draft-time tee inheritance while preserving the existing creation transaction and all post-create game behavior.

## Behavior contract
- Effective tee priority during Create Game: individual override > one-off flight tee > game default tee.
- Global default remains the convenience path for the normal all-same-tee field.
- Flight tee applies only to players inheriting from their flight.
- Explicit player override is never overwritten by a default/flight change.
- Course change clears all draft tee-index maps.
- Resume Setup persists optional player/flight tee maps; pre-177.50 drafts remain valid and resume with empty maps.
- Create resolves the effective tee into explicit `game_players.tee_name/rating/slope/course_handicap`; inheritance does not persist after creation.
- No migration or schema change.

## Inputs / outputs / dependencies reviewed
Inputs: selected course + tee catalog, game default tee index, selected roster/guests, handicap indexes/overrides, one-off flight bands, flight tee map, player tee override map.
Outputs: unchanged games payload plus explicit per-player tee/rating/slope/course-handicap snapshots built by `buildPlayerRows()`.
Side effects: existing CreateGame Supabase writes only. `lib/game-tee-assignment.ts` is pure and owns no browser/database calls.
Dependencies: `lib/flights.ts::flightForIndex`, `lib/golf.ts::courseHandicap`, existing local setup draft, existing `buildPlayerRows()`.

## EXECUTED validation
- `lib/game-tee-assignment.test.ts`: 5,011/5,011 assertions PASS.
- `lib/game-setup-draft.test.ts`: 2,006/2,006 assertions PASS, including pre-177.50 draft compatibility.
- `lib/game-create.test.ts`: 42/42 PASS, including member/guest tee resolution and handicap calculation on effective tee.
- `lib/game-create.diff.test.ts`: 9,000/9,000 old-vs-new comparisons PASS when the new optional hierarchy inputs are absent.
- `npm run guards`: PASS, including new `CREATE_GAME_TEE_INHERITANCE_PASS 12/12` and existing 50,087 workflow/fault simulation checks.
- Create Game state inventory: 37 state cells + 3 refs explicitly classified.
- TypeScript syntax/transpile diagnostics for changed TS/TSX: 0 syntax errors.
- No migration.

## NOT EXECUTED locally / required staging gate
The supplied source tree does not include the complete installed dependency type roots, so full project `npx tsc --noEmit`, `npm test`, and `npm run build` are not claimed locally. GitHub CI/Vercel staging remain mandatory.

## Browser validation required before Stage 3C
1. Default Blue applies to all selected players.
2. Change one player to White; changing global Blue -> another tee must leave that player White.
3. One-off flights: assign different tees to Flight A/B and verify inherited player labels change correctly.
4. Give one flighted player an explicit override and verify it beats the flight tee.
5. Navigate Game -> Players -> Format -> Players -> Review and confirm assignments persist.
6. Leave Create Game and Resume; confirm tee choices restore.
7. Create a staging game and verify resulting Manage Game Players shows the expected explicit tee for each player.

## Release status
STAGING CANDIDATE ONLY. Not a Production release and no staging->main PR until the complete Create Game convergence train passes the final cumulative release gate.
