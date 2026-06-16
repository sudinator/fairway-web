# Deploy notes — v1.0.24 (cumulative — full app, supersedes all prior)

## Database — run in Supabase SQL editor (idempotent, safe to re-run)
- NEW: supabase/migrations/0004_holes_sand.sql   (per-hole greenside-bunker flag)
- If not already run: 0002_games_played_at.sql, 0003_games_allowance_pct.sql

Existing holes default to sand = false, so nothing changes for past rounds.

## Deploy
Copy over the repo → commit & push → Vercel auto-deploys.

## New in v1.0.24 — Sand saves
- The scorecard's penalty column is now "Sand / Pen" (one column). Tapping a
  hole's cell opens a popup with a Greenside-bunker (S) on/off toggle and the
  0–3 penalty stepper. The cell displays: * for both, S for bunker only, the
  number for penalties only, · for neither.
- New dashboard stat: Sand saves — of holes flagged as a greenside bunker, how
  often you still made par or better. Tap it for a per-round breakdown. Sits
  next to GIR / Fairways / Scrambling. Counts par-3 bunkers too.
- The read-only round scorecard shows the same Sand/Pen column so a bunker-only
  hole isn't hidden.

## Carried forward (already in prior versions)
- v1.0.22: Skins format + handicap allowance (all formats).
- v1.0.23: date-field font fix; correction-reason only on real course edits;
  fairways in the live per-9 subtotal.
