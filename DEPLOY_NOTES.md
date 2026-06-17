# Birdie Num Num — v1.10.0

Round clock, multi-use invite links, four-ball team colours/groups cleanup.

## RUN THESE MIGRATIONS FIRST (in Supabase, in order)

- migrations/0014_round_clock.sql      — two timestamp columns on game_players
- migrations/0015_multiuse_group_invites.sql — multi-use invite columns + 2 functions

0014 is trivial and safe. 0015 adds a NEW multi-use path and leaves the existing
one-time invite untouched; I authored it without the original function source, so
please smoke-test it (below).

## What's new

1. Round clock (pace of play). A per-group elapsed timer shows on the play screen.
   It starts the first time anyone in the group enters a score (no button needed —
   a Start option could be added later, but this is automatic), and freezes when the
   group's last hole is scored or the game ends. No pace warnings — just elapsed time,
   per group (so 8am and 10am groups each run their own clock).

2. Multi-use invite links. In the group admin panel you can now pick "Lasts 24 hours",
   "7 days", or "One-time (single player)". The timed options create a link the whole
   group can use until it expires; one-time keeps the old single-player behaviour. The
   /join/[code] route accepts both.

3. Four-ball team colours fixed. Team accent colours now follow the team NAME when it's
   a colour word — name a team "Red" and it shows red, "Blue" shows blue (previously the
   colour was keyed off team position, so "Red" could appear blue). Custom names fall
   back to the default palette. Applies to the Teams step and both team scoreboards.

4. Four-ball Groups step removed (it was redundant). Each foursome is now automatically
   its own tee group, so group scoring lines up with the foursomes you build — no extra
   "Groups" step for four-ball / best-ball skins.

## Verified locally

- tsc --noEmit: clean
- next build: passes (7 routes)
- Unit tests: 102/102 pass

## Smoke-test (two devices / two accounts)

- Invite link: as a group admin, generate a 24-hour link; open it from two different
  accounts and confirm both land in the group, and that an expired/used-up link is
  refused.
- Round clock: enter a score in a group and watch the timer start; score the 18th hole
  (or end the game) and confirm it freezes.
- Four-ball: name teams "Red"/"Blue" and confirm the colours match; confirm there's no
  Groups step and each foursome can claim its own scorer on the course.
