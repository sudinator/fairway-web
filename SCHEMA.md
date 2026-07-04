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

---

## Additions since the v1.0.18 live export (migrations 0014-0041)

The verified section above reflects an old live export. The items below are drawn
from the committed migration files (not a fresh live re-export), and bring this doc
current through migration 0041. Treat the migration files as authoritative if they
ever disagree with this summary.

### New / changed columns
- **profiles**: `banned` (bool, default false; 0032). A profile is set banned by
  `admin_set_banned` or born banned via the `banned_emails` trigger (0038).
- **groups**: `is_default` (bool; 0030) - only one group may be the default
  (partial unique index). Stranded users land in the default group.
- **group_members**: `is_support` (bool; 0028) - a temporary master-admin support
  membership; `support_started_at` (timestamptz; 0039) - when that session began
  (reaped after 12h by `expire_support_sessions`).
- **games**: `game_type` now also includes `trifecta` (0016) and `stroke` (0035).
  Added columns: `marker_user_id` (0006), `share_token` (0018, powers the live link),
  `ended_at` (finish timestamp), `scores_reset_at` (0023), `team_score_mode`
  (best_ball/aggregate; trifecta + four-ball), `trifecta_scoring` (per_hole/match;
  0024), `stroke_basis` (gross/net; 0035), `skins_mode` (carryover/split; 0036),
  `tee_groups`-related fields per 0009.
- **game_players**: beyond `scores`/`putts`/`fairways`, also `penalties` and `sand`
  (jsonb; 0004/0008), `is_marker` + `tee_group` + `group_locked` (0009), `scored_by`
  (0022), `clock_start`/`clock_end` (0014), `avatar_url` (0019), `is_guest` (0007).

### New tables
- **banned_emails** (0038): `email` (citext PK), `reason`, `created_at`. Written only
  by SECURITY DEFINER functions (ban/wipe sync); admin-only read via RLS.
- **feedback** (0037): `id`, `user_id`, `user_name`, `kind` (bug/wish/question),
  `message`, `app_version`, `group_id`, `context`, `status` (new/triaged/done),
  `created_at`. RLS: insert own; select own-or-admin; update/delete admin-only.

### New / notable functions
- **Live**: `get_live_scorecard(token)` (0018, re-created 0021 + 0041) - public,
  alias-keyed read; now returns `trifecta_scoring` and `stroke_basis`.
- **Scoring**: `set_game_scores` / scorecard-ownership RPCs (0022), `reset_game_scores`
  (0023), `finish_game` + `post_game_rounds` (0011/0026), `post_group_rounds` (0045, posts every player in a tee group when the group finishes), `validate_game_player_scores`
  trigger + `_valid_num_array` (0040, optional).
- **Default group**: `join_default_group(email)` (0030; refuses blocklisted emails per 0038),
  `admin_set_default_group`.
- **Master-admin** (all SECURITY DEFINER, gated by `is_admin()`): `admin_group_overview`,
  `admin_set_group_status`, `admin_delete_group`, `admin_merge_group`, `admin_list_users`,
  `admin_set_banned`, `admin_wipe_user`, `admin_merge_users(_preview)`,
  `admin_unblock_email` (0038), `admin_enter_group`/`admin_exit_group` (0028),
  `expire_support_sessions` (0039), `admin_revoke_group_invites`, game-repair RPCs (0031).
- **Guards/triggers**: `guard_profile_privileged_cols` (0033, blocks self-grant of
  is_admin/banned), `guard_new_profile_banned` (0038, born-banned), `is_admin`/
  `is_group_member`/`is_group_admin` fold in "not banned" (0034).

- games.structure_stash (jsonb, 0046): last team structure {teams,foursomes,pairings} kept when a mid-round format switch hides it, so switching back restores it. Player team assignments live on game_players.

- 0047_live_avatar.sql: get_live_scorecard now returns players[].avatar_url (from game_players.avatar_url) so the public live leaderboard can show photos/initials. No schema/column change.


## Money feature (migration 0048)
- group_guests: id, group_id, name, sponsor_user_id (member responsible), created_by, created_at. A non-app player; balances resolve to the sponsor.
- expenses: id, group_id, created_by, payer_user_id (member), description, category (bet|tee|food|other), amount_cents (int), currency ('USD'), split_type (even|custom), created_at, updated_at.
- expense_shares: id, expense_id (cascade), user_id XOR guest_id, share_cents. Sum of shares == expense amount_cents.
- expense_payers (migration 0049): id, expense_id (cascade), user_id, paid_cents (int). Multiple payers per expense; balances use these when present, else fall back to expenses.payer_user_id (which holds the primary payer). RLS via parent expense's group.
- expense_audit (migration 0050): id, expense_id (cascade), action ('created'|'edited'), actor_user_id, snapshot jsonb, created_at. Per-expense edit history; RLS via parent expense's group.
- settlements: id, group_id, from_user_id, to_user_id, amount_cents, method, created_by, created_at. Member-to-member only.
- profiles: + venmo_handle, paypal_handle, phone (optional, member-entered).
All money tables are RLS-gated by active group_members; integer cents; no money moves through the app (deep-link hand-off only). Logic lives in lib/money.ts (unit-tested in lib/money.test.ts).
