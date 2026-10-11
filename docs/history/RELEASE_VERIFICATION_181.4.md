# Release verification — 181.4.260902

## Deployment

- Deploy the application build to Staging.
- Do **not** run a database migration. Migration `0147_ryder_cup_trifecta_draft_groups` remains current.
- Confirm the displayed application version is `181.4.260902`.

## Ryder Cup Trifecta setup

1. Open an unscored Trifecta session from a Ryder Cup.
2. Open **Teams**. Confirm the inherited Ryder Cup teams and players are visible and no session-level team editing controls appear.
3. Open **Groups**. Build balanced groups, move players between foursomes, and move a player to unassigned. Confirm every complete foursome has two players from each team.
4. Open **Matchups**. Confirm there is no **Add foursome** or player-assignment selector.
5. For every complete foursome, choose **Standard pairing**, then **Cross pairing**. Confirm the two named Singles matches update clearly and the selected option is marked.
6. Refresh and confirm the chosen Singles pairing persists.
7. Return to Groups, change an unscored foursome, and confirm the Matchups choices render for the updated four players.

## Scoring and narrow-screen fit

1. Start the Trifecta game and enter gross scores for all four players in a foursome.
2. Confirm the scorecard produces two Singles contests plus the Four-Ball team contest from the same four score rows.
3. At an iPhone-width viewport, inspect players with long names and multi-line stroke allocations.
4. Confirm both Best Ball team columns, names, playing handicaps, and stroke text stay inside the bordered score summary without horizontal page scrolling.

## Automated gates

- Run `npm run ci` and require a clean result before promotion.
- Promote through one Staging-to-Production pull request after the manual checks above pass.
