# Birdie Num Num — v1.20.1

Patch over v1.20.0. NO migration, app-only.

## Fix: reset still wasn't clearing the ORGANIZER's own scores
Root cause (best diagnosis): on the organizer's device, the only row that gets
special treatment is their own (`me`) — the local backup and the background flush
only ever touch `me`. The earlier fix cleared the backup, but the background
FLUSH was still firing: in a standalone PWA, the `confirm()` dialog can raise a
visibilitychange/blur, which triggered the flush to (a) re-save the old scores to
the local backup and (b) fire an un-awaited DB write of the old scores that could
land AFTER the reset's blank write — repopulating the organizer's row. Only the
organizer's row, because that's the only one the flush touches. Consistent,
because the confirm dialog appears every time.

Fix:
- A `resetting` flag is set BEFORE `confirm()` and held until the reload
  completes; the flush bails while it's set, so no stale write can fire during a
  reset (including the confirm-triggered one).
- State is cleared optimistically (so the in-memory row goes blank immediately
  and any later flush could only ever write blanks).
- The local backup is still cleared, so the reconcile merge has nothing to
  restore.

## Everything else unchanged from v1.20.0
Concurrency guard (markerOwnsMyRow), recovery merge (mergeScoreArrays), reopen
updates posted rounds, join uses organizer's course params, read-only "who's
keeping score" note. 130 unit tests pass.

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 130/130 pass

## Smoke-test (the one that matters)
Enter dummy scores as the organizer AND another player. Tap Reset scores, confirm
YES. Both rows should zero out — including yours. Then pull-to-refresh / reopen
the game and confirm your row STAYS empty (the refresh is the real proof).
If it ever recurs, the next step is to replace the native confirm() with an
in-app modal so no OS-level visibility event can fire at all.
