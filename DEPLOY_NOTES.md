# Birdie Num Num — v1.7.0 (Stage 2: setup flow redesign)

Builds on v1.6.0. This is the setup reorg you approved in the mockups.

## What's new

1. Adaptive four-step setup. Manage Game is now a stepped flow with a tab bar:
   Players & Tees -> Teams -> Matchups -> Groups. Steps auto-hide by format:
   * Stableford / casual individual: Players & Tees -> Groups (no Teams, no Matchups).
   * Match singles / 1:1 skins: Players & Tees -> [Teams] -> Matchups -> Groups.
     (Teams only appears when the game was created with two named teams.)
   * Four-ball / team best-ball skins: Players & Tees -> Matchups -> Groups
     (the foursomes you build in Matchups are the groups).

2. Players & Tees step. Just handicap, tee (defaults to the course tee), no-show,
   and remove — the clutter from the old single roster is gone.

3. Teams step (team games only). Each player has a tap-to-assign team toggle in the
   team's colour, with a live two-column summary of each side.

4. Team-named matchups. In singles match play / team 1:1 skins, when two teams are
   named the pairing pickers read the team names and each lists only that team's
   players, so every pairing is one-from-each-side. With no teams it falls back to
   the old Player A / Player B with everyone listed.

5. Groups step. Builds the tee groups that play (and score) together:
   * With matches (match / 1:1 skins): assign each match to a group — usually two
     matches per foursome.
   * With foursomes (four-ball / best-ball skins): each foursome is a group; the
     group number just orders who tees off first.
   * Individual (Stableford): drop players straight into foursomes / 3-balls / 2-balls.
   Assigning a unit sets the tee group for everyone in it, which drives group scoring
   (re-enabled for Stableford in v1.6.0). A live summary shows each group's members.

## SQL migrations

NONE required. This is a UI/flow reorg over columns/RPCs that already exist
(team, tee_group, pairings, foursomes, the group-marker RPCs).

## Verified locally

- tsc --noEmit: clean
- next build: passes (7 routes)
- Unit tests: 102/102 pass

## What I can't verify (please smoke-test on two devices)

- A team match-play game end to end: name two teams at creation, assign players on the
  Teams step, build cross-team pairings on Matchups (confirm the dropdowns show the team
  names), group two matches together on Groups, then confirm group scoring on the course.
- A Stableford game: Players & Tees -> Groups only; drop players into two groups and
  confirm a marker can keep each group's card.
- A four-ball game: build foursomes on Matchups, confirm they appear as groups on the
  Groups step.

## Notes / limitations

- Team assignment also still appears inside the Matchups (MatchView) setup as before;
  the Teams step is the cleaner place to do it, but both write the same field.
- The Groups step uses a per-unit group selector (dropdown) rather than drag-and-drop;
  same result as the mockup, just tap instead of drag.
