# Birdie Num Num — Release Verification 179.2

Status: CODE GATES GREEN LOCALLY — STAGING BROWSER ACCEPTANCE REQUIRED.

## Scope

- Four-Ball and Alternate Shot now use group-first 2-v-2 assignment cards with named team sides.
- Standalone Singles and Ryder Cup Team Singles use match-first 1-v-1 assignment cards.
- Unassigned players appear before assignment cards; playing handicaps remain visible in every selector.
- A player selected in one slot is unavailable in all other dropdowns until cleared.
- Scoring, handicap allocation, Cup score aggregation, and database schema are unchanged.

## Automated verification — completed locally

- [x] TypeScript: `npx tsc --noEmit`.
- [x] React hooks lint: `npm run lint:hooks`.
- [x] Full unit/differential/component/screen suite: 189,932 assertions across 43 suites; all green.
- [x] Differential engines: player scoring 60,429; finish gaps 7,490; segments 13,867; game utils 12,003; game creation 9,000 — zero mismatches.
- [x] Competitive assignment model: team 2-v-2 balance, team leftovers, standalone odd-player behavior, and cross-team Singles pairing.
- [x] Permanent source contract: `ci/check_competitive_assignment_contract.py` — 14/14.
- [x] Full guards: `npm run guards`.
- [x] Production build: `npm run build` completed with local placeholder public Supabase values and the documented `VAPID_CHECK_OPTIONAL=1` local-only opt-out. Deployment must use the configured Staging environment values and mandatory VAPID comparison.

## Required Staging acceptance — 12-player Main club scenario

### Four-Ball

1. Open a new team Four-Ball game with all 12 Main players and assign six players to each team.
2. Open Teams & groups → Groups. Confirm the unassigned section is above Group 1.
3. Confirm both team names and each player's playing handicap are visible.
4. Select one player in Group 1. Confirm that player disappears from every other dropdown but remains selected in Group 1.
5. Clear that slot. Confirm the player returns to the unassigned section and eligible dropdowns.
6. Complete Group 1 with exactly two players from each team. Confirm the card reads Ready · 2 v 2.
7. Use Build balanced groups. Confirm three complete groups are created and Review becomes complete.
8. Enter sample scores and verify the existing Four-Ball result and Cup points remain correct.

### Alternate Shot

1. Repeat the group assignment flow and confirm three valid 2-v-2 groups.
2. Confirm each ready group requires a first driver for both team sides.
3. Enter canonical side scores and verify alternating-driver display and existing match result behavior.

### Team Singles and standalone Singles

1. In Team Singles, confirm the left selector only contains Team A and the right only Team B.
2. Assign a player and confirm that player disappears from every other match selector.
3. Use Build balanced matches and confirm six unique cross-team matches.
4. In standalone Singles, confirm balanced matches use every player once and no team labels are required.
5. Enter sample scores, including a halved match, and verify existing match results and Cup aggregation.

### Edge cases

- Mark one player no-show or create an imbalanced team roster. Automatic build must leave the unmatched player visibly unassigned and Review incomplete.
- Reload after manual and automatic assignments; selections must persist without duplicates.
- Test short, abbreviated, apostrophe, hyphenated, and long names on a narrow phone viewport.

## Database

- No migration.
- Migration 0142 remains the applied and verified competition baseline.
