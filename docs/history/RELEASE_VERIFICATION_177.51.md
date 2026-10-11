# Release Verification — 177.51.260816

## Scope
Staging-only corrective checkpoint on top of 177.50. Fixes the observed Create Game resume regression, removes TGC-only guest betting presentation/defaults from ordinary groups, and corrects the TypeScript inference failure in the 177.50 tee-assignment test. No migration.

## Root causes verified from code
1. The 177.50 CI failure is test-only: ternary object literals in `game-tee-assignment.test.ts` inferred union shapes containing optional `undefined`, which are not assignable to `Record<string, number>`. The production helper signature is correct.
2. The resume path still autosaved through an effect, but the new sectioned workspace had no explicit exit checkpoint and did not persist its current section or live handicap overrides. The historical guarantee is stronger: leaving/killing the app mid-setup must preserve meaningful work.
3. `LeaderRow` rendered `p.bets === false` as `· no bet` for every group, and guest row creation wrote `bets:false` globally. Those values/messages encode TGC money-game semantics even though BettingPanel itself is correctly TGC-gated.

## Changes
- Explicit `Record<string, number>` annotations in randomized tee-assignment test fixtures.
- Draft checkpoint on change + pagehide + visibility-hidden + unmount.
- Resume restores section, handicap overrides, player tee overrides, and flight tee choices.
- Draft progress recognizes meaningful format/structure/tee work.
- Leader `no bet` presentation gated by effective TGC group.
- Guest `bets=false` default gated to TGC for both Create Game and add-guest-after-create paths.
- New permanent source-contract guard for resume durability and betting scope.

## EXECUTED validation
- `npm run guards`: PASS, including 50,087 workflow/fault simulations.
- `game-tee-assignment.test.js`: 5,011/5,011 PASS.
- `game-create.test.js`: 43/43 PASS, including non-TGC guest betting default.
- `game-setup-draft.test.js`: 2,007/2,007 PASS, including handicap override round-trip/backward compatibility.
- Targeted TypeScript compile for `game-tee-assignment`, `game-create`, `game-setup-draft`, `setup-draft`, and dependencies: PASS.
- Full local `npm test` cannot complete because this source tree lacks installed `@types/node`; emitted changed-test JS was executed directly. GitHub CI is required for dependency-backed lint/type/build.

## Browser validation required on staging
1. Start Create Game, select course/default tee, players, format, and at least one tee/handicap exception. Navigate to another section, leave the app, return, choose Resume, and verify values + section are restored.
2. In Main/non-TGC, create a game with a guest, enter a score, and verify no `no bet` tag or TGC betting panel appears.
3. Confirm TGC/effective-TGC behavior remains unchanged when tested in an environment where TGC entitlement exists.

## Release status
Not Production-ready. This is a staging-only convergence checkpoint until GitHub CI and required staging browser validation pass.
