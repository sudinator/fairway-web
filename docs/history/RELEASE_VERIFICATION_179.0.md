# Release Verification — 179.0.260901

## Scope
Ryder Cup-style multi-session Team Competition (Cup) aggregation layer.

A Cup owns two persistent club teams and a fixed event roster. Each session links to one ordinary BNN game using an existing scoring engine: Four-Ball, Alternate Shot, or Team Singles Match. The Cup layer aggregates those child match states into live projected and decided points; it does not duplicate scoring persistence.

## Behavior inventory

### Inputs
- active club/group and current user/admin role
- competition name, optional location, start date
- Team A / Team B names
- club roster assignments to persistent Cup teams
- session name/date/format
- session participant selection inside the existing Create Game flow
- existing child-game structures: teams, pairings/foursomes, player handicaps/scores
- canonical Alternate Shot side scores from migrations 0140/0141

### Outputs / side effects
- calls `create_team_competition(...)` so the `competitions` parent and complete `competition_players` roster commit atomically
- server resolves roster display/profile snapshots and validates active club membership + distinct A/B team names
- child session creation continues through the existing `games` + `game_players` transaction
- inserts `competition_sessions` only after the child game is created successfully
- linked child game remains the scoring/persistence authority
- Cup UI reads child games/player rows/Alternate Shot side scores and derives live aggregate points
- 15-second/focus/manual refresh updates the open Cup view

### Dependencies reused
- `matchStatus()`
- `fourballStatus()`
- `altShotStatus()`
- `canonicalAltShotGross()` and legacy Alternate Shot fallback
- `altShotSides()` / `chBasis()` / `pkey()`
- existing Create Game seed + game/player creation paths
- existing Manage Game Teams / Groups / Matchups editors

## Database
- New migration: `0142_team_competitions.sql`
- Tables: `competitions`, `competition_players`, `competition_sessions`
- RLS enabled on all three tables
- ordinary active members read Cups in their club; system admins retain oversight without club membership
- Cup creation is atomic through `create_team_competition(...)`; non-system structural writers must remain active club members
- linked session validates same club, matching supported format, exact Cup team names, registered Cup-roster participants, and persistent A/B team identity
- linked game structure/team identity cannot drift away from the Cup contract
- Cup roster and team names lock after the first child session is linked
- migration self-records as `0142_team_competitions`

## Executed validation
- `ci/check_competition_contract.py`: PASS (21/21)
- pure competition logic TypeScript compile (dependency-light subset): PASS
- modeled Singles aggregation: PASS
- modeled reversed Singles pairing normalization: PASS
- modeled completed Singles halve: PASS
- modeled unstarted Singles: PASS
- modeled multi-session combination: PASS
- modeled Four-Ball aggregation: PASS
- modeled reversed Four-Ball normalization: PASS
- modeled Alternate Shot canonical side-score aggregation: PASS
- Create Game / Cup source contracts previously executed: PASS
- staging integration source contract: PASS
- staging integration harness syntax: PASS
- migration dependency closure / ledger / manifest / parity source contracts: PASS
- core RLS source contracts: PASS
- workflow fault simulation: PASS (50,087)
- design scale / palette / overlays / resolved contrast: PASS
- computed color matrix: PASS (33/33)
- tap targets: PASS
- shell geometry: PASS (6 device profiles)
- version ledger: PASS
- release verification script: PASS (20/20)

## Test expansion
`competition` unit suite increased from 6 to 9 tests, adding explicit Four-Ball, reversed-side normalization, and canonical Alternate Shot aggregation coverage. Assertion baseline is updated from 189,919 to 189,922 pending a fresh complete `npm test` report.

## Mandatory gates still unresolved
This source environment currently cannot resolve `registry.npmjs.org` (`curl: Could not resolve host`; prior npm install attempts surfaced `EAI_AGAIN`). `npm ci --offline` also confirms the npm cache is empty. Therefore a complete dependency-backed release gate cannot currently be executed here.

Still required before this candidate may be called staging-ready/deployable:
- `npm run lint:hooks`
- `npx tsc --noEmit`
- complete `npm test`
- `ci/check_test_assertions.py` against the fresh successful report
- complete `npm run build`
- disposable fresh-Supabase migration reconstruction including 0142
- live Staging application of 0142 + real staging integration run
- targeted browser acceptance of Cup creation/session linkage/aggregation

## Release status
**NOT DEPLOYABLE YET.** Static/source and dependency-light validation is strong, but the mandatory dependency-backed and live-database gates remain open because the current environment cannot reach npm and 0142 has not yet been applied to Staging.
