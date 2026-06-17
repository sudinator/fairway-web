# Birdie Num Num — v1.6.0 (Stage 1 of the setup redesign)

This is the first of two stages. Stage 1 ships the contained, lower-risk pieces;
Stage 2 (the four-step setup reorg + team-named matchups + groups-from-matchups)
comes next as its own release.

## What's in this build

1. Stableford group scoring re-enabled. A Stableford game can now use tee groups,
   a per-group marker (self-claim / hand-off), the group card, and per-group finish —
   the same flow as match/four-ball/skins. Results stay individual; the marker is just
   entering everyone's cards. (This reverts the v1.0.32 decision that stripped group
   scoring out of Stableford.) Assign tee groups in Manage Game as usual.

2. In-round "Left / out". On the group card (four-ball and skins), the scorer/marker
   now sees a row of player chips — tap one to mark that player out mid-round. Holes
   already scored stay; every unplayed hole auto-scores net double bogey for the team.
   The "No-show" control in Manage Game still works for someone who never started; both
   set the same flag, and the confirm wording now covers both cases. A player's own
   posted round still includes only the holes they actually played.

3. Default tee confirmed. Every player already defaults to the course tee chosen at
   creation (organizer, guests, and players who join by code). No change needed.

## SQL migrations

NONE required. Stage 1 uses columns and RPCs that already exist in your Supabase
(no_show, tee_group, is_marker, group_locked; claim/release/finish group RPCs).

## Verified locally

- tsc --noEmit: clean
- next build: passes (7 routes)
- Unit tests: 102/102 pass

## What I can't verify (needs your environment)

- The live Vercel build and the PWA shell.
- Realtime / RLS against your actual Supabase.
- Two-device behavior. Please smoke-test:
  * A Stableford game with two tee groups: claim a group marker on one device,
    confirm the group card appears and the other group's players are read-only; finish
    one group and confirm it locks without ending the whole game.
  * A four-ball game: mid-round, tap a player chip on the group card to mark them
    out, confirm the unplayed holes show net double bogey in the team result and the
    played holes are unchanged.

## Next (Stage 2)

The adaptive four-step setup — Players & Tees -> Teams -> Matchups -> Groups, with
team-named matchup dropdowns and groups built from matchups/players — per the approved
mockups.
