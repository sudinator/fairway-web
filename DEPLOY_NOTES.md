# Deploy notes — v1.0.37 (cumulative — full app, supersedes all prior)

## Database — run supabase/migrations/0012_per_group_finish.sql
Adds game_players.group_locked, finish_tee_group(p_game) (marker locks own
group), and redefines finish_game(p_game) to be ORGANIZER-ONLY. If not already
run: 0002–0011.

## Per-group finishing vs whole-game end
- A group's MARKER sees "🏁 Finish Group N's round" — it locks ONLY their four
  and posts those players' rounds; the rest of the game keeps going.
- The ORGANIZER sees "🔒 End game for everyone" — only the organizer can end the
  whole game.
- If the organizer is also a marker, they see BOTH: finishing their group locks
  just that group and does NOT end the game. (Verified vs PostgreSQL.)
- Group switcher shows 🔒 for finished groups; locked groups are read-only.

## Marker hand-off / switching to individual scoring
- A marker can "Hand off" (step down). If no one re-claims, the group has no
  marker — and each player's own "Enter your scores" card reappears, so the
  group can simply score individually. Scores still feed the live results.
- To finalize after going individual: either someone re-claims the marker and
  taps "Finish Group N", or the organizer ends the whole game (both post each
  player's round).

## Still needs a two-device / live check
auth.uid(), realtime, the finish/lock propagation, and hand-off on real devices.
