# Release Verification — 177.17.260811

## Scope
Restore and harden organizer per-player tee assignment in game setup.

## Behavior / data-contract review
- `OrganizerPanel` still receives `players`, `courseTees`, `onSetTee`, and `onOverride`; no callback signature changed.
- `setPlayerTee(p, teeName)` still updates only the selected `game_players` row and persists `rating`, `slope`, `tee_name`, and recalculated `course_handicap`.
- Tee choice no longer depends on yardage. `CourseTee.yardages` remains optional and is not read by the tee-selector contract.
- Handicap override now reads only the selected player's own `rating` and `slope`; cross-player fallback was removed.
- Course lookup keeps the existing group-course path, then falls back to the global `favorite_courses` row by exact course name, then to saved course/player tee snapshots.

## Verification executed here
- `python3 ci/check_player_tee_setup_contract.py` — PASS (8/8 contract checks).
- `npm run guards` — PASS, including 50,087 workflow checks / 50,000 randomized RSVP operations and the new player-tee contract guard.
- `npx tsc --noEmit` — environment dependency install incomplete; TypeScript could not resolve installed type packages, so full compile was not proven locally. This is an environment/dependency availability failure, not a source diagnostic against the modified files.
- Full GitHub CI + staging deployment remains the required release gate before production.

## Database
No migration required.
