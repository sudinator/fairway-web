# Release Verification — 177.41.260816

## Scope
Persistent Game Control Center navigation on top of the 177.40 setup-workspace extraction. The organizer setup surface now opens to an overview and provides revisitable Game details, Players, Format, Teams & groups, and Review sections in the existing BNN visual language.

No database migration. No scoring algorithm changes. No Supabase/RPC ownership moved into the setup workspace.

## Contract inventory
### Inputs preserved
- `game`, `players`, `setupTab`, current user/organizer state.
- Existing `OrganizerPanelProps` callbacks for handicap, tee, roster, team, format, lifecycle, and sharing.
- Existing tee-group/randomize callbacks and state.
- Existing `setGameDate` writer is passed through the workspace boundary.

### Outputs / side effects preserved
- Workspace navigation changes only local `setupTab` state.
- Rename still calls `renameGame`.
- Play-date edit still calls `setGameDate`.
- Players/teams/format still call the same `OrganizerPanel` callbacks.
- Tee groups still call the same `GroupsBuilder` callbacks.
- Matchups still render through the existing downstream `StrokesSummary` / match component path in `GameRoom`.
- All Supabase/RPC writes remain in `GameRoom` / existing child components; `GameSetupWorkspace` contains none.

## Intended behavior changes
- `Manage game` opens a persistent Control Center overview instead of the old one-way setup stepper.
- Setup warning -> Open setup also lands on the overview.
- Game details, Players, Format, Teams & groups, and Review can be revisited through one workspace.
- Existing format controls move from the Players surface to a dedicated Format surface.
- Organizer play-date editing moves from the game-room header into Game details.

## Deliberately deferred
- Replacing the game course after creation. This requires a separate semantic contract for `course`, `course_par`, `holes_meta`, and every player's tee/rating/slope/course-handicap snapshot.
- New post-scoring allowed/confirm/blocked transition rules. Existing mutation rules remain authoritative in 177.41.

## Executed validation
- `ci/check_game_setup_workspace_contract.py`: PASS (24 boundary links + no DB ownership).
- Negative guard test: removing the Review overview contract correctly fails the guard; restored source passes.
- `ci/check_extraction_reachability.py`: PASS (16 critical contract links).
- UI guards: minimum font, contrast, global rules, chart overflow, date input, bottom sheet, safe-area frame, popup-close: PASS in the executed guard run before the workflow-simulation timeout.
- Remaining targeted guards after the timeout: PASS, including migration authorization, course schema, staging integration contract, effect suppression, bet atomicity, player tee setup, provider IDs, extraction hygiene, PWA update, staging marker, course-source transparency, dashboard putts/round, historical rating/slope, and Game Control Center contract.
- `ci/workflow_fault_simulation.py`: PASS (50,087 checks; 50,000 randomized RSVP operations).
- Game Control Center model: PASS (66 navigation/state checks across 6 representative game shapes, including A -> B -> A return paths).
- TypeScript syntax transpile for changed TSX files: PASS.

## Dependency-backed gate status
`tsc --noEmit` cannot complete in this container because the uploaded ZIP does not include dependencies and `npm ci` could not finish within the environment limit. The compiler stops on missing type roots (`react`, `node`, D3 types, etc.) before checking the application program.

Therefore this candidate is **NOT YET DEPLOYABLE**. GitHub dependency-backed `npm run ci` (lint hooks, `tsc --noEmit`, guards, unit/differential tests, build) and Vercel staging remain mandatory release gates.
