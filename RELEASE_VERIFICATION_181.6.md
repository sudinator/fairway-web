# Release verification — 181.6.260902

## Deployment

- Apply this changed-files overlay to Staging.
- Do **not** run a database migration. Migration `0147_ryder_cup_trifecta_draft_groups` remains current.
- Confirm the displayed application version is `181.6.260902`.

## Game 912410 — Trifecta setup

1. Open **Manage game → Teams**. Confirm the inherited Ryder Cup teams and players are visible but cannot be reassigned.
2. Confirm there is no separate **Matchups** sub-tab for the Trifecta session.
3. Open **Groups**. Confirm each group provides two slots for each Ryder Cup team.
4. Complete a four-player group. Confirm a **Singles matchups** section appears inside that group.
5. Select **Straight** and confirm the screen names A1 vs B1 and A2 vs B2.
6. Select **Cross** and confirm the screen names A1 vs B2 and A2 vs B1.
7. Refresh the page. Confirm the chosen option remains selected.
8. Replace or move one player before scoring. Confirm the two matchup names update immediately while the chosen Straight/Cross orientation remains selected.
9. Move an occupied player to unassigned, then restore the group. Confirm the matchup controls disappear while incomplete and return when all four slots are filled.

## Scoring lock

1. Enter a score for any player in the Trifecta game.
2. Return to **Manage game → Groups**.
3. Confirm group selectors and Straight/Cross buttons are disabled.
4. Confirm the screen explains that groups and Singles matchups are locked because scoring has started.
5. Reset all test scores. Confirm the controls become editable again.

## Automated verification

- Run `npm run ci` and require a clean result before promotion.
- Confirm `competitive assignment contract: PASS` includes the Groups-owned Trifecta pairing and stale-route checks.
