# 179.5 Staging verification — Ryder Cup naming and quiet defaults

## Naming and explanation

1. Open Games and confirm the two choices read `Games` and `Ryder Cups`.
2. Confirm the helper directly below them explains that a Game is one round, one format and one scorecard, while a Ryder Cup combines several team sessions into one overall match score.
3. Open the Ryder Cups list, creation flow, schedule, standings, tie rule, clinch copy, and linked-session errors. Confirm the user-facing feature name is consistently Ryder Cup.
4. Existing competitions and linked games must still open; this release changes copy, not stored identifiers.

## Ryder Cup session defaults

For one new Four-Ball session, one new Alternate Shot session, and one new Singles session:

1. Create the session game from its Ryder Cup schedule row.
2. Open Manage Game → Review and confirm `Side games: None` before changing any optional setting.
3. Confirm every created participant has money-game participation off.
4. Confirm no closest-to-pin, longest-drive, or straightest-drive contest exists until the organizer explicitly adds one.
5. Turn on one optional contest and confirm it can still be configured normally.

## Standalone regression

1. Create an ordinary non-Ryder-Cup Game and confirm its historical member/guest money defaults are unchanged.
2. Confirm the ordinary format-specific Group Results default is unchanged; Alternate Shot remains off as before.
3. Run `npm run ci`, then `npm run test:staging` before Production.

## Release note

No database migration is included. Migration 0143 remains the latest required migration. Obtain product/legal approval before using the third-party `Ryder Cup` name in Production branding.
