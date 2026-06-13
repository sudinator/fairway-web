# Birdie Num Num — Database Schema & Conventions

This is the single source of truth (in the repo) for what the app expects the
database to look like. The **authoritative** schema lives in Supabase; this file
documents it and how to keep them in sync.

> **Reconstruction notice:** the schema here and in
> `supabase/migrations/0001_baseline.sql` was reconstructed from the app code and
> the history of manual `alter table` changes. Verify it against a real Supabase
> export (see "Exporting the real schema" below) and correct anything that differs.

---

## Migration convention

- All schema changes live in `supabase/migrations/` as numbered SQL files:
  `0001_baseline.sql`, `0002_add_xyz.sql`, …
- Each file is **idempotent** where possible (`if not exists`, `add column if not
  exists`) so re-running is safe.
- **Process going forward:** any DB change ships as a new numbered migration file
  committed *with* the code that needs it. Run it in Supabase, then commit. The
  repo then always records exactly what structure the deployed app expects.
- Never edit an already-committed migration; add a new one.

---

## Tables

### profiles — one row per signed-in user (`id` = `auth.users.id`)
`id`, `display_name`, `email`, `handicap_index`, `ghin_number`, `phone`,
`is_admin` (app-admin gate for the admin panel), `deactivated` (blocks app
access), `active_group_id` (currently selected group), `last_active`.

### groups
`id`, `name`, `created_by`, `status` (`active`/`pending`/`declined` — new groups
need admin approval), `request_note`.

### group_members
`id`, `group_id`, `user_id`, `email`, `role` (`member`/`admin`), `status`
(`active`/`removed`). Email is stored so invites can be matched before a user
has a profile.

### favorite_courses — canonical, community-shared course records
`id`, `name`, `location` (Town, State), `tees` (jsonb), `holes` (jsonb),
`created_by`, `vetted` (admin-marked shared course, ★), `deleted` /`deleted_by`/
`deleted_at` (soft delete). **`favorite_courses_name_unique`** enforces global
name uniqueness for the shared library — **do not drop it.**

### group_courses — link table
`group_id` ↔ `course_id`. Which groups have adopted which vetted course. One
canonical course row, linked to many groups (no copies).

### rounds
`id`, `user_id`, `course`, `tee_name`, `rating`, `slope`, `course_par`,
`handicap_index`, `course_handicap`, `gross_score` (set only for total-only
rounds), `group_id`, `status` (`final`/`in_progress` — in-progress rounds are the
background auto-save backup and are hidden from the rounds list), `played_at`.

### holes — per-hole detail for a round
`id`, `round_id`, `hole_number`, `par`, `stroke_index`, `strokes`, `putts`,
`fairway` (`hit`/`miss`/null), `penalties`.

### games
`id`, `code` (join code), `name`, `course`, `course_par`, `holes_meta` (jsonb
`[{n,par,si}]`), `group_id`, `game_type` (`stableford`/`match`/`fourball`),
`status` (`active`/`ended`), `pairings` (jsonb, singles match `[{a,b}]`), `teams`
(jsonb, team match `[{key,name}]`), `foursomes` (jsonb, four-ball
`[{id,name,a:[],b:[]}]`), `created_by`.

### game_players
`id`, `game_id`, `user_id`, `display_name`, `email`, `handicap_index`, `rating`,
`slope`, `tee_name`, `course_handicap`, `scores` (jsonb per hole), `putts`,
`fairways`, `team` (`A`/`B` for team match).

### activity_log — admin audit trail
`id`, `actor_id`, `actor_name`, `action`, `group_id`, `target_user_id`,
`summary`, `created_at`. Captures events going forward only.

### notifications
`id`, `user_id`, `message`, `read`, `created_at`.

---

## RPCs

- **`create_group_invite(...)`** — creates/stores a 6-digit invite code for a group.
- **`redeem_group_invite(code text) → group_id`** — adds the caller to the group
  for that code and returns the group id. Used by `/join/[code]`.

Export the exact bodies from Supabase and paste them into the baseline migration
when you want the file to fully recreate the DB from scratch.

---

## RLS policies the app ASSUMES (verification checklist)

The app cannot read your live RLS policies, so this is the set of permissions the
code relies on. **Verify each in Supabase → Authentication → Policies.** If a
write "silently fails," it's almost always a missing/too-strict policy here.

**profiles**
- A user can `select`/`update` their own row (`id = auth.uid()`).
- A user can read other profiles in their groups (for rosters/leaderboards).
- App-admins (`is_admin = true`) can `select`/`update`/`delete` any profile
  (handicap edits, deactivate, hard-delete).

**groups / group_members**
- A user can read groups they belong to, and their own memberships.
- Group admins can insert/update/remove members of their groups.
- App-admins can read all groups/memberships and modify any (global management).
- `redeem_group_invite` typically runs `security definer` so it can insert a
  membership regardless of the caller's direct rights.

**rounds / holes**
- A user can full-CRUD their own rounds and the holes of their own rounds.
- Group members can read each other's rounds if your group features require it.
- App-admins can read/update/delete any round & holes (admin score editing,
  hard-delete).

**games / game_players**
- Group members can read games in their group and insert/update their own
  `game_players` row (score entry).
- The game creator can update the game (`pairings`, `teams`, `foursomes`,
  `status`, rename) and manage its players.

**favorite_courses / group_courses**
- Authenticated users can read vetted courses and insert new ones.
- Editing a shared course affects all groups (intended).
- App-admins can mark `vetted` and soft-delete.
- Any group member can insert a `group_courses` link to adopt a vetted course.

**activity_log / notifications**
- Inserts allowed for the acting user; admins can read the full `activity_log`;
  users read their own `notifications`.

> If any admin/cross-user action fails silently, the matching policy above is the
> first thing to check.

---

## Exporting the real (authoritative) schema

To replace the reconstruction with an exact dump:

**Option A — Supabase CLI (best, includes RLS + RPC bodies)**
```
supabase login
supabase link --project-ref epmbsmykyrnoiccwnoxq
supabase db dump --schema public > supabase/migrations/0001_baseline.sql      # structure
supabase db dump --schema public --data-only > supabase/seed.sql              # optional data
```
The CLI dump includes tables, indexes, RLS policies, and function bodies — commit
it as the real baseline and delete the reconstruction note.

**Option B — Dashboard**
Supabase → Database → (schema visualizer / SQL editor). You can run
`select` against `information_schema` and `pg_policies` to list columns and
policies, or use the table editor's "export" where available.

**Option C — pg_dump directly**
```
pg_dump --schema-only --no-owner "postgresql://...connection string..." > schema.sql
```
(Connection string is in Supabase → Project Settings → Database.)

Once you have a real dump, reconcile it against `0001_baseline.sql`, fix any
differences, and from then on add changes only as new numbered migrations.
