# Workflow Simulation Report — 177.19

## Courses editor state model
Simulated entry/transition chains:
- Add New Course -> `openEditor("new")` -> `editing="new"` -> `CourseEditor(initial=null, existingId=null)` -> cancel/save -> clear persisted marker + clear editing; save refreshes library.
- Existing course row -> `openEditor({id,data,user_id})` -> editor receives exact selected id/data -> cancel/save exit as above.
- Interrupted edit -> persisted active-edit marker restores `editing` on mount -> same render bridge re-enters editor.
- Duplicate behavior remains delegated to current canonical course identity/linking logic; this release does not replace it with name-only matching.

## Extracted game boundary scenarios
- Players/Teams setup -> `OrganizerPanel` remains reachable through explicit typed props.
- Per-player tee action remains consumed inside OrganizerPanel.
- Tee-group assignment remains routed through `GroupsBuilder` rather than a stale OrganizerPanel prop.
- Member/guest add callbacks remain consumed inside OrganizerPanel.

## Failure injection
The new reachability guard is designed to fail if the Courses `editing -> CourseEditor` bridge, save refresh, player/team OrganizerPanel call sites, tee callback, or GroupsBuilder tee-group callback disappears. The state hygiene guard fails on fully orphaned `useState` pairs. The import-debt ratchet fails if audited extracted files accumulate additional imported symbols.

## Execution results
- Existing workflow model/fault suite: PASS (50,087 checks; 50,000 randomized RSVP operations).
- New reachability contract: PASS in normal source state.
- Injected missing editor bridge: correctly FAILED the reachability guard.
- New state-hygiene contract: PASS in normal source state.
- Injected orphan `useState`: correctly FAILED the state-hygiene guard.
