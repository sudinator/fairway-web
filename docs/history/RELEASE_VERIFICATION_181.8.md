# Release verification — 181.8.260903

## Required acceptance scenario — EXECUTED: PASS

Starting state: two complete 2-v-2 groups with all eight players assigned.

1. Opened a populated Team A slot in Group 1.
2. Verified Team A players assigned to Group 2 remained selectable.
3. Selected A3 from Group 2 for A1's Group 1 slot.
4. Verified A3 moved to Group 1 and displaced A1 became unassigned.
5. Reconstructed the state to model a database reload.
6. Verified A1 and other valid Group 1 players remained available for Group 2.
7. Assigned A1 to the vacated Group 2 slot.
8. Verified both groups again contained two Team A players and no player was duplicated.

Executed assertions: 6/6 passed. The production UI calls the same tested `teamGroupSlotChoices` and `applyTeamGroupSlotMove` functions.

## Full release gate

- TypeScript: PASS.
- ESLint hooks: PASS.
- Unit/render/differential suite: PASS — 189,947 assertions.
- Grouping suite: PASS — 297 assertions.
- Competitive assignment contract: PASS — 32/32.
- Security, lifecycle, migration, design-scale and mobile-fit guards: PASS.
- Production build: PASS using the documented local VAPID opt-out and placeholder public Supabase variables.
- No database migration. Migration 0148 remains current.

## Staging acceptance

Repeat the same assign → change → reload → complete sequence in game 912410 before Production promotion.
