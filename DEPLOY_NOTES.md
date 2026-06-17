# v1.5.0

## What Changed

### 1. Unified Manage Game setup
- Consolidated setup into one player-level roster table under Organizer / Manage Game.
- Each player row now controls the fields that used to be spread across separate setup boxes:
  - Handicap index
  - Tee
  - Team
  - Tee group
  - No-show status where relevant
  - Remove player

### 2. Removed legacy duplicate setup surfaces
- Removed unused legacy guest-add setup component from the game room.
- Removed unused legacy tee-group assignment component from the game room.
- Removed unused post-create registered-player add helper.
- Roster creation remains in the initial game creation workflow; Manage Game configures the roster instead of creating it.

### 3. Manual pairings preserved
- Pairings are still selected manually in the match/skins setup sections.
- No automatic pairing generation was added.
- Team assignments now feed the pairing display and scoring logic from the player-level roster.

### 4. Per-player tees retained
- Organizer can set different tees for different players in the same game.
- Course handicap recalculates from each player’s selected tee rating/slope and handicap index.

## Files Modified
- components/tournaments.tsx
- package.json
- package-lock.json
- DEPLOY_NOTES.md

## Supabase Changes
- None.

## Deployment Notes
- No Supabase update is required before deploying this code.
- Deploy application code directly after normal build validation.

## Regression / Validation
- TypeScript: `npx tsc --noEmit` passed.
- Next build: production compile passed; local build then timed out during Next lint/type-check phase in this temporary environment.
- Code-level audit confirmed no active references remain to the removed legacy guest-add or tee-group setup components.

---

# v1.4.1

## What Changed

### 1. Per-player tee selection in Manage Game
- Organizer can now set each player's tee independently from the unified player roster.
- Course handicap recalculates immediately from that player's handicap index and selected tee rating/slope.
- Supports mixed-tee groups, e.g. two players on Blue and two players on White.

### 2. Removed post-create Add Player workflow
- Removed the registered-player add panel from Organizer / Manage Game.
- Player and guest selection should happen before course/game setup so the roster persists consistently.
- Organizer / Manage Game now configures the roster; it no longer creates the roster.

## Files Modified
- components/tournaments.tsx
- package.json
- DEPLOY_NOTES.md

## Supabase Changes
- None.

## Deployment Notes
- No Supabase update is required before deploying this code.
- Deploy application code directly after normal build validation.

---

# Deploy notes - v1.4.0 (cumulative - full app, supersedes all prior)

## Release policy
- Version number is updated on every codebase change.
- Release notes are updated alongside each deployable zip.

## v1.4.0

### Added
- Unified organizer setup roster for players, handicaps, teams, and tee groups in one Manage Game section.
- Handicap values can now be edited directly from the player-level setup roster.
- Team assignment and tee group assignment now happen on each player row instead of in separate repeated setup boxes.
- Team and tee group summary cards are generated from the player-level roster assignments.

### Changed
- Removed duplicate team-assignment and tee-group setup panels from match/four-ball/skins setup flows.
- Matchups remain manually selected; the app does not auto-generate pairings.
- Guest players added in the initial create-game Players step persist as normal `game_players` rows through game setup and scoring.

### Supabase
- No new Supabase migration is required for this release. It uses existing `game_players.team`, `game_players.tee_group`, and existing game pairing/foursome fields.

## v1.3.1

### Fixed
- Fixed production build failure in `FourballView` by defining team metadata in the component scope before rendering team names.
- Preserves v1.3.0 team 1:1 skins behavior and team best-ball skins behavior.

## v1.3.0

### Added
- Added team 1:1 skins: organizers can create two teams, assign players, and pair players head-to-head across teams.
- Head-to-head skins won by each player now roll up into the player's team total.
- Team skins creation now supports choosing either 1:1 team skins or team best-ball skins.

### Changed
- Skins team mode no longer forces best-ball foursomes. The default team skins structure is now 1:1 pairings, matching team match-play infrastructure.
- Team best-ball skins remains available as a separate setup choice for foursome/better-ball play.

### Scoring
- In both 1:1 team skins and team best-ball skins, a halved hole carries the skin value forward to the next hole.

## v1.2.1

### Added
- Added a Clear button to the individual player score popup in group scoring.
- Clear removes that player's current-hole score/stat entry without affecting other players or other holes.

### Changed
- Done behavior is unchanged; no auto-advance and no clear-all-hole action was added.

## v1.2.0

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
- No new migration is required for v1.2.1 if migrations 0002-0013 have already been run.
- If deploying to a fresh database, run migrations 0002-0013, including `supabase/migrations/0013_delete_game.sql`.

## Prior v1.1.0 notes
- Guest players can be added during game creation, before selecting/finalizing the course and format.
- Guests are supported across team match play, four-ball / team best-ball, team assignments, and foursomes.
- Removing a guest cleans up related matchups and foursome assignments.
- Guest notification handling skips players without app accounts.
