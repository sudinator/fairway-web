# BNN 182.0.260903 — Staging verification

## Outcome

Manage Game → Format now exposes the same match-length control as Create Game. An organizer can change an unscored game among 18 holes, Front nine and Back nine without rebuilding its competitive setup.

## Database

Apply `migrations/0149_change_game_match_length.sql` to Staging before deploying the interface.

The RPC is authenticated, organizer-only and atomic. It locks the game and player rows, rejects ended or scored games, validates a unique 9/18-hole payload, updates `holes_meta`, and resizes every positional player array. It does not update players, tees, handicaps, teams, foursomes, pairings or contests.

## Executed acceptance chain

The disposable fresh-database gate creates a configured Four-Ball game and executes:

1. Verify a different authenticated player cannot change the game.
2. Front nine → 18 holes.
3. Verify player tee, handicap, team and group survive.
4. Verify teams, foursome and pairing survive.
5. 18 holes → Back nine.
6. Verify holes remain numbered 10–18 and arrays contain nine positions.
7. Enter a score and verify the RPC rejects a length change.
8. Reset Scores and verify the length becomes editable again.

## Manual Staging check

1. Open an active, unscored game on an 18-hole course.
2. Open Manage Game → Format and select a different hole length.
3. Refresh and verify the selection and all setup remain.
4. Enter one score; return to Format and confirm the visible hole controls are disabled with the scoring explanation.
5. Reset Scores and confirm the controls work again.

## Release gate

- TypeScript
- Unit and rendered interaction tests
- Match-length source contract
- Fresh-database reconstruction and executed RPC lifecycle
- Migration authorization, ledger, manifest and parity checks
- Security/RLS guards
- Display-scale and mobile-fit guards
- Production build
