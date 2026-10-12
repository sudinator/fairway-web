# Release Verification — 177.52.260816

## Descriptor
Lean Create pivot: core setup first, structure in Manage Game.

## Scope
Staging-only Create Game convergence checkpoint built from the exact 177.51 staging candidate. This release intentionally removes the pre-create Teams & Groups step before it was deployed. Create Game now owns only Game → Players → Format → Review; persisted structural setup remains authoritative in Manage Game.

## Behavior changes
- Create Game workspace is four sections: Game, Players, Format, Review.
- Default tee → flight tee → individual tee override behavior is preserved.
- Resume Setup is preserved. Older 177.49–177.51 drafts saved on the former `structure` workspace step resume safely at Review.
- Stableford and Stroke create directly into Play.
- Formats needing structural setup create successfully and open Manage Game at the relevant persisted setup section:
  - team Match / team Four-ball / Trifecta / team Skins → Teams
  - individual Match / plain Four-ball → Matchups
  - individual Skins → Groups
- Review explains the post-create Manage Game handoff when additional structure is required.
- Split-Skins >4-player validation now executes before the first database write, preventing a rejected setup from leaving an orphan `games` row.
- No database schema change and no migration.

## Contract review
### Inputs preserved
Game name/date/course, selected field tee, player/guest roster, handicap overrides, player/flight tee overrides, format/scoring settings, flights, tee-time seed, local resume draft.

### Outputs preserved
Game payload, game_players rows, profile handicap updates, tee-time link/activity, notifications, draft clear, and post-create navigation.

### Side-effect ownership
No teams/pairings/foursomes/tee-group draft writer was added. Persisted structure remains owned by Manage Game and its existing transition policy/writers.

## EXECUTED validation
- `npm run guards`: PASS.
- Workflow/fault simulation: PASS — 50,087 checks, including 50,000 randomized RSVP operations.
- Create Game workspace contract: PASS — 13/13.
- Create Game resume/TGC betting scope contract: PASS — 10/10.
- Create Game state inventory: PASS — 37 state cells + 4 refs classified.
- Targeted production-module TypeScript compile (`game-create.ts` + dependencies): PASS.
- `game-create.test.ts`: 52/52 PASS, including 9 Lean Create post-create routing cases.
- `game-create.diff.test.ts`: 9,000 comparisons, 0 mismatches against the historical creation baseline.
- `game-setup-draft.test.ts`: 2,007/2,007 PASS.
- `game-tee-assignment.test.ts`: 5,011/5,011 PASS.

## MODELLED validation
The existing workflow/fault model exercised normal paths, retries/re-entry, invalid states, and failure behavior. New Lean Create routing is additionally covered by the pure `postCreateDestination` matrix in `game-create.test.ts`.

## Not completed in this local environment
- Full project `tsc --noEmit`: NOT COMPLETED. The supplied staging tree has no installed dependency type roots (`react`, `next`, `@types/node`, etc.), so the command stops on missing-module/type diagnostics unrelated to this change.
- Complete Next build: NOT COMPLETED locally for the same dependency limitation.
- Full dependency-backed unit suite: GitHub CI required.
- Browser validation: required after staging deployment.

## Required staging browser checks
1. Game → Players → Format → Review navigation preserves state forward/backward.
2. Leave Create Game/app and Resume restores setup, including tee overrides and current section.
3. Stableford/Stroke creates and opens Play.
4. Individual Match creates and opens Manage Game → Matchups.
5. Team Match or Trifecta creates and opens Manage Game → Teams.
6. Individual Skins creates and opens Manage Game → Groups.
7. Complete structural setup in Manage Game and proceed to scoring.
8. Split Skins with >4 players rejects before creation; confirm no orphan game appears in the Games list.
9. Main/non-TGC guest remains free of TGC-only “no bet” behavior.

## Release status
NOT PRODUCTION-DEPLOYABLE. This is a staging-only convergence checkpoint. GitHub CI, Vercel staging, targeted browser validation, and the final cumulative convergence release gate are still required.
