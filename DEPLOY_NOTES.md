# Birdie Num Num — v1.22.0

Full offline/lock resilience for GROUP scoring + penalties/sand in the backup.
NO migration. Built on the restored v1.5.2 core (offline/lock recovery unchanged
in spirit, now extended).

## Gap 1 fixed: penalties & sand are backed up
The local backup now stores penalties and sand alongside scores/putts/fairways,
and the recovery merge restores them. Previously an offline/lock entry could
recover the strokes but lose the penalty/sand metadata.

## Gap 2 fixed: in group scoring, ALL players' scores are backed up & synced
- The scoring device (marker) now writes a local backup for EVERY player it
  scores, not just its own row. So if the marker enters the group's scores with
  no signal or the screen locks, every player's entry is held safely on the
  device.
- Recovery now reconciles EVERY backed-up row, not just "my" row. On reopen, the
  marker's device pushes any holes the DB is missing (offline entries) back up for
  all players.
- New: when the device comes back ONLINE, it reloads and syncs automatically — no
  need to reopen the game.
- Pushing another player's recovered row uses the marker's server-side rights; a
  push that isn't permitted is harmless (the backup is kept, nothing is lost).

## Preserved guarantees
- A backup is NEVER discarded by load(); it only fills holes the DB is missing.
  Real scores always win; nothing is removed by recovery.
- The master reset now clears EVERY local backup for the game on the resetting
  device (including marker-held rows), so a pre-game test wipe leaves nothing to
  resurface. Other devices are untouched — their real scores stay protected.

## How preservation now holds, end to end
- Screen lock mid-entry: synchronous disk backup lands before the network write;
  recovered on reopen. (any player, group or solo)
- No signal: entries held on disk; synced on the next online event or reopen.
  (any player, group or solo)
- App killed: disk backup survives; recovered on relaunch. (any player)

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 130/130 pass (incl. mergeBackupRow recovery + the marker-clobber
  guard reproduction)

## Smoke-test (two devices, the group case this fixes)
1. Device A is the marker. Put A in airplane mode. Enter scores for all players.
2. Kill/relaunch A (still offline) -> scores still shown (from backup).
3. Turn signal back on -> scores sync to the server automatically; Device B sees
   them. Nothing lost.
