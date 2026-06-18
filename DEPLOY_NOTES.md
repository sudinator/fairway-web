# Birdie Num Num — v1.18.0

WHS-correct playing handicaps (allowance on the UNROUNDED course handicap).
NO migration, app-only. This is a core scoring change.

## What changed and why
Since the April 2024 WHS revision, handicap allowances are applied to the
UNROUNDED course handicap, with a single round at the very end (R&A Appendix C;
USGA FAQ). The app was double-rounding: it rounded the course handicap first,
then applied the allowance, then rounded again.

Worked example — index 13, rating 66.4, slope 114, par 70, 85% allowance:
- Unrounded course handicap = 13 x (114/113) + (66.4 - 70) = 9.515
- Course handicap shown (rounded) = 10
- Playing handicap = round(9.515 x 0.85) = round(8.09) = 8   <- WHS / GHIN
- Old app result = round(round(9.515) x 0.85) = round(10 x 0.85) = round(8.5) = 9

So the app showed 9 where GHIN shows 8. Now fixed: every stroke calculation
(scorecard dots, strokes summary, four-ball/trifecta nets, singles match, skins,
and the organizer "plays" display) uses the unrounded course handicap as the
basis and rounds once. Display of the course handicap itself stays rounded.

Impact: only formats with an allowance below 100% can change (four-ball,
trifecta, etc.), and only by one stroke at a rounding boundary. Singles match,
Stableford, and individual skins at 100% are unchanged. Existing in-progress
games at <100% may see a player's strokes shift by one toward the WHS value.

Mechanism: a single `chBasis(player, par)` helper returns the unrounded course
handicap (from the stored index/slope/rating/par), falling back to the stored
rounded handicap for legacy guests with no index. All allowance math routes
through it, so the card and every summary stay consistent.

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 118/118 pass (added 3 locking index 13 / 66.4 / 114 / par 70:
  course handicap 10, playing handicap 8 at 85%, and 10 at 100%)

## Smoke-test
- 85% four-ball/trifecta with a player at index ~13 on a 66.4/114/par-70 tee:
  confirm strokes match GHIN (8, not 9), and that the scorecard dots and the
  strokes summary agree.
- A 100% game: confirm nothing changed.
