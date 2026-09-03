# Release verification — 181.10.260903

## Scope

This release corrects the Groups selector contract for Ryder Cup Trifecta setup.

- An occupied slot offers its current player and **Move to unassigned**.
- Players assigned to another group do not appear in the selector.
- An empty slot offers only eligible players in the Unassigned pool.
- Moving players between completed groups is an explicit two-step operation: unassign, then assign.
- No database migration is required. Migration 0148 remains current.

## Required workflow verified

The rendered setup test starts with two complete 2-v-2 groups and performs the following interaction sequence:

1. Open an occupied slot and verify it contains only its current player plus **Move to unassigned**.
2. Verify players assigned to other groups are absent.
3. Move one player from each group to Unassigned.
4. Verify the empty slots offer only those two unassigned, team-eligible players.
5. Assign the players into the opposite groups.
6. Verify both groups are complete, every player remains visible, and no duplicate assignment exists.

## Automated verification

- Grouping and selector logic: **297/297 passed**.
- Rendered Teams navigation and Groups interaction contract: **23/23 passed**.
- Competitive assignment source contract: **32/32 passed**.
- Full application test baseline: **189,947 assertions across 43 suites passed**.
- TypeScript, lint, lifecycle, security/RLS, migration, design-scale and mobile-fit guards: **passed**.
- Production build: **passed** using placeholder local Supabase values and the documented `VAPID_CHECK_OPTIONAL=1` local-build opt-out. Staging must continue to provide its real Supabase and VAPID environment values.

## Staging acceptance

1. Open the Trifecta game and choose Groups.
2. With all players assigned, open an occupied selector.
3. Confirm it shows only the current player and **Move to unassigned**.
4. Move one player from each of two groups to Unassigned.
5. Confirm only unassigned, team-eligible players appear in the empty slots.
6. Reassign the two players into opposite groups and save.
7. Refresh and confirm both group membership and Singles pairing choices persist.

