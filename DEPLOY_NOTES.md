# Deploy notes — v1.0.19

## ⚠️ Run this database step FIRST (once), before/at deploy
Open Supabase → SQL editor → paste and run the contents of
`supabase/migrations/0002_games_played_at.sql`. It adds the `games.played_at`
column the new match-date feature writes to. It's safe to re-run. Until it's
run, creating a game would fail to save the date.

## Then deploy the code (your usual flow)
1. Copy these files over your `sudinator/fairway-web` repo (replace existing).
2. Commit & push in GitHub Desktop.
3. Vercel auto-deploys. The build stamps the new version (1.0.19) and the
   service worker, so phones will get the update prompt.

## What changed in this release
Bug fixes (code only, no DB change):
- Halved singles match now shows "AS" instead of a blank result.
- 9-hole gross-only rounds no longer show a bogus Stableford estimate — they
  show "—", and are excluded from the dashboard points average and trend.
- Custom courses can now be built at any par (incl. par-3/executive courses),
  instead of silently flooring at par 58.
- The admin course-change summary now reports blank→0 field edits correctly.

Enhancement (needs the migration above):
- Games now have a structured match date. The setup tab has a date picker
  (defaults to today), and a blank game name auto-fills as
  "Type / Course / Date" (e.g. "Four-Ball / Pebble Beach / Jun 15, 2026").

Docs:
- `SCHEMA.md` refreshed to match the live database (added the
  `course_change_requests` and `group_course_overrides` tables and several
  columns; the old "known gaps" are resolved).
