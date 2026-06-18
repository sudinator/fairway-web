# Birdie Num Num — v1.19.0

Reset-for-testing + pace-of-play reminder. NO migration, app-only.

## 1. Reset scores (organizer)
New "↺ Reset scores" button in Game setup (amber, between End game and Delete).
Clears every player's scores, putts, fairways, penalties/sand, and the round
clock back to zero, and reopens the game if it had been ended. KEEPS the players,
teams, and matchups. Use it to wipe dummy scores after testing the setup.
- Caveat: if a test game was already ENDED, each player's scorecard was posted to
  their Rounds tab at that moment. Reset can't remove those (each player owns
  their own rounds via RLS) — reset before ending, or delete the stray round from
  Rounds. (A confirm dialog spells this out.)

## 2. Pace-of-play reminder
A pace indicator now rides on the existing round clock (per group):
- Target pace scales with the group's size: 6 + 2 x players minutes/hole — so a
  2-ball = 10, 3-ball = 12, 4-ball = 14 min/hole. Each group is judged against its
  own size (a 3-player group isn't held to a 4-player group's time).
- "Holes done" is the group's leading edge — the most holes any player in the
  group has scored.
- On schedule: a quiet green "On pace" pill next to the clock.
- More than 10 minutes past expected: an amber "~N min behind" pill plus a one-
  line "keep it moving" nudge. Passive, on-screen, for everyone in the group
  (no push notifications).
- Shows once at least one hole is scored; hidden after the round ends.

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 118/118 pass

## Smoke-test
- Reset: enter a few dummy scores, hit Reset scores, confirm scores + clock zero
  out and players/teams/matchups remain.
- Pace: in a tee-grouped game, enter scores and let time pass; confirm a 3-player
  group's target is 12 min/hole and a 4-player group's is 14, and the amber nudge
  appears only when >10 min behind.
