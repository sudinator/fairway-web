# Release Verification 177.40.260815

## Scope
Behavior-preserving preparatory refactor only. The existing post-create organizer setup stepper/progress/render boundary moves from `GameRoom` into `components/game/setup/game-setup-workspace.tsx`. No intended UI/behavior change. No migration.

## Contract inventory
### Inputs preserved
- current `game`, `players`, `setupTab` and setup-tab setter
- exact typed `OrganizerPanelProps` mutation bridge
- tee-group callback, randomize callback/state/reason/overflow state
- format-derived `shapeOf(game)` setup visibility

### Outputs / side effects preserved
- setup navigation changes only through the existing `setSetupTab`
- Players/Teams actions invoke the same parent callbacks as 177.39
- Groups actions invoke the same `setPlayerTeeGroup` / `randomizeGroups` callbacks
- all Supabase/RPC writes, notifications, reloads and state mutation handlers remain in `GameRoom`
- Matchups remains on the existing `StrokesSummary` path in `GameRoom`
- structure stash/restore and scoring logic are unchanged

### Dependencies preserved
- `OrganizerPanel`
- `GroupsBuilder`
- `shapeOf` / `pkey`
- canonical `Game` / `Player` types
- existing `GameRoom` callbacks and setup state

## EXECUTED validation
- `npm run guards`: PASS, including all migration/RLS/security/source contracts and 50,087 workflow/fault simulations.
- `ci/check_game_setup_workspace_contract.py`: PASS. Verifies 17 critical boundary links and forbids DB ownership in the workspace.
- `ci/check_extraction_reachability.py`: PASS after updating the expected render bridge to the extracted workspace.
- Negative mutation: adding a `supabase.` ownership marker to the workspace was correctly rejected by `check_game_setup_workspace_contract.py`; after restore the guard passed.
- Negative mutation: removing the `GameSetupWorkspace` render bridge from `GameRoom` was correctly rejected by `check_extraction_reachability.py`; after restore the guard passed.
- One-time moved-copy differential: all 11 user-facing setup hint/status literals from the 177.39 setup block are preserved exactly in the extracted workspace.
- Isolated TypeScript parse attempt of the new workspace reported only expected unresolved-module errors under `noResolve`; no syntax diagnostic was emitted.
- No migrations, RLS policies, grants or application database contracts changed.
- Migration checklist reconciled against the directly verified Production ledger through 0137; 0129 remains the intentional reserved gap.

## Differential review
The extracted workspace contains only logic/JSX that previously lived in the `roomTab === "setup" && isOrganizer` render block: format-derived step visibility, active-tab fallback, completion counts, hint copy, stepper rendering, `OrganizerPanel`, and `GroupsBuilder`. Mutation handlers and database side effects were not moved.

## Advisory findings
`check_extracted_import_debt.py` reports an existing advisory baseline improvement in `components/round-editor.tsx` (24 -> 21). It is unrelated to 177.40 and was intentionally not mixed into this refactor.

## Environment limitation
- `npm ci` could not complete in this container, so dependency-backed execution is unavailable here.
- Global `tsc --noEmit` starts but stops on missing dependency type roots (`react`, `node`, d3 types, etc.); this is an environment/dependency limitation, not reported as a PASS.

## Pending required gates
- dependency-backed `npm run lint:hooks`
- `npx tsc --noEmit`
- complete `npm test`
- production `npm run build`
- GitHub CI / robustness
- targeted staging setup navigation/re-entry validation
- required staging integration on the staging -> main PR
- Production Ready + non-destructive smoke test

**Status: NOT DEPLOYABLE until the pending gates pass.**
