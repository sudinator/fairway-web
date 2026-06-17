# Deploy notes — v1.0.35 (cumulative — full app, supersedes all prior)

## Database — run supabase/migrations/0010_self_claim_marker.sql
Adds claim_group_marker / release_group_marker RPCs (SECURITY DEFINER).
If not already run: 0002–0009.

## Self-service tee-group markers
- The marker is now chosen by the foursome on the course, not pre-assigned.
- In Game setup, "Tee groups" only splits players into groups (no ★ anymore).
- On the Group card, anyone in the viewed group sees:
  - "Keep score for this group" if no one is scoring it,
  - "Take over" (with confirm) if someone else is,
  - "Hand off" if it's them.
- Claiming only ever makes you the marker of YOUR OWN group and only touches the
  marker flag — never scores. One marker per group (claiming takes over).
- Everyone else sees their group live and read-only.

Verified locally against PostgreSQL: a player can claim only their own group,
claiming takes over within the group, groups are independent, release steps
down, and an ungrouped player is rejected.

## Still needs a two-device / live check
auth.uid(), realtime delivery of the marker hand-off, and the multi-group flow.
