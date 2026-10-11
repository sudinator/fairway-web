# Release Verification — 177.47.260816

## Scope
Create Game convergence Stage 1: introduce a typed canonical `GameSetupDraft` and wire the existing device-draft save path through a compatibility adapter. No intended user-visible behavior change.

## Behavior comparison
- Existing Create Game UI: unchanged.
- Existing `create()` Supabase side effects: unchanged.
- Existing game/player payload builders: unchanged.
- Existing local-storage setup draft schema: unchanged.
- Existing resume logic: unchanged.
- Existing tee-time seed behavior: unchanged.
- Existing format/flights/team routing: unchanged.

## Inputs inventoried
35 React state cells and 3 refs in `CreateGame` are explicitly classified by `ci/check_create_game_state_inventory.py`.

## Outputs / side effects inventoried
The only existing runtime path touched is device-local draft serialization. `toLegacySetupData(buildGameSetupDraft(...))` produces the same legacy object passed to `saveSetupDraft()` as before. Database creation/writes are untouched.

## EXECUTED validation
- `lib/game-setup-draft.test.ts`: PASS — 2,004 assertions, including 2,000 differential legacy-shape comparisons and legacy round-trip compatibility.
- `ci/check_create_game_draft_contract.py`: PASS — 9 contract checks.
- `ci/check_create_game_state_inventory.py`: PASS — 35 state cells + 3 refs classified.
- `npm run guards`: PASS, including 50,087 workflow/fault checks and all existing Game Control Center / transition-policy / course-change contracts.
- Dedicated TypeScript compile of the new draft module/tests: PASS.

## Full gate limitation
The supplied source tree has no `node_modules`. Full `npm test` stops on pre-existing missing Node type roots (`process` unresolved across existing test files). Full project `npx tsc --noEmit`, lint and Next build likewise remain dependency-backed GitHub gates. This release is NOT deployable until GitHub CI, Vercel staging, and targeted staging validation pass.

## Database
No migration. No schema change.

## Release status
NOT DEPLOYABLE pending dependency-backed CI/build and staging validation.
