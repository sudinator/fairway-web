-- MODELLED minimal schema for isolated native PostgreSQL behavior tests.
-- This is NOT a reconstruction of the full Supabase migration chain.
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,public to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table public.profiles(id uuid primary key references auth.users(id),display_name text,is_admin boolean default false,banned boolean default false);
create table public.games(id uuid primary key,code text unique,name text,course text,course_par integer,game_type text,status text,created_by uuid,group_id uuid,
 holes_meta jsonb,teams jsonb,pairings jsonb,foursomes jsonb,marker_user_id uuid,scores_reset_at timestamptz,alt_shot_scoring_started_at timestamptz);
create table public.game_players(id uuid primary key,game_id uuid references public.games(id) on delete cascade,user_id uuid references auth.users(id),display_name text,
 scores jsonb default '[]',putts jsonb default '[]',fairways jsonb default '[]',penalties jsonb default '[]',sand jsonb default '[]',clock_start timestamptz,clock_end timestamptz,
 tee_group smallint,is_marker boolean default false,group_locked boolean default false,no_show boolean default false,is_guest boolean default false,
 handicap_index numeric,rating numeric,slope integer,tee_name text,course_handicap integer,team text,
 course_handicap_source text default 'derived',course_handicap_set_by uuid,course_handicap_set_at timestamptz);
create table public.rounds(id uuid primary key default gen_random_uuid(),game_id uuid,user_id uuid,ai_analysis jsonb,status text,
 course text,tee_name text,rating numeric,slope integer,course_par integer,handicap_index numeric,course_handicap integer,
 course_handicap_source text,course_handicap_set_by uuid,course_handicap_set_at timestamptz,group_id uuid,
 played_at date,gross_score integer,finished_by text,finished_at timestamptz,unique(game_id,user_id));
create table public.holes(id uuid primary key default gen_random_uuid(),round_id uuid references public.rounds(id),strokes integer,
 hole_number integer,par integer,stroke_index integer,putts integer,fairway text,penalties integer,sand boolean,yardage integer);
create table public.schema_migrations(id text primary key,applied_at timestamptz default now());
create function public.record_migration(p_id text) returns void language sql as $$insert into public.schema_migrations(id) values(p_id) on conflict(id) do nothing$$;
create function public.is_admin() returns boolean language sql security definer as $$select exists(select 1 from public.profiles where id=auth.uid() and is_admin)$$;
create function public.is_game_member(p_game uuid) returns boolean language sql security definer as $$select exists(select 1 from public.game_players where game_id=p_game and user_id=auth.uid())$$;
create function public.is_tee_group_marker(p_game uuid,p_group smallint) returns boolean language sql security definer as $$select exists(select 1 from public.game_players where game_id=p_game and tee_group=p_group and user_id=auth.uid() and is_marker)$$;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
-- Fixture visibility; update/marker/organizer player policies are copied from the real baseline by the runner.
create policy fixture_game_select on public.games for select to authenticated using(created_by=auth.uid() or public.is_game_member(id) or public.is_admin());
create policy fixture_game_update on public.games for update to authenticated using(created_by=auth.uid());
grant select,insert,update,delete on public.games,public.game_players to authenticated;
