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
-- Most RLS policies are reconstructed by the later authoritative core-RLS baseline.
-- A minimal historical compatibility policy is recreated below only where an early
-- migration requires that pre-existing live object in order to replay safely.
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
  created_at timestamptz not null default now(),
  unique (group_id, course_id)
);


-- ---------- course correction / group-local override workflow ----------
-- These tables exist in the live DB and are required by the course library. They were historically
-- created out-of-band; keeping them in the baseline makes fresh environments reproducible.
create table if not exists group_course_overrides (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  course_id uuid not null references favorite_courses(id) on delete cascade,
  name text not null,
  location text,
  data jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (group_id, course_id)
);

create table if not exists course_change_requests (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references favorite_courses(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  submitted_by uuid references auth.users(id) on delete set null,
  proposed_name text not null,
  proposed_location text,
  proposed_data jsonb not null,
  status text not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  reason text,
  change_summary text
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

-- Historical compatibility prerequisite for migration 0017. The original live
-- database already had this INSERT policy before the migration stream was
-- source-controlled; 0017 tightens its WITH CHECK clause in place. Recreate only
-- the pre-0017 policy contract here so a fresh database can replay history.
drop policy if exists "create notifications" on public.notifications;
create policy "create notifications" on public.notifications
  for insert
  with check (auth.uid() is not null);

-- ============================================================================
-- Historical helper prerequisites. These helpers existed in the original live
-- database before this migration stream became source-controlled. Later migration
-- 0034 replaces the first three definitions to add banned-user enforcement. The
-- pre-0034 definitions below intentionally omit that later behavior so a fresh
-- replay follows the same historical transition instead of jumping ahead.
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_group_member(group_uuid uuid, user_uuid uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = group_uuid
      and gm.user_id = user_uuid
      and gm.status = 'active'
  );
$$;

create or replace function public.is_group_admin(group_uuid uuid, user_uuid uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = group_uuid
      and gm.user_id = user_uuid
      and gm.status = 'active'
      and gm.role = 'admin'
  );
$$;

-- is_game_member() is not required by the historical migration stream before the
-- authoritative 0136 helper baseline, so it remains defined there.
-- RPCs create_group_invite/redeem_group_invite are likewise not referenced by the
-- committed replay before their current definitions and therefore need no bootstrap.
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
