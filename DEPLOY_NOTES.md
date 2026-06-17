# Deploy notes — v1.0.39 (cumulative — full app, supersedes all prior)

## Database
No new migration. If not already run: 0002–0012.

## Tee-group pills now scale to the field (no 8-group ceiling)
Previously the group selector was capped at 8 groups and over-provisioned
(min(8, players/2)). Now: groups shown = ceil(players / 4) + 1 (one spare so you
can always split another group), with a floor of 2, and it never hides a group
that's already in use. Examples: 16 players → 5 pills, 20 → 6, 32 → 9, 48 → 13.
No hard limit on players or groups.
