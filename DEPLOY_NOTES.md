# Birdie Num Num — v1.20.0

Integrity / workflow hardening from the code review. NO migration, app-only.
(Uses existing tables/columns. One new operation — deleting a round's holes on
re-post — relies on the player owning their own round under RLS; if a reopened
round fails to refresh its hole detail, check the holes delete policy.)

## 1. Concurrency / stale-write hardening
- Background flush (screen lock / app switch) now bails when someone ELSE is the
  marker for your group. The marker owns your row in that case, so a stale
  background write from your device can no longer overwrite their latest entry.
- The local score backup now stays in sync when the marker edits their OWN row
  (blanks included), so load()'s recovery merge can't resurrect a score the
  marker just cleared. Closes the same class of bug behind the earlier reset
  issue, at its other trigger (the marker's clear-hole button).

## 2. Reopen now updates the posted round
Ending a game posts each player's scorecard to their Rounds. If a game is
reopened, edited, and re-ended, the posted round is now UPDATED in place (gross +
full hole detail replaced) instead of left frozen — so corrections flow through
to differentials, par averages, and the dashboard.

## 3. Join uses the organizer's course params
A player joining by code now copies rating / slope / tee from the ORGANIZER's
row (always populated, since they set up the game), instead of an arbitrary
existing player. Falls back to any player with a rating if the organizer row is
missing. Removes the case where a joiner got nulls and silently received no
strokes.

## 4. Clearer "who's keeping score" for newcomers
When a marker is active, a read-only player now sees a short note where their own
scorecard would be — "[Name] is keeping score… scroll up to the group card to
follow along live; you can take over from there" — so a first-timer isn't left
hunting for a card that's intentionally hidden. (The existing claim explainer and
live banners are unchanged.)

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 118/118 pass

## Smoke-test (needs two devices for the marker items)
- Marker scoring: with a marker active on one phone, background the read-only
  phone mid-round; confirm the marker's entries are NOT overwritten.
- Marker clears one of their OWN holes, then pulls to refresh; confirm it stays
  cleared (doesn't bounce back).
- Reopen: end a game, reopen it, change a score, re-end; confirm that player's
  Rounds entry and dashboard reflect the change.
- Join: create a game, have a second account join by code; confirm they get the
  organizer's tee rating/slope and receive strokes.

## Note (build refresh)
The stale-write guard and the recovery merge were extracted into pure, unit-
tested helpers (markerOwnsMyRow, mergeScoreArrays in lib/golf.ts). The guard now
ALSO covers the whole-game marker (not just per-tee-group markers). 12 new tests
reproduce the clobber and prove the guard prevents it; 130 tests pass total.
