# Birdie Num Num — v1.15.0

Strokes summary panel. NO migration, app-only (reads existing columns).

## What's new
A read-only "Strokes" panel that shows the whole field who gives/gets strokes
once pairings/foursomes are set:

- 1-v-1 element (singles match, the singles inside Trifecta): each pairing shows
  who plays off scratch and which actual holes the other player gets a stroke on,
  e.g. "Amit plays off scratch. Raj — strokes on 3, 5, 6, 11, 15". Handles the
  wrap case past 18 ("a stroke on every hole, + 2nd on 3, 5, 11, 15"), the single
  ("stroke on 3"), and even matches ("Even match — no strokes").
- Team-only legs (four-ball; the Trifecta team point): each player's course
  handicap + strokes received off the foursome's low, grouped by team colour.
  Labelled "Team point · best ball" or "· shootout" to match the mode.
- Trifecta foursomes show both: the two singles rows + the team strip.
- Hole numbers come from the same allocateStrokes the scorecard dots use, so the
  panel and the per-hole dots always agree. Numbers reflect the current allowance.

## Where it shows
- Play screen, near the top (under the format banner / round clock), collapsible,
  for everyone (read-only).
- Matchups tab for the organizer, always open, while arranging pairings.
- Before pairings/foursomes exist it says "Set the matchups to see strokes".
- Individual Stableford / individual skins: panel does not render (no head-to-head).

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 113/113 pass

## Smoke-test
- Singles match: set pairings, confirm each row's scratch player + stroke holes
  match the orange dots on the group card.
- Trifecta: confirm two singles rows + team strip per foursome; flip
  Best ball <-> Shootout and confirm the team label changes.
- Four-ball: confirm the handicap + strokes-received strip by team.
- Change the allowance in Game setup and confirm the hole lists update.
- On a phone with a full foursome, confirm the collapsed/expanded panel doesn't
  crowd the screen.
