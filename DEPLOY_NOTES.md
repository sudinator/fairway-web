# Deploy notes — v1.0.26 (cumulative — full app, supersedes all prior)

## Database
- No NEW migration. If not already run: 0002, 0003, 0004.

## Deploy
Copy over the repo → commit & push → Vercel auto-deploys.

## Fixes in v1.0.26
- Individual round: the date box now drops onto its own line below the
  "Date played" label (it was sitting inline against the label). Same for the
  match date.
- Sand/Pen cell display (S, the penalty number, or *) is now shown in red on
  both the entry card and the finished-round scorecard, and in the popup preview.
