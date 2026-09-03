# Release verification — 181.5.260902

## Deployment

- Apply this changed-files overlay to Staging.
- Do **not** run a database migration. Migration `0147_ryder_cup_trifecta_draft_groups` remains current.
- Confirm the displayed application version is `181.5.260902`.

## Required CI proof

- Run `npm run ci` and confirm `competitive assignment contract: PASS`.
- The contract must find the cross-group selector rule, **Move to unassigned**, Trifecta Standard/Cross pairing controls, inherited Ryder Cup teams, and mobile containment styles.

## Manual Trifecta verification

1. Open an unscored Ryder Cup Trifecta session.
2. In **Groups**, build balanced groups, move a player directly from another group, and move an occupied player to unassigned.
3. Confirm each complete foursome has two players from each Ryder Cup team.
4. In **Matchups**, confirm there is no **Add foursome** control. Select both **Standard pairing** and **Cross pairing**, verifying the two named Singles contests.
5. Refresh and confirm the selected pairing persists.
6. In **Teams**, confirm the inherited Ryder Cup roster is visible without session-level editing controls.
7. On an iPhone-width screen, confirm long names, playing handicaps, and stroke allocations remain inside the bordered Trifecta summary.
