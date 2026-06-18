# Birdie Num Num — v1.16.0

Expandable foursome contest lines. NO migration, app-only.

## What's new
In a four-ball / Trifecta foursome card, each contest line is now tappable and
expands to a hole-by-hole of how that score got there:
- Tap a line (e.g. "Amit v Ben · thru 5 · 2–3") to expand; tap again to collapse.
- Only ONE line is open at a time — opening another closes the previous, so the
  card never gets unwieldy.
- The expansion shows, for each played hole: the hole number, the two NET scores
  (the lower net that won the hole is bolded), who won the hole (player name for
  singles, team name for the team point), and the running score after that hole.
- Trifecta: all three lines expand (two singles + the team point). The team line
  shows each side's counting ball under Best ball, or each side's summed net under
  Shootout.
- Plain four-ball: the single match line expands the same way (best-ball net per
  hole), with running holes-won.
- Only holes that have been scored appear (matches "thru N").

## Engine
- TrifectaContest now carries a `perHole` array (hole, aNet, bNet, result, running
  aPts/bPts). Scoring totals are unchanged — the per-hole detail is the same data
  the engine already computed internally, now surfaced.
- New `fourballHoleDetail()` for the plain four-ball line.

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 115/115 pass (added 2 for the per-hole detail: nets, result,
  running tally ending at the totals, and aggregate summing)

## Smoke-test
- Trifecta: tap each of the three lines; confirm one-at-a-time open/close and that
  the hole nets + running score match the scorecard.
- Four-ball: tap the match line; confirm best-ball nets per hole.
