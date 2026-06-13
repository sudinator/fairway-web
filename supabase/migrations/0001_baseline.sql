-- ============================================================================
-- Birdie Num Num — baseline schema (migration 0001)
-- ============================================================================
-- This file was VERIFIED against a live Supabase export (information_schema +
-- pg_policies + pg_indexes) and corrected to match the real database, with two
-- additions the app code expects that were missing from the live DB:
--   * rounds.status      (in-progress vs final, for round auto-save backup)
--   * rounds.gross_score (total-only rounds)
-- Both are added below with `if not exists` and safe defaults.
--
-- Everything here is SAFE / IDEMPOTENT (`if not exists`), so running it against
-- the existing database only fills in anything missing; it never drops data.
-- RLS policies are documented in SCHEMA.md (they already exist in the live DB
-- and are not recreated here).
-- ============================================================================

-- ---------- profiles (id = auth.users.id) ----------
create table if not exists profiles (
  id uuid primary key,
  display_name text,
  email text,
  handicap_index numeric,
  ghin_number text,
  phone text,
  is_admin boolean not null default false,
  active_group_id uuid,
  last_active timestamptz,
  updated_at timestamptz default now()
);
-- NOTE: the live DB has no `deactivated` column. If you want the admin
-- "deactivate player" feature to persist, add it:
--   alter table profiles add column if not exists deactivated boolean not null default false;

-- ---------- groups ----------
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid,
  status text not null default 'active',   -- 'active' | 'pending' | 'declined'
  request_note text,
  created_at timestamptz not null default now()
);

-- ---------- group_members (email is citext) ----------
create table if not exists group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  user_id uuid,
  email citext not null,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- ---------- group_invites (powers invite links) ----------
create table if not exists group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  invite_code text not null,
  role text not null default 'member',
  status text not null default 'active',
  created_by uuid,
  used_by uuid,
  used_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

-- ---------- favorite_courses (course data stored as one jsonb column) ----------
create table if not exists favorite_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  location text,
  data jsonb not null,            -- holds tees + holes + meta
  group_id uuid,
  vetted boolean not null default false,
  deleted boolean not null default false,
  deleted_by uuid,
  deleted_at timestamptz,
  created_at timestamptz default now()
);
-- Per-group name uniqueness (live DB uses group-scoped, not global):
create unique index if not exists favorite_courses_group_name_unique on favorite_courses (group_id, name);

-- ---------- group_courses (link table) ----------
create table if not exists group_courses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  course_id uuid not null,
  added_by uuid,
  created_at timestamptz not null default now()
);

-- ---------- rounds ----------
create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  course text,
  tee_name text,
  rating numeric,
  slope numeric,
  course_par int,
  handicap_index numeric,
  course_handicap int,
  group_id uuid,
  played_at timestamptz default now(),
  created_at timestamptz default now()
);
-- Columns the app expects that were missing from the live DB (added now):
alter table rounds add column if not exists status text not null default 'final';     -- 'final' | 'in_progress'
alter table rounds add column if not exists gross_score int;                            -- total-only rounds

-- ---------- holes ----------
create table if not exists holes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null,
  hole_number int not null,
  par int not null,
  stroke_index int,
  strokes int,
  putts int,
  fairway text,
  penalties int default 0
);

-- ---------- games ----------
create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  course text not null,
  course_par int,
  holes_meta jsonb not null,
  group_id uuid,
  game_type text not null default 'stableford',   -- 'stableford' | 'match' | 'fourball'
  status text not null default 'active',           -- 'active' | 'ended'
  pairings jsonb not null default '[]'::jsonb,
  teams jsonb,
  foursomes jsonb,
  created_by uuid not null default auth.uid(),
  created_at timestamptz default now()
);

-- ---------- game_players ----------
create table if not exists game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  user_id uuid not null default auth.uid(),
  display_name text not null,
  handicap_index numeric,
  rating numeric,
  slope numeric,
  tee_name text,
  course_handicap int,
  scores jsonb not null default '[]'::jsonb,
  putts jsonb not null default '[]'::jsonb,
  fairways jsonb not null default '[]'::jsonb,
  team text,
  created_at timestamptz default now()
);

-- ---------- activity_log ----------
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_name text,
  action text not null,
  summary text not null,
  group_id uuid,
  target_user_id uuid,
  created_at timestamptz not null default now()
);

-- ---------- notifications ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  message text not null,
  read boolean not null default false,
  group_id uuid,
  created_at timestamptz default now()
);

-- ============================================================================
-- Helper functions used by RLS (exist in live DB; export bodies via CLI to
-- recreate from scratch): is_admin(), is_group_member(gid,uid),
-- is_group_admin(gid,uid), is_game_member(gid).
-- RPCs: create_group_invite(...) -> text code; redeem_group_invite(code) -> uuid.
-- ============================================================================

-- Indexes present in the live DB:
create index if not exists idx_rounds_user_id      on rounds (user_id);
create index if not exists idx_rounds_user_played   on rounds (user_id, played_at desc);
create index if not exists idx_rounds_group_id      on rounds (group_id);
create index if not exists idx_holes_round_id       on holes (round_id);
create index if not exists idx_game_players_game    on game_players (game_id);
create index if not exists idx_game_players_user    on game_players (user_id);
create index if not exists idx_games_group_id       on games (group_id);
create index if not exists idx_group_members_user   on group_members (user_id);
create index if not exists idx_group_members_group  on group_members (group_id);
create index if not exists idx_group_courses_group  on group_courses (group_id);
create index if not exists idx_group_courses_course on group_courses (course_id);
create index if not exists idx_fav_courses_vetted   on favorite_courses (vetted);
create index if not exists idx_notifications_user   on notifications (user_id, created_at desc);
create index if not exists idx_activity_created     on activity_log (created_at desc);
create index if not exists idx_profiles_last_active on profiles (last_active desc);
