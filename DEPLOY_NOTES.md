# Deploy notes - v1.2.0 (cumulative - full app, supersedes all prior)

## Release policy
- Version number is updated on every codebase change.
- Release notes are updated alongside each deployable zip.

## Added
- Skins now supports match-play-style setup and scoring instead of only individual low-net skins.
- 1:1 skins uses singles match-play pairings. Each pairing has its own skin pot; a halved hole carries the pot to the next hole.
- Team skins uses four-ball / team best-ball setup. Each side's lowest net ball wins the hole; a halved hole carries the pot to the next hole.
- Team mode is now available when creating a skins game.
- Skins play view now shows per-match or per-foursome skin results, carryovers, and totals.

## Changed
- New skins games default to 1:1 pairings unless Team skins is enabled during creation.
- Team skins games initialize foursomes so organizers can build best-ball teams during setup.
- Legacy/unconfigured skins games still show the old individual net skins view as a fallback with guidance to configure pairings or team best-ball.

## Fixed
- Skins setup can now use guest-supported matchups and foursomes instead of requiring all players to compete in one individual skins pool.

## Database
- No new migration is required for v1.2.0 if migrations 0002-0013 have already been run.
- If deploying to a fresh database, run migrations 0002-0013, including `supabase/migrations/0013_delete_game.sql`.

## Prior v1.1.0 notes
- Guest players can be added during game creation, before selecting/finalizing the course and format.
- Guests are supported across team match play, four-ball / team best-ball, team assignments, and foursomes.
- Removing a guest cleans up related matchups and foursome assignments.
- Guest notification handling skips players without app accounts.
