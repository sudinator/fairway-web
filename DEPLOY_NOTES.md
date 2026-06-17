# Birdie Num Num — v1.8.0

Adds the team option to four-ball, so every format except Stableford can be played
as a two-team (Red vs Blue) competition.

## What's new

1. Four-ball can now be a team game. At creation, four-ball shows the same
   "Team four-ball (Red vs Blue)" checkbox with two name fields that match and skins
   already have. (Match and skins were already team-capable; four-ball was the only
   non-Stableford format that wasn't.)

2. Ryder-Cup rollup. When four-ball is a team game, each 2-v-2 foursome is worth a
   point to the winning side's team; a halved foursome is half a point each; the team
   total is the sum across all foursomes. The play view shows a Red-vs-Blue scoreboard
   (projected from current foursomes, plus the decided tally), the same scoreboard
   match play uses.

3. Foursome pairs are labelled by team name in the play cards when teams are on.

## How to run a team four-ball

- Create -> Four-ball -> tick "Team four-ball", name the two teams.
- Setup -> Teams: assign each player to a team.
- Setup -> Matchups: build each foursome as one team's pair vs the other team's pair.
  (Keep each pair single-team; the rollup reads the team of each side.)
- Setup -> Groups: order the foursomes.
- Play: the Red-vs-Blue scoreboard sits above the foursome cards.

## SQL migrations

NONE. Uses the existing teams / foursomes columns.

## Verified locally

- tsc --noEmit: clean
- next build: passes (7 routes)
- Unit tests: 102/102 pass (the underlying foursome result, fourballStatus, is already
  covered; the rollup is a sum over those results)

## Smoke-test suggestion

Create a team four-ball with two foursomes (one pair Red, one pair Blue in each),
enter a few holes, and confirm the Red-vs-Blue total at the top moves as foursomes
swing, and that a clinched foursome shows in the "decided" tally.

## Note / limitation

The four-ball foursome builder still labels the two sides PAIR 1 / PAIR 2 while you're
assigning (the team names show on the play cards). If you'd like the builder itself to
show team names while assigning, that's a quick follow-up.
