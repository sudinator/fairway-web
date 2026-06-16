# Deploy notes — v1.0.29 (cumulative — full app, supersedes all prior)

## Database
- Run 0006_group_marker.sql if not already run (Stage 2A). No new migration here.
- Earlier: 0002, 0003, 0004, 0005.

## Group scoring — conflict fix
- While a marker is keeping score (and the game isn't ended), the individual
  "Enter your scores" card is now HIDDEN for everyone. Scoring happens only on
  the Group card via the marker, removing the race between the marker and a
  player's own entry.
- When scoring is switched on, the app auto-opens the Group card. A hint on the
  Results view points there if you toggle away.

## Note on RLS verification
The 0006 policy logic was tested against a local PostgreSQL 16 with RLS enforced
(marker-only cross-writes, member-only claim, holder-only release, no-marker
lockout — all pass). The live integration (your auth.uid(), your group_members
column names, realtime delivery) still needs a two-device check in your project.
