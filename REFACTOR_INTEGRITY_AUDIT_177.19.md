# Refactor Integrity Audit — 177.19

## Confirmed defect
`CoursesLibrary` retained `editing` state and `openEditor(...)` entry actions but no longer rendered `CourseEditor` when that state was populated. This broke Add New Course, edit existing course, and resume-after-interruption.

## Root lesson
Byte-identical relocation is insufficient. Stateful extraction verification must include permanent reachability and exit-path contracts.

## Current audit findings
- Restored Courses editor render bridge.
- Major extracted game components remain referenced from the live game room.
- Removed stale `OrganizerPanel.onSetTeeGroup` boundary prop; tee-group assignment remains owned by `GroupsBuilder`.
- Removed orphan `addMemberId/setAddMemberId` state.
- Existing inherited import debt is frozen by a CI ratchet and should be reduced incrementally.

## Permanent controls
- `ci/check_extraction_reachability.py`
- `ci/check_extracted_state_hygiene.py`
- `ci/check_extracted_import_debt.py`
- explicit `OrganizerPanelProps` plus `satisfies OrganizerPanelProps` at the spread-prop construction site
