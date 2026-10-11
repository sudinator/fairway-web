# Release Verification — 177.53.260816

## Descriptor
**Format Selection Convergence — clearer Create Game choices, same persisted game model**

## Scope
Staging-only Create Game convergence checkpoint. No migration.

The format chooser was redesigned after a de novo 177.46 Production-vs-177.52 staging audit found no lost format capability but did find ambiguous selection language: `Team` meant two different things in Four-ball, Match could visually say Individual while a separate Team Match checkbox enabled team mode, and Skins structures were split across two family branches.

## Behavior contract
The redesign changes selection methodology only. It deliberately preserves the existing persisted fields and scoring engine: `game_type`, team-mode-driven teams, `team_score_mode`, `trifecta_scoring`, `stroke_basis`, `skins_mode`, the existing skins structure marker, handicap allowance, flights, team names, tee inheritance, Resume Setup, and Lean Create routing.

Advanced teams/matchups/foursomes/tee groups remain in Manage Game.

## New selector
- Stableford
- Stroke Play → Net / Gross
- Match Play → Individual / Team
- Four-ball → 2 v 2 Match / Team vs Team → Best ball / Shootout
- Trifecta → Best ball / Shootout → Per hole / Ryder Cup
- Skins → Individual / 1:1 Teams / 2 v 2 Best-ball → Carry over / Split/Halved; 2v2 retains Best ball / Aggregate

Review now shows the full interpretation rather than only the base game type.

## Executed validation
- `lib/create-game-format.test.ts`: **35/35 PASS**
- `lib/game-create.test.ts`: **52/52 PASS**
- historical Create Game differential: **9,000 comparisons, 0 mismatches**
- setup draft/resume: **2,007/2,007 PASS**
- tee inheritance: **5,011/5,011 PASS**
- `npm run guards`: **PASS**
- workflow/fault simulation inside guards: **50,087 PASS**
- new permanent `check_create_game_format_selection.py`: **8/8 PASS**
- changed TSX syntax-class diagnostic scan: **no syntax-class diagnostics**

## Environment limitation
The supplied staging tree has no installed application dependency type roots (`node_modules` absent). Full `npx tsc --noEmit`, full `npm test`, lint, and Next build are therefore not locally claimable. GitHub staging CI remains mandatory and this release is **not deployable to Production** until that and browser validation pass.

## Production gate still required
Before the cumulative Create Game convergence release is promoted, perform the requested fresh 177.46 Production → final staging line-by-line/contract audit and the full release gate. This checkpoint does not waive that requirement.
