# Release Verification — 177.45.260816

## Scope
- Rename Control Center **Details** to **Game**.
- Move live sharing, End/Reopen, Reset Scores, and Delete Game from Format to Game.
- Put Reset/Delete in a distinct Danger Zone.
- Keep Format focused on competition/scoring configuration.
- Add organizer-only atomic pre-score course replacement via migration 0138.
- Never infer/map player tees across courses; clear old tee/rating/slope/course-handicap snapshots and require deliberate reassignment.

## Behavior / contract review
### Inputs
Current game/status/scores, organizer identity, selected club course, course par/hole metadata, player score/tee snapshots.

### Outputs / side effects
One SECURITY DEFINER transaction updates `games.course/course_par/holes_meta`, invalidates course-dependent `game_players` tee snapshots, resizes blank per-hole state, clears local score backups, reloads GameRoom, and routes setup to Players.

### Preserved dependencies / state
Roster, handicap indexes, teams, pairings, foursomes, tee groups, format/scoring settings, name/date, bets and no-show state are not changed by course replacement.

## EXECUTED PASS
- Dedicated setup policy: **43/43**.
- Workflow/fault simulation: **50,087**.
- `npm run guards`: PASS.
- Game setup workspace contract: PASS (32 boundary links).
- Game setup transition-policy contract: PASS (31 source links).
- New game course-change contract: PASS (18 source links).
- Migration authorization guard: PASS.
- Migration ledger contract: PASS; 0138 is the next ordered migration and records its exact stem.
- Historical migration dependency closure / RLS / security / UI guards: PASS.
- Changed TSX parser pass: no TypeScript syntax-class diagnostics (TS1xxx) in targeted parse.
- Version metadata synchronized at **177.45.260816**.

## Local environment limitations — BLOCKING until CI/staging
The uploaded source tree has no `node_modules`.
- Full `npm test` starts but cannot compile the complete suite because Node type roots are absent (`process` diagnostics in pre-existing tests).
- Full `npx tsc --noEmit`, ESLint and Next build cannot be dependency-backed locally.
- Migration 0138 has not been executed against a real staging database in this environment.

Therefore **177.45 is NOT deployable yet**. Required next gates are: apply 0138 to Supabase staging, GitHub dependency-backed CI/type/build/fresh-DB checks, Vercel staging Ready, then targeted browser validation of Game-section navigation and course-change A→B→A behavior.

## Migration
`migrations/0138_change_game_course_before_scoring.sql` — required before staging browser validation.
