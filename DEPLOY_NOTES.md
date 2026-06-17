# Deploy notes — v1.0.31 (cumulative — full app, supersedes all prior)

## Database — run supabase/migrations/0008_game_players_sand_pen.sql
Adds penalties + sand jsonb arrays to game_players (for match-play Sand/Pen).
If not already run: 0002–0007.

## Changes
1. Game setup: the selected course now shows a clear ✓ + "SELECTED" highlight
   (matched by course id), so it's obvious the pick registered.
2. Group card: tapping an empty cell now defaults that hole to PAR, then +/-
   adjusts — fast entry for the common case.
3. Sand / Pen tracking now works in match play (all game formats), matching
   solo rounds:
   - The in-game score entry shows the Sand/Pen column.
   - The marker's tap-to-edit popup gains a Sand (greenside bunker) toggle and a
     0-3 penalty picker.
   - Penalties + sand are stored per hole on game_players (migration 0008) and
     carried into your recorded round, so the dashboard Sand-save % and penalty
     stats include match-play data. (Yardage is carried into recorded rounds too.)

## Still needs a two-device / live check
The marker writing another player's sand/penalty relies on the same RLS as
scores (0006/0007). Verify in your project.
