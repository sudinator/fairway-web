# Workflow Simulation Report — 177.43.260816

## Scope
Central Game Control Center transition policy. No database migration.

## EXECUTED
- `lib/game-setup-policy.test.ts`: 41/41 assertions PASS using a dependency-free TypeScript compile of the pure policy and its domain dependencies.
- `ci/workflow_fault_simulation.py`: 50,087 checks PASS (50,000 randomized RSVP operations plus existing workflow fault models).
- `ci/check_game_setup_policy_contract.py`: PASS; verifies the pure policy, handler enforcement, UI consumption, scored-player removal protection, format policy, tee correction wording, tee-group policy boundary, direct matchup/foursome writer enforcement, and FINAL ended-state label.
- Existing player-tee, extraction-reachability, workspace, course-provider, PWA, staging-marker, dashboard-putts and historical-rating/slope guards PASS after updating their expected source contracts for the new policy layer.

## MODELLED transition scenarios
The following were reviewed against `decideSetupChange` and the actual 177.42 mutation handlers. These are MODELLED unless also represented by an executable assertion above.

### Normal paths
- Pre-score player tee/handicap/team/group edits -> ALLOW.
- Pre-score format/structure changes -> ALLOW.
- Rename/share -> ALLOW, including ended games.
- Game-date correction with existing scores -> CONFIRM; existing RPC remains the writer.

### Scoring underway
- Stableford <-> Stroke <-> Individual Skins -> CONFIRM; raw gross scorecards preserved.
- Four-ball <-> Trifecta with existing foursomes -> CONFIRM; same foursomes preserved.
- Handicap allowance / team score / skins tie / Trifecta scoring / leg settings -> CONFIRM; raw gross scores preserved.
- Scored-player tee correction -> CONFIRM as a whole-round correction; physical mid-round tee switching is explicitly not supported.
- Scored-player handicap correction -> CONFIRM; gross scores unchanged.
- Scored-player Remove -> BLOCK; No-show / Out is the preservation path.
- Scored-player team move -> BLOCK.
- Scored/locked tee-group move -> BLOCK.
- Unscored player into an active tee group after scoring starts -> CONFIRM.
- Randomize groups after any score/lock -> BLOCK.
- Individual <-> team structure conversions -> BLOCK.
- Match pairing edits after any score -> BLOCK.
- Four-ball/Trifecta foursome composition, swap, rename, add/remove after any score -> BLOCK; the mirrored tee-group writes are therefore blocked too.
- Skins individual / 1:1 / 2v2 structural conversions -> BLOCK.

### Ended / reopen
- Competition edits while ended -> BLOCK with reopen instruction.
- Reopen does not grant permission by itself; the active-game policy is evaluated again against existing scores.
- Therefore course/structural changes that are unsafe with scores remain unsafe after reopen.

### Invalid / edge cases
- Target locked tee group -> BLOCK.
- Team-format mid-round player addition -> BLOCK.
- Individual-format mid-round player addition -> CONFIRM and starts with no historical holes.
- Removing an unscored player -> CONFIRM.
- Split-skins >4-player restriction remains independently enforced.

### Retry / failure behavior
- Policy evaluation occurs before any Supabase/RPC write. A BLOCK performs no write.
- A cancelled CONFIRM performs no write.
- Existing mutation error handling/reload behavior is preserved after an allowed decision.
- The policy module owns no Supabase client, RPC, alert, confirm, or browser state.

## Adjacent workflows reviewed
- Player tee selection remains independent of yardage and still writes the selected player's own rating/slope/course-handicap snapshot.
- Historical recorded-round rating/slope correction remains separate in Round Editor (177.39).
- Course replacement remains intentionally unimplemented; current course display stays read-only in the Control Center.
- Reset/end/reopen/delete lifecycle commands retain their existing implementation and are outside the setup transition matrix except that ended-state editing is gated by the policy.
