# Deploy notes — v1.0.30 (cumulative — full app, supersedes all prior)

## Database — run supabase/migrations/0007_guest_players.sql in Supabase
SECURITY-SENSITIVE. 0007:
- makes game_players.user_id nullable + adds is_guest
- RLS: any member of the game's group may add / update / remove GUEST rows
  (is_guest = true). Assumes group_members(group_id, user_id) — adjust if needed.
If not already run: 0002, 0003, 0004, 0005, 0006.

## Group scoring — STAGE 2B (guest players)
- In match / four-ball setup there's now "+ Add guest player" (name + course
  handicap). Guests have no app account; they're stored only on the game.
- Guests are scored like anyone (by the marker on the Group card), counted in
  Stableford / Skins, show with a "·G" tag, and can be assigned to singles
  pairings, four-ball foursomes, and teams.
- No personal round / dashboard entry is ever created for a guest, so a guest
  never holds up the match.
- Under the hood: a player's match identity is now user_id for real players
  (unchanged) and the row id for guests, so existing matches are unaffected.

## Cannot be verified here (please test in your project)
- The 0007 RLS (member can add/manage guests) — verify a member can add a guest
  and a non-member cannot.
- Full guest flow on two devices: add guest, assign to a pairing/foursome,
  marker scores them, results count them, no dashboard entry appears for them.
