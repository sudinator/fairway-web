# Birdie Num Num — v1.15.2

Strokes panel now shows the playing handicap (after allowance). NO migration.

## Changed
- The strokes summary showed each player's raw course handicap ("ch 8") while the
  strokes were computed off the allowance-adjusted number — so a player could see
  "ch 5" but get strokes on only 4 holes. Confusing. The panel now shows the
  PLAYING handicap after the allowance ("ph 7" = 85% of 8), so the number on
  screen is the basis the strokes actually come from.
  - 1-v-1 rows: both players' playing handicaps; the difference is the strokes given.
  - Team strip: each player's playing handicap; strokes are that minus the
    foursome low (lowest plays off scratch).
  - Added a one-line note: "ph — playing handicap, after the N% allowance."
- No change to scoring or the scorecard. (The group scorecard header still shows
  the course handicap; can align it to playing handicap too if wanted.)

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 113/113 pass

## Smoke-test
- In an 85% game, confirm the strokes panel shows the reduced (playing) handicap
  and that the stroke count = the difference between the two playing handicaps
  (1-v-1) or playing handicap minus foursome low (team).
- In a 100% game, confirm "ph" equals the course handicap.
