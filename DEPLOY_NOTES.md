# Birdie Num Num — v1.19.1

Patch over v1.19.0. NO migration, app-only.

## Fix: reset now clears the ORGANIZER's scores too
In v1.19.0, "Reset scores" cleared everyone except the organizer's own row.
Cause: load() reconciles your own row against a per-device local score backup
(a safety net for scores lost to a screen lock). After a reset, the DB row was
blank but the local backup still held your old scores, so load() merged them
back in — and even re-wrote them to the DB. (Other players have no local backup
on your device, so they cleared correctly.)
Fix: reset now also clears your local score backup for this game before
reloading, so there's nothing stale to restore.

## Everything else unchanged from v1.19.0
- Reset scores: organizer button in Game setup; clears scores/putts/fairways/
  penalties/sand + round clock, reopens if ended, keeps players/teams/matchups.
- Pace reminder on the round clock: target = 6 + 2 x players min/hole
  (2-ball 10, 3-ball 12, 4-ball 14), per group; amber nudge when >10 min behind.

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 118/118 pass

## Smoke-test
- Enter dummy scores as the organizer AND another player, hit Reset scores,
  confirm BOTH rows zero out (not just the others) and stay zero after a refresh.
