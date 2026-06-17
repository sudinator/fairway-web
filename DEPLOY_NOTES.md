# Deploy notes — v1.0.40 (cumulative — full app, supersedes all prior)

## Database — run supabase/migrations/0013_delete_game.sql
Adds delete_game(p_game, p_delete_rounds) RPC (organizer-only). If not already
run: 0002–0012.

## Delete-game behavior (rounds)
- Deleting a game on a LATER day removes the game for everyone but KEEPS each
  player's posted round in their own Rounds history (this was already the case;
  delete never cascaded to rounds).
- Deleting a game the SAME DAY it was created now warns that the scorecards
  already posted to players' Rounds tabs will ALSO be deleted, and removes those
  rounds (and their holes) on confirm.
- Both paths are organizer-only and run via a SECURITY DEFINER RPC. Verified
  vs PostgreSQL: keep-rounds keeps them, same-day removes rounds+holes, and a
  non-organizer is rejected.
