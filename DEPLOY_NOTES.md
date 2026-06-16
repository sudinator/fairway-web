# Deploy notes — v1.0.22 (cumulative — full app, supersedes all prior)

## Database — run BOTH if not already done (Supabase SQL editor)
1. `supabase/migrations/0002_games_played_at.sql`  (match date — from v1.0.19)
2. `supabase/migrations/0003_games_allowance_pct.sql`  (handicap allowance — NEW)

Both are idempotent and safe to re-run. Existing games default to 100% allowance
(no behavior change). Run these before/at the deploy; until 0003 exists, creating
a game won't save the allowance.

## Deploy
Copy over the repo → commit & push (GitHub Desktop) → Vercel auto-deploys.

## New in v1.0.22 (Wave 2)
- Skins (net) — new game format. Lowest net on a hole wins the skin; ties carry
  to the next hole. In-game view shows per-player skin totals, a carry banner,
  per-hole winners, and the live "at stake" count on the next hole. No money in
  the view by design (skin counts only).
- Handicap allowance — set in game setup for ALL formats (playing handicap =
  allowance% of course handicap). Defaults: 85% four-ball, 100% everything else;
  editable with 100/90/85 presets or a custom %. Applied consistently to net
  Stableford, singles match, four-ball, and Skins. At 100% nothing changes, so
  existing/casual play is unaffected.

## Carried forward (already in prior versions)
- Four bug fixes; structured match date + auto-naming; scrambling %; betting
  gated by TGC group id.

(Nassau was considered and dropped to keep the app focused.)
