# Release Verification — 177.44.260816

## Scope
Corrective release for the 177.43 PR CI type-check failure. No runtime policy behavior change.

## Root cause
`lib/game-setup-policy.test.ts` declared `baseGame(): Game` but omitted the required `Game.code` field. The local targeted policy compilation used a cast and did not run the full dependency-backed project typecheck; GitHub CI correctly rejected the fixture with TS2352/TS2741 before the suite/build could continue.

## Fix
Add `code: "TEST"` to the typed game fixture. No production component, policy decision, database write, or schema behavior changes.

## Executed validation
- Targeted TypeScript compilation of game-setup-policy test + policy + game types + game-shape: PASS
- Dedicated transition policy suite: PASS 41/41
- Player tee setup contract: PASS
- Game setup transition-policy source contract: PASS (28 links + pure policy)
- Game setup workspace contract: PASS
- Extraction reachability: PASS
- Workflow fault simulation: PASS (50,087 checks)
- Version stamping: 177.44.260816

## Remaining gate
The full dependency-backed `npm run ci` must pass in GitHub. The local dependency tree is incomplete/corrupt for the full project typecheck (`TS2688` missing external type roots), and `npm ci` could not complete in this environment. Therefore this release is not deployable until GitHub CI is green.

## Database
No migration.
