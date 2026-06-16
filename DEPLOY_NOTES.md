# Deploy notes — v1.0.23 (cumulative — full app, supersedes all prior)

## Database
- No NEW migrations in this version.
- If not already run: 0002 (match date) and 0003 (allowance) from earlier versions.

## Deploy
Copy over the repo → commit & push → Vercel auto-deploys.

## Fixes in v1.0.23
- Match date field now uses the same font as the other inputs (game setup + New
  Round).
- "Reason for course correction" now appears ONLY when course info (hole pars or
  stroke indexes) is actually changed — not when picking a course or editing
  hole scores, in both New Round setup and the finished-round editor.
- The live scorecard's per-9 subtotal now shows Fairways hit (e.g. 2/4) through
  the holes played so far, alongside score/putts/penalties.

(Sand-save tracking is the next build — it adds a per-hole sand input and stat,
which needs its own DB migration.)
