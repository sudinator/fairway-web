# Deploy notes - v1.1.0 (cumulative - full app, supersedes all prior)

## Release policy
- Version number is now updated on every codebase change.
- Release notes are updated alongside each deployable zip.

## Added
- Guest players can now be added during game creation, before selecting/finalizing the course and format.
- Guests are inserted as first-class `game_players` records at create time.
- Guest players are supported across team match play, four-ball / team best-ball, team assignments, and foursomes.

## Fixed
- Removing a guest now also cleans up related matchups and foursome assignments.
- Guest notification handling now skips players without app accounts.
- Team/game logic now consistently uses stable player keys so guests without `user_id` work correctly.

## Database
- No new migration is required for v1.1.0 if migrations 0002-0013 have already been run.
- If deploying to a fresh database, run migrations 0002-0013, including `supabase/migrations/0013_delete_game.sql`.

## Prior v1.0.40 database note
`0013_delete_game.sql` adds `delete_game(p_game, p_delete_rounds)` RPC for organizer-only deletion.
