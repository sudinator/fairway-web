# Birdie Num Num — v1.9.0 (onboarding & clarity pass)

Five UX changes from the walkthrough, all additive — no scoring logic changed.

## What's new

1. Setup stepper + progress. The four-tab setup bar is now a stepper that shows
   status: each step is a dot with a check when complete, the current step is
   highlighted, and a line underneath tells you what's next. When everything's done it
   says "you're ready — switch to Scorecard." The first step adapts by format: Stableford
   reads "share the code so players can join anytime, even across tee times"; match /
   four-ball / skins read "add everyone before matchups."

2. On-course "pick a scorer" prompt. On the Group card, a group with no scorer now shows
   a clear card -- "Who's keeping Group N's card?" with "I'll keep score" (claims the
   marker) and "We'll each score our own." The cryptic group-tab marker is replaced with
   "Group N · needs scorer" / "Group N ✓".

3. Four-ball team builder is team-aware. When a four-ball is a team game, the foursome
   builder labels the two sides by team name and only offers that team's players for each
   side, so a foursome can't accidentally be mixed-team (which would skew the team total).

4. Inline guidance on every setup step (folded into the stepper's "what's next" line),
   e.g. "assign players to teams first" when the matchup pickers are empty, or "build the
   matchups first" on the Groups step before any exist.

5. Sharing + live status. The share-code button now uses the device share sheet when
   available (falls back to copy). The score screen shows a green "Live" dot — scores
   already auto-refresh every 60s and via realtime within ~1s, so ⟳ Refresh is just a
   manual nudge, not a requirement.

## SQL migrations

NONE.

## Verified locally

- tsc --noEmit: clean
- next build: passes (7 routes)
- Unit tests: 102/102 pass

## Smoke-test suggestions (two devices)

- Setup: watch the stepper dots tick to ✓ as you set handicaps, teams, matchups, groups,
  and the banner flip to "ready."
- On the course: open the Group card on a phone in a group with no scorer, tap "I'll keep
  score," and confirm the other phone goes read-only.
- Team four-ball: confirm each foursome side only lists its own team's players.
