-- ============================================================================
-- Birdie Num Num — baseline schema (migration 0001)
-- ============================================================================
-- RECONSTRUCTION NOTICE
-- This file was reconstructed from the application code and the history of
-- manual `alter table` statements run in the Supabase SQL editor. It is the
-- app's best understanding of the schema it depends on, NOT a guaranteed-exact
-- dump of the live database. The AUTHORITATIVE schema lives in your Supabase
-- project — see SCHEMA.md for how to export it and reconcile against this file.
--
-- Everything here is written to be SAFE and IDEMPOTENT:
--   * `create table if not exists`  → no-op if the table already exists
--   * `add column if not exists`    → no-op if the column already exists
--   * `create index if not exists`  → no-op if the index already exists
-- So running this against your existing database will NOT drop or overwrite
-- data; it only fills in anything missing. New/empty databases get the full
-- structure.
--
-- RLS policies are intentionally NOT created here (the app cannot see the live
-- policies, and creating them blindly could lock you out or open access). The
-- policies the app ASSUMES are documented in SCHEMA.md as a checklist.
-- ============================================================================

-- ---------- profiles (one row per signed-in user; id = auth.users.id) ----------
create table if not exists profiles (
  id uuid primary key,
  display_name text,
  email text,
  handicap_index numeric,
  ghin_number text,
  phone text,
  is_admin boolean not null default false,
  deactivated boolean not null default false,
  active_group_id uuid,
  last_active timestamptz default now(),
  created_at timestamptz default now()
);
alter table profiles add column if not exists ghin_number text;
alter table profiles add column if not exists phone text;
alter table profiles add column if not exists is_admin boolean not null default false;
alter table profiles add column if not exists deactivated boolean not null default false;
alter table profiles add column if not exists active_group_id uuid;
alter table profiles add column if not exists last_active timestamptz default now();

-- ---------- groups ----------
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid,
  status text not null default 'active',   -- 'active' | 'pending' | 'declined'
  request_note text,
  created_at timestamptz default now()
);
alter table groups add column if not exists status text not null default 'active';
alter table groups add column if not exists request_note text;

-- ---------- group_members ----------
create table if not exists group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  user_id uuid,
  email text,
  role text not null default 'member',      -- 'member' | 'admin'
  status text not null default 'active',     -- 'active' | 'removed'
  created_at timestamptz default now()
);

-- ---------- favorite_courses (canonical course records; community-shared) ----------
create table if not exists favorite_courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  tees jsonb,
  holes jsonb,
  created_by uuid,
  vetted boolean not null default false,     -- admin-marked shared/community course
  deleted boolean not null default false,
  deleted_by uuid,
  deleted_at timestamptz,
  created_at timestamptz default now()
);
alter table favorite_courses add column if not exists vetted boolean not null default false;
alter table favorite_courses add column if not exists deleted boolean not null default false;
alter table favorite_courses add column if not exists deleted_by uuid;
alter table favorite_courses add column if not exists deleted_at timestamptz;
-- Global name-uniqueness (used to dedupe the shared library). KEEP THIS.
create unique index if not exists favorite_courses_name_unique on favorite_courses (name);

-- ---------- group_courses (link table: which groups have adopted which course) ----------
create table if not exists group_courses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  course_id uuid not null,
  created_at timestamptz default now()
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
  gross_score int,                 -- set for total-only rounds (no hole detail)
  group_id uuid,
  status text not null default 'final',   -- 'final' | 'in_progress'
  played_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table rounds add column if not exists gross_score int;
alter table rounds add column if not exists group_id uuid;
alter table rounds add column if not exists status text not null default 'final';

-- ---------- holes (per-hole detail for a round) ----------
create table if not exists holes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null,
  hole_number int not null,
  par int,
  stroke_index int,
  strokes int,
  putts int,
  fairway text,                    -- 'hit' | 'miss' | null
  penalties int default 0
);

-- ---------- games ----------
create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  code text,                       -- share/join code
  name text,
  course text,
  course_par int,
  holes_meta jsonb,                -- [{ n, par, si }]
  group_id uuid,
  game_type text not null default 'stableford',  -- 'stableford' | 'match' | 'fourball'
  status text not null default 'active',          -- 'active' | 'ended'
  pairings jsonb default '[]'::jsonb,             -- singles match: [{ a, b }]
  teams jsonb,                                    -- team match: [{ key, name }]
  foursomes jsonb,                                -- four-ball: [{ id, name, a:[], b:[] }]
  created_by uuid,
  created_at timestamptz default now()
);
alter table games add column if not exists game_type text not null default 'stableford';
alter table games add column if not exists status text not null default 'active';
alter table games add column if not exists pairings jsonb default '[]'::jsonb;
alter table games add column if not exists teams jsonb;
alter table games add column if not exists foursomes jsonb;

-- ---------- game_players ----------
create table if not exists game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  user_id uuid,
  display_name text,
  email text,
  handicap_index numeric,
  rating numeric,
  slope numeric,
  tee_name text,
  course_handicap int,
  scores jsonb,                    -- strokes per hole
  putts jsonb,
  fairways jsonb,
  team text                        -- team match: 'A' | 'B'
);
alter table game_players add column if not exists team text;

-- ---------- activity_log (admin audit trail) ----------
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_name text,
  action text,
  group_id uuid,
  target_user_id uuid,
  summary text,
  created_at timestamptz default now()
);

-- ---------- notifications ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  message text,
  read boolean not null default false,
  created_at timestamptz default now()
);

-- ============================================================================
-- Performance indexes (mirrors birdie-indexes.sql)
-- ============================================================================
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

-- ============================================================================
-- RPCs the app calls (signatures only — see your live DB for the exact bodies)
-- ============================================================================
--   create_group_invite(group_id ...)  -> returns/stores a 6-digit code
--   redeem_group_invite(code text)      -> returns the group_id joined
-- These are NOT redefined here to avoid overwriting your working versions.
-- Export them from Supabase (see SCHEMA.md) and paste the real bodies below
-- when you want this file to fully recreate the database from scratch.
