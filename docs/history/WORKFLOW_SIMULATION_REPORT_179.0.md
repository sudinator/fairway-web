# Workflow Simulation — 179.0.260901

## Model under test
Cup/event is an aggregation parent. Every session is an ordinary BNN team game; child-game scoring remains authoritative.

## Simulated scenarios

### 1. Normal Cup creation
1. Club admin opens Games → Cups.
2. Enters Cup metadata and two team names.
3. Assigns at least one registered club member to each persistent team.
4. One atomic RPC validates the roster and writes parent + all roster rows in one transaction.
5. Active club members can read the Cup; outsider cannot; system admin oversight remains available without club membership.

Result: PASS by source/RLS contract model; live DB execution remains pending.

### 2. Create a Four-Ball session
1. Organizer chooses Four-Ball session/date.
2. Existing Create Game opens with Cup roster/team identities prefilled.
3. Organizer selects session participants/course/tees.
4. Standard BNN game + players are created.
5. Session links to that game.
6. Existing Four-Ball status is aggregated 1 / 1/2 / 0 into the Cup.

Result: PASS in pure runtime model and source contracts.

### 3. Create an Alternate Shot session
1. Existing Alternate Shot setup/scoring is reused.
2. Canonical 0140/0141 side-owned score rows remain authoritative.
3. Cup reads canonical score with legacy fallback but does not write player scores.
4. Existing Alternate Shot match status feeds Cup points.

Result: PASS in pure runtime model and source contracts.

### 4. Create a Singles session
1. Session uses existing Team Individual Match (`game_type='match'`, team mode).
2. Existing pairings determine each match.
3. Match result feeds Cup points.
4. A completed all-square match splits the point.

Result: PASS in pure runtime model.

### 5. Reversed internal pairing/foursome
A child game stores B-v-A ordering even though Cup Team A is the left-side event team.

Expected: Cup normalizes display and score orientation so Team A remains left and the winner is credited to the correct Cup team.

Result: PASS for Singles and Four-Ball modeled cases.

### 6. Organizer is not playing
Cup organizer creates a session but is not selected as a participant.

Expected: Cup-specific Create Game seed may omit the creator's player row while preserving normal Create Game behavior outside Cups.

Result: PASS in `game-create` contract/tests previously executed for this candidate.

### 7. Invalid/raw-API session linkage
Attempt to link a child game from another club, wrong format, wrong team names, a guest/non-roster player, or a player on the wrong Cup team.

Expected: database trigger rejects linkage.

Result: PASS by migration/source contract; explicit real-staging tests are present in `ci/integration/staging.mjs` but cannot execute until 0142 is installed in Staging.

### 8. Post-link drift
After a session is linked, attempt to change child game format/team names/player team identity or change the Cup's persistent roster/team names.

Expected: database triggers reject identity drift while ordinary score/pairing/group operations continue through existing game infrastructure.

Result: source contract PASS; real-staging integration assertions prepared, execution pending.

### 9. In-progress / incomplete matches
Unstarted match contributes zero projected points. Started all-square contributes half projected to each side; decided points remain unchanged until the match is decided.

Result: PASS in modeled Singles runtime.

### 10. Multiple sessions
Combine independently scored session aggregates.

Expected: projected/decided totals add exactly; no score is persisted by the Cup layer.

Result: PASS in pure model.

### 11. Failure/rollback during child-game → Cup link
Game creation succeeds but `competition_sessions` insert fails.

Expected existing candidate behavior: best-effort delete of the just-created child game, surface a clear link failure, do not leave a linked Cup session.

Result: source path verified. Live failure injection remains pending.

### 12. Refresh/re-entry
Open Cup refreshes every 15 seconds, on window focus, and manually. Re-open reloads parent/roster/sessions and recomputes from database truth.

Result: source contract PASS; browser staging validation pending.

## Adjacent workflows checked
- ordinary Create Game creator inclusion remains unchanged when no Cup session seed is present
- Four-Ball, Alternate Shot, Trifecta/Team Match source contracts remain green
- existing Manage Game structure editors remain owners of Teams / Groups / Matchups
- Cup lives inside Games; primary bottom navigation is unchanged

## Overall modeled result
PASS for the executed pure/source scenarios above. This report does **not** substitute for the mandatory full dependency-backed CI, fresh-database reconstruction, live staging integration, or browser acceptance gates.
