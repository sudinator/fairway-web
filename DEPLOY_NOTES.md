# Birdie Num Num — v1.12.0

Live game-setup editing: change allowance, change format, and manage the roster
from the Game setup tab after a game has started. NO migration required.

This is stages 1-3 of the larger plan we scoped. Trifecta (the new format) and
the leave-mid-match re-pair flow are the next build — they each need their own
scoring engine and tests, so they're deliberately not in this drop.

## What's new

1. Handicap-allowance editor (Game setup → Players). Change a live game's
   allowance (100 / 90 / 85) any time. Views read it live, so strokes and
   standings recompute on the next refresh. This is what reconciles the
   "85% gives one fewer stroke" question — you can now see and flip it.

2. Format change on a live game (Game setup → Players → Format). Guard rails:
   once any score is entered you can switch to Stableford or Skins anytime
   (no matchups needed); Match is offered only if pairings already exist and
   Four-ball only if foursomes exist (so you never lose or fake a matchup).
   Before any score, all four are open. Pairings/foursomes/teams are kept in
   place when unused, so switches are reversible. On switch, allowance
   auto-moves to that format's usual number (four-ball 85%, else 100%) and
   stays editable. Every scorecard is preserved — format only changes how the
   same gross scores are scored.

3. Roster picker on the Players step. The cramped add-dropdown is replaced with
   a tap-to-add list of your group (under "Add from your group"), plus guest
   add — reached anytime via the Game setup tab. Removing a player who already
   has scores now asks for confirmation and points you to No-show instead if
   they simply left mid-round.

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 102/102 pass

## Smoke-test
- Mid-round, open Game setup → flip allowance 85 -> 100 and confirm strokes change.
- In a match game with scores, confirm you can switch to Stableford/Skins but
  Four-ball is greyed out (no foursomes); in a four-ball, the reverse.
- Add a group member and a guest from the Players step; try removing a player
  who has scores and confirm the warning appears.

## Still to come (next build)
- Trifecta format (2 singles + team point per hole; Best ball / Shootout toggle;
  2v1 handling; pending holes under Shootout).
- Player-leaves-mid-match: re-pair the opponent as a segmented match (resets all
  square at the switch hole) or play out solo.
