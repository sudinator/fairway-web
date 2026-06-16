# Deploy notes — v1.0.25 (cumulative — full app, supersedes all prior)

## Database
- No NEW migration in this version.
- If not already run: 0002 (match date), 0003 (allowance), 0004 (holes.sand).

## Deploy
Copy over the repo → commit & push → Vercel auto-deploys.

## Fixes in v1.0.25
- Finished-round scorecard: the Sand/Pen column was too narrow (30px) and its
  header collided with "Pts". Widened to 40px and the header now stacks on two
  lines (Sand / Pen). The live entry card was already fine and is unchanged.
- Round date & match date now use a compact field showing a short date
  (e.g. 6/16/26) in a smaller box. The visible text is rendered in the page font
  (not the browser's native date-control font), so it matches every other input;
  tapping it still opens the normal date picker.
