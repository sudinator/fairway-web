# Deploy notes — v1.0.33 (cumulative — full app, supersedes all prior)

## Database
No new migration. If not already run: 0002–0008.

## Change
Guest players can now be added to SKINS games. The organizer opens the game →
"⚙ Game setup" tab → "Guest players" → "+ Add guest player" (name + course
handicap). Guests are included in the net-skins calculation automatically and
are scored by the marker on the Group card.

## Note on "team skins"
Skins is currently scored as INDIVIDUAL net skins (lowest net on a hole wins,
ties carry). There is no team-skins scoring variant in the app yet, so a guest
in a skins game competes as an individual. If you want true team skins (e.g.
best-ball-per-team, or aggregate-per-team), that's a scoring change — tell me
which variant and I'll build it.
