# Birdie Num Num — Database Schema & Conventions

Single source of truth (in the repo) for the database. **This version has been
verified against a live Supabase export** (information_schema, pg_policies,
pg_indexes) — it reflects the real database, not a guess.

---

## Migration convention
- Schema changes live in `supabase/migrations/` as numbered files (`0001_baseline.sql`, `0002_…`).
- Files are idempotent (`if not exists`) so re-running is safe.
- Each DB change ships as a new numbered file committed with the code; run it in Supabase, then commit. Never edit a committed migration.

---

## Schema status
Verified against a live `information_schema` export at app v1.0.18. The three
columns previously flagged as missing (`rounds.status`, `rounds.gross_score`,
`profiles.deactivated`) **now all exist** in the live DB, so those features no
longer silently no-op.

---

## Tables (verified)

**profiles** (`id` = auth.users.id): `display_name`, `email`, `handicap_index`, `ghin_number`, `phone`, `is_admin`, `active_group_id`, `last_active`, `updated_at`, `deactivated` (bool, default false), `dashboard_ai` (jsonb — saved dashboard AI summary).

**groups**: `id`, `name`, `created_by`, `status` (active/pending/declined), `request_note`, `created_at`.

**group_members**: `id`, `group_id`, `user_id`, `email` (**citext** — case-insensitive), `role` (member/admin), `status` (active/removed), `created_at`. Unique on (`group_id`, `email`).

**group_invites** (powers invite links): `id`, `group_id`, `invite_code`, `role`, `status`, `created_by`, `used_by`, `used_at`, `expires_at` (default now + 30 days), `created_at`.

**favorite_courses** (canonical, community-shared): `id`, `user_id` (default auth.uid()), `name`, `location`, **`data` (jsonb — holds tees + holes + meta, one column)**, `group_id`, `vetted`, `external_id` (text — golfcourseapi id), `facility` (text), `corrected` (bool, default false), `deleted`/`deleted_by`/`deleted_at`, `created_at`. Unique on (`group_id`, `name`) — per-group, not global. *(Note: `external_id`/`facility`/`corrected` exist both as columns and inside `data` — keep them in sync.)*

**group_courses** (link table): `id`, `group_id`, `course_id`, `added_by`, `created_at`. Unique on (`group_id`, `course_id`).

**group_course_overrides** (per-group course corrections that override the global record inside one group only): `id`, `group_id`, `course_id`, `name`, `location`, `data` (jsonb), `updated_by`, `updated_at`, `created_at`.

**course_change_requests** (admin approval queue for proposed global course edits): `id`, `course_id`, `group_id`, `submitted_by`, `proposed_name`, `proposed_location`, `proposed_data` (jsonb), `status` (default 'pending'), `reviewed_by`, `reviewed_at`, `reason`, `change_summary`, `created_at`.

**rounds**: `id`, `user_id`, `course`, `tee_name`, `rating`, `slope`, `course_par`, `handicap_index`, `course_handicap`, `group_id`, `played_at` (**date**, not null, default current_date), `created_at`, `gross_score` (int), `status` (text, default 'final'), `ai_analysis` (text), `game_id` (uuid — set when recorded from a finished game).

**holes**: `id`, `round_id`, `hole_number`, `par`, `stroke_index`, `strokes`, `putts`, `fairway`, `penalties`.

**games**: `id`, `code`, `name`, `course`, `course_par`, `played_at` (**date**, not null, default current_date — the match date), `allowance_pct` (numeric, not null, default 100 — handicap allowance for match/four-ball), `holes_meta` (jsonb), `group_id`, `game_type` (stableford/match/fourball/skins), `status` (active/ended), `pairings` (jsonb), `teams` (jsonb), `foursomes` (jsonb), `created_by`, `created_at`. Unique on `code`.

**game_players**: `id`, `game_id`, `user_id` (default auth.uid()), `display_name`, `handicap_index`, `rating`, `slope`, `tee_name`, `course_handicap`, `scores`/`putts`/`fairways` (jsonb), `team`, `no_show` (bool, default false), `created_at`. Unique on (`game_id`, `user_id`).

**activity_log**: `id`, `actor_id`, `actor_name`, `action`, `summary`, `group_id`, `target_user_id`, `created_at`.

**notifications**: `id`, `user_id`, `message`, `read`, `group_id`, `created_at`.

---

## Helper functions (exist in live DB)
- `is_admin()` → bool (caller is an app-admin)
- `is_group_member(group_id, user_id)` → bool
- `is_group_admin(group_id, user_id)` → bool
- `is_game_member(game_id)` → bool

## RPCs
- `create_group_invite(...)` → text (6-digit code)
- `redeem_group_invite(code text)` → uuid (group joined)

---

## RLS policies (VERIFIED from the live DB — these are real, not assumed)

**profiles**: read own or admin-all; update own or admin-all; insert own. ✓
**groups**: members/creator can select; authenticated can insert (creator = self); group-admins (and app-admins) can update. ✓
**group_members**: select if member/self/your-email; insert if group-admin or self-as-admin; update if group-admin or matching email (invite acceptance). ✓
**group_invites**: group-admins select/update/delete. ✓
**rounds**: own rounds full access; group members can select group rounds; group owner/admin can update/delete; admins read/update all. ✓
**holes**: own holes (via round ownership) full access; admins read/update all. ✓
**games**: anyone authenticated can select; creator inserts/updates/deletes; group members full access. ✓
**game_players**: edit own scores; join as self; organizer adds/updates/removes players; co-players can see each other. ✓
**favorite_courses**: read vetted or authenticated; anyone authenticated adds/edits; creator-or-admin deletes; group-member access by group_id. ✓
**group_courses**: authenticated read; active group members add/remove. ✓
**activity_log**: insert own; admins read. ✓
**notifications**: insert if signed in; read/update own. ✓

**Takeaway:** RLS is solid and consistent. Past "silent failures" were app-side
(localStorage/display), not permissions — except the missing-column gaps above,
which are the real cause of any deactivate/in-progress writes going nowhere.

---

## Exporting the authoritative schema (to refresh this doc)
**Supabase CLI (best — includes RLS + function bodies):**
```
supabase login
supabase link --project-ref epmbsmykyrnoiccwnoxq
supabase db dump --schema public > supabase/migrations/0001_baseline.sql
```
**Browser (no install):** run read-only queries against `information_schema.columns`,
`pg_policies`, `information_schema.routines`, `pg_indexes` in the SQL editor and
compare to this file.
