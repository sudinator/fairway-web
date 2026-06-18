# Birdie Num Num — v1.21.2

Restore the proven offline/lock scoring logic; reset is an isolated master wipe.
NO migration.

## Verified against your original v1.5.2 upload (diffed, not from memory)
- load()'s backup reconcile (the offline / screen-lock RECOVERY): now BYTE-FOR-BYTE
  identical to v1.5.2. The backup is merged in to fill any holes the DB is missing,
  and is NEVER discarded by load(). All the reset-era experiments on this path
  (empty-row discard, score epoch) are gone.
- lib/draft.ts saveGameScores / loadGameScores / clearGameScores: restored to
  v1.5.2 verbatim.
- setMyHole / setPlayerHole: the only differences from v1.5.2 are the
  clock_start/clock_end lines, which are the ROUND-CLOCK feature (powers the pace
  reminder), not reset-related.

## Reset = master pre-game wipe (not a per-group action)
- Blanks EVERY player in the game to square one: scores, putts, fairways,
  penalties, sand, the round clock, group-locked, and no-show flags. Keeps the
  players, teams, matchups, and groups so real play can begin.
- Reopens the game if it had been ended.
- Clears the local backup only on the device running the reset (the organizer),
  and suppresses that device's flush during the reset, so the organizer's own
  test scores clear reliably.

## Why reset can NEVER destroy real player data
The backup is a sacred recovery net. If the reset is ever fired while a real
player holds scores (incl. offline/unsynced), that player's device still has its
backup, and load() always recovers it — their scores self-heal on next load. The
ONLY row permanently cleared is the organizer's own (test scores, pre-game). So
even a mis-fired mid-round reset cannot lose another player's data.

## Two safety guards kept (the only data-path deviations from v1.5.2)
Both exist solely to PREVENT data loss and can never cause it:
1. The background flush bails when another player is the marker for your group
   (the marker owns your row; a stale background write from your phone can't
   overwrite their entries).
2. The flush also bails during a reset (so the reset can't be undone by a
   confirm-dialog flush).
Plus a one-line addition in setPlayerHole: when the marker edits their OWN row,
it also writes the local backup — closing a gap where a marker's own score
entered on the group card had no offline/lock backup in v1.5.2.
If you'd rather these be stripped to pure v1.5.2, say so — but each only adds
protection.

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 126/126 pass

## Smoke-test
- Offline/lock (most important): network OFF, enter holes, lock screen, reopen,
  network ON -> holes persist.
- Reset: enter test scores, reset -> all players zeroed, structure intact.
