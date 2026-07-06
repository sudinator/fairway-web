# Tee Times — scheduling for BNN

Native BNN scheduling so a group can post an upcoming outing and members RSVP. Built multi-group from the start; UI gated to TGC for phase 1 (same pattern as betting → Money), then opened up. Not a port of the standalone TGC app — equivalent functionality rebuilt in BNN's stack.

Called **Tee Times** (each row = one scheduled tee time / outing). Deliberately NOT "Rounds" — BNN already uses "rounds" for recorded rounds of golf tied to games.

## Locked decisions
- Name: **Tee Times**.
- **Event → game handoff is deferred** (later phase). For now the captain sets up the game manually via the existing create-game flow.
- **Guests** are a simple `guest_names text[]` on the RSVP row — NOT `group_guests`. A guest is just who a member is bringing (for the count/roster). If a guest later needs to be in a settled bet, they can be added as a `group_guest` at game time.
- Multi-group by design; TGC-gated UI in phase 1.

## Feature inventory
- **Create/manage tee times**: date, tee-off time(s), course (from the group's course library), a type label, max spots, signup-opens date, signup deadline, notes, status (upcoming/cancelled/completed), per-group display number. Edit + cancel (with confirm).
- **RSVP / availability**: In / Out / Maybe; "In" can add named guests; waitlist by signup order when full; change until deadline; past/post-deadline frozen for non-organizers with a late-change warning.
- **Roster, spots & nudges**: live spots-used / max / waitlist; "needs your response" list with tab badge + home banner; signups grouped In/Maybe/Out with handicaps.
- **Organizer controls**: sign up / mark out non-responders, promote waitlist, cancel, edit — organizer/admin only.
- **Captain**: assign per tee time from the "In" list; duties checklist (group-configurable with defaults when opened beyond TGC).
- **Notifications**: posted / deadline-approaching / non-responder nudges — reuse existing `notifications` + `group_activity`.
- **Handoff (deferred)**: later, spawn/link a BNN game from the "In" list + groups. For now, captain creates the game manually.
- **Exports**: "Copy tee-time info" text for WhatsApp — reuse existing share/summary patterns.
- **Views**: Home (pending + my upcoming), a Tee Times tab (upcoming/past/cancelled), detail with info/signups/activity sub-tabs.

## Reused (not rebuilt)
Course library (`favorite_courses`: pars, stroke index, yardages, tees) · `profiles` handicaps + course-handicap calc · `group_members.role` for permissions · `notifications` + `group_activity` for alerts/audit · roster RPCs for names · Supabase Auth · the existing game/scoring/betting/Money engine (future handoff target).

## New data model
- `tee_times` — the scheduled outing (group_id, created_by, seq, title, kind, course, play_date, tee_off_times[], signup_opens_at, signup_deadline, max_spots, notes, status, captain_user_id, game_id [future], timestamps).
- `tee_time_rsvps` — one row per member (tee_time_id, user_id, choice in/out/maybe, guest_names[], signup_order, responded_at; unique per tee_time+user).

RLS mirrors the money tables: any active group member reads; organizer/admin (role in admin/owner) or creator manages; a member writes their own RSVP, organizer/admin writes anyone's.

## Multi-group design
Every table carries `group_id`; permissions key on `group_members.role`. Type labels and captain duties are group-configurable with defaults, so nothing TGC-specific lives in the data — the only TGC-specific thing in phase 1 is a UI gate we later remove.

## Phases
- **P0 — Schema & RLS** (migration 0057). No UI. ← current.
- **P1 — Core loop (TGC-gated)**: create/list/view tee times; RSVP (In/Out/Maybe + guests + waitlist); spots; pending nudges (home banner + tab badge).
- **P2 — Organizer & captain**: sign up/mark out others, waitlist promotion, cancel/edit, signup deadline + late-change warnings + past freeze, captain + duties.
- **P3 — Exports & notifications**: WhatsApp tee-time info; posted/deadline/nudge notifications.
- **P4 — Game handoff**: spawn/link a BNN game from the "In" list with pre-built groups.
- **P5 — Open to all groups**: remove TGC gate; group settings for type labels + captain duties.

## Open items
- Per-group display number (`seq`): compute client-side (max+1) in P1, or a trigger. Leaning client-side to start.
- Course reference: store course name text now (display), resolve to full course at game creation.
