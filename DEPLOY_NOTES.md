# Birdie Num Num — v1.14.0

Three group-card / setup formatting fixes. NO migration, app-only.

1. Team selector fills with the team colour. On the Players step, the chosen
   team chip is now filled solid with that team's colour (dark text for
   contrast) instead of just an outline — easy to see who's on which side.

2. Team-match group scorecard orders opponents together. In a singles match the
   player COLUMNS are reordered so each match's two players sit side by side,
   with a slim divider between matches. Each column's underline now uses the
   real team colour (it used to alternate blue/gold by position). Foursome
   formats order Pair A then Pair B. Display-only — scoring/marking unchanged.

3. Stableford group scorecard is alphabetical. Player columns are sorted A->Z
   by name.

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 113/113 pass

## Smoke-test
- Team match: open the group card and confirm opponents are adjacent columns,
  with team-coloured underlines and a divider between matches.
- Stableford: confirm the group card columns are in alphabetical order.
- Players step: pick a team and confirm the chip fills with the team colour.
