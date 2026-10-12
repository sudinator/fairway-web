# Release Verification — 178.14.260829

## Scope
Alternate Shot presentation/model correction only: team-based group card, side playing handicap, no individual card, no individual segment side game. No database migration.

## Behavior contract
- Existing Four-Ball/Trifecta scoring and display paths remain unchanged.
- Existing Alternate Shot fan-out/persistence remains unchanged.
- Alternate Shot group card collapses each foursome to two sides.
- Team score modal writes only gross side score and uses canonical side handicap/strokes.
- Individual personal card and individual segment side games are absent for Alternate Shot.

## Executed local validation
- `ci/check_altshot_team_card_contract.py`: PASS.
- Existing `ci/check_altshot_view_contract.py`: PASS.
- Targeted TypeScript parse: no syntax diagnostics; dependency/module diagnostics expected because node_modules is not installed in the container.
- Pure Alternate Shot regression suites executed from the actual production modules: alt-shot 73/73, alt-shot-scoring 30/30, alt-shot-scores 49/49, deterministic simulation 178,103/178,103 (5,000 matches).
- UI/global source guards: minimum font PASS, contrast PASS, global rules PASS.
- Broad `npm run guards` progressed cleanly through scoring, Alternate Shot, migration dependency, RLS, CI-runtime and fresh-DB source contracts before the container time limit; no assertion failed before timeout.

## Remaining release gate
GitHub `npm run ci`, staging integration, Vercel staging build, and targeted staging UI smoke must pass before production.
