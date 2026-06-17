# Birdie Num Num — v1.7.1

Fixes the two gaps you found in v1.7.0: the "out / no-show" and mid-round "left"
controls were only showing for four-ball and skins, so they were invisible in
Stableford and singles match. They now show in every format.

## What changed

1. "No-show / out" on the Players & Tees step now appears for ALL formats (it was
   four-ball/skins only).

2. Mid-round "Left / out" on the group card now appears for ALL formats when you're
   the group's scorer (marker) and the group isn't finished.

3. Wording adapts to the format, because the consequence differs:
   * Four-ball: holes they didn't play score net double bogey for their team.
   * Singles match: the match stands on the holes already played.
   * Stableford / skins: their unplayed holes simply score nothing (Stableford gives
     0 points for holes not played, which is the natural result).

Note on safety: only four-ball reads this flag for scoring (net double bogey). In
match and Stableford the flag is informational — the score is already correct from
the holes actually played — so turning it on can't corrupt anyone's result.

Reminder on where to find them:
- Before/never started -> Manage Game -> Players & Tees -> "No-show".
- Left mid-round -> open the Group card as that group's scorer -> tap the player chip.
  (If a game is self-scored with no group marker, use the Players & Tees no-show.)

## SQL migrations

NONE.

## Verified locally

- tsc --noEmit: clean
- next build: passes (7 routes)
- Unit tests: 102/102 pass
