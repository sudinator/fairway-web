# Birdie Num Num — v1.11.0

Add/remove players after kickoff, an easier player picker, and odd-number match play.

## NO migration required (all client-side; uses existing columns/RPCs).

## What's new

1. Add players & guests after the game starts. On the setup Players step there's now an
   "Add to the field" block: pick a group member who isn't in yet, or add a guest by name
   + course handicap. New players inherit the tee already in use and get a blank card.
   Removing players was already there. (Forgot someone or a walk-up shows up — no need to
   recreate the game.)

2. Easier player picker at creation. Rows are taller with bigger, easier-to-tap
   checkboxes and a highlight on the ones you've selected, and a live "N players selected"
   counter sits next to the heading — much better with 10-12 names.

3. Odd numbers in match play. The pairing pickers now list everyone (not just the
   not-yet-paired), marking anyone "· in a match." So with an odd field you can give a
   player a second opponent — their card is scored against both — and nobody sits out.
   Exact duplicate pairings are blocked.

## Verified locally

- tsc --noEmit: clean
- next build: passes (7 routes)
- Unit tests: 102/102 pass

## Note / limitation

For a player who's in two matches at once, each match result is computed correctly and
independently. The only cosmetic gap: that player's own per-hole stroke dots show the
strokes vs their FIRST opponent (the match cards and team rollup are all correct). Tell
me if you want the dots to switch per match and I'll add a selector.

## Smoke-test

- Start a game, then on the Players step add a guest and a group member; confirm they
  appear with the right tee/handicap and can be scored.
- Match play with 5 players: pair 1v2 and 3v4, then pair player 5 against player 1
  (who shows "· in a match"); confirm both of player 1's matches resolve.
