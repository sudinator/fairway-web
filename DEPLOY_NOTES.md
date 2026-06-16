# Deploy notes — v1.0.27 (cumulative — full app, supersedes all prior)

## Database — run in Supabase SQL editor (idempotent, safe to re-run)
- NEW: supabase/migrations/0005_holes_yardage.sql   (per-hole yardage on solo rounds)
- If not already run: 0002, 0003, 0004

## Deploy
Copy over the repo → commit & push → Vercel auto-deploys.

## Group scoring — STAGE 1 of 2 (yardage + read-only group card)
This is the foundation for one-person group scoring. It does NOT yet include
the live marker take-over, guest players, or real-time updates — those are
Stage 2.

- Yardage: now captured per tee from golfcourseapi and stored. New games store
  per-hole yardage in their holes_meta; solo rounds store it on the holes table
  (column added by migration 0005). Manually-entered courses and previously
  saved courses simply have no yardage until refreshed.
- Group card: in any game's play view there's a new "Results / Group card"
  toggle. "Group card" shows the whole group on one vertical scorecard —
  players across the top, holes down the side (number, par, yardage, SI), each
  cell showing gross with Stableford points in the corner, colored by net
  (green under / blue par / red over), stroke dots where a player gets a shot,
  and IN / OUT / TOT aggregates. Read-only in this stage.

## Coming in Stage 2
- "Marker" take-over (any player can take the card, with a confirm to transfer)
  and writing the group's scores; tap-to-edit per cell incl. stats.
- Guest players (name + handicap, no account, stored only on the game).
- Real-time updates so viewers see scores as the marker enters them.
