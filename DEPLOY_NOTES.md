# Birdie Num Num — v1.13.0

Trifecta — a new 2-v-2 format worth three points per hole (two singles + a team
point), with a Best ball / Shootout toggle on the team leg.

## RUN MIGRATION FIRST
- migrations/0016_trifecta.sql
  (1) drops any CHECK constraint on games.game_type so 'trifecta' inserts;
  (2) adds games.team_score_mode (text, default 'best_ball').
  Idempotent and safe to re-run. If your games table has no game_type CHECK
  constraint, step (1) simply does nothing.

## What Trifecta is
A 2-v-2 foursome plays for THREE points on every hole, all net:
  - two singles (each player vs their opposite number)
  - one team point
Points are tallied across 18 (up to 54 a group), and team totals sum every
group. Built on the existing four-ball net engine, so strokes are consistent
with four-ball and the single game allowance applies to everything.

## Team point — Best ball vs Shootout
At creation (and later in Game setup) you pick the team leg:
  - Best ball — the team's hole score is the better net of the two partners.
  - Shootout — both partners' net scores are ADDED; a blow-up by either hurts.
    The board header reads "Trifecta · Shootout".

## Other rules baked in
- Explicit singles matchups: each foursome shows who plays whom, with a
  "Swap who plays whom" button (the two ways to pair a 2-v-2).
- 2 v 1 groups: the lone player contests a single vs EACH opponent plus the
  team point (best-ball there even under Shootout) — a swept hole banks 3, a
  split nets 1. Tagged on the card.
- Shootout pending: if only one partner has a hole scored, the team point waits
  (shows a dash / "thru" doesn't advance) until both nets are in. Best ball
  resolves off the one ball.
- No-show/Left-out works as in four-ball (unplayed holes = net double bogey).

## How to run one
Create a game → pick "Trifecta (2 v 2)" → name the two teams → choose Best ball
or Shootout. After creating, open Game setup → Matchups to build the foursomes
(each side lists only its own team). Each foursome is its own tee group, and the
play screen shows the three contests per group plus the running team total.

You can also switch an existing four-ball to Trifecta (and back) from
Game setup → Format — the foursomes carry over.

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 113/113 pass (incl. 11 new Trifecta engine tests covering sweep,
  the Shootout flip, 2v1 split, halves, and pending holes)

## Smoke-test (real data)
- Create a Trifecta, build a 2-v-2 foursome, enter a few holes, and confirm the
  card shows two singles + a team line and the Red/Blue total moves by up to 3 a hole.
- Flip Best ball <-> Shootout in Game setup and confirm a partner's blow-up
  changes the team point under Shootout.
- Try a 3-player foursome (2 v 1) and confirm the lone player gets a single vs
  each opponent and the team line tags "2 v 1 — best ball".

## Still to come (next build)
- Player-leaves-mid-match re-pair: segmented match that resets all square at the
  switch hole, or play out solo. (Design locked; not in this drop.)
