-- MODELLED minimal schema for isolated native PostgreSQL tests of the 0165 notification writers.
-- This is NOT a reconstruction of the full Supabase migration chain; column names and the trigger
-- wiring are copied from the baseline and from 0048/0057/0070/0073/0092/0124 so the redefined
-- functions execute against the same shapes they meet in production. The full-chain proof is
-- ci/assert-notifications.sql, run by ci/test_fresh_db_rebuild.sh.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,public to anon,authenticated,service_role;
create table public.schema_migrations(id text primary key,applied_at timestamptz default now());
create function public.record_migration(p_id text) returns void language sql as $$insert into public.schema_migrations(id) values(p_id) on conflict(id) do nothing$$;
create table public.profiles(id uuid primary key references auth.users(id), display_name text, email text, is_admin boolean default false, banned boolean default false, deactivated boolean default false, created_at timestamptz default now());
create table public.groups(id uuid primary key default gen_random_uuid(), name text not null, created_by uuid, status text default 'active', created_at timestamptz default now());
create table public.group_members(id uuid primary key default gen_random_uuid(), group_id uuid not null, user_id uuid, email text, role text default 'member', status text default 'active', created_at timestamptz default now());
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null, message text not null, read boolean default false, group_id uuid, created_at timestamptz default now(), type text, link text);
create table public.games(id uuid primary key default gen_random_uuid(), code text, name text, course text, game_type text default 'stableford', status text default 'active', holes_meta jsonb default '[]', group_id uuid, created_by uuid, created_at timestamptz default now());
create table public.game_players(id uuid primary key default gen_random_uuid(), game_id uuid, user_id uuid, display_name text, tee_name text, course_handicap int, scores jsonb default '[]', no_show boolean default false);
create table public.expenses(id uuid primary key default gen_random_uuid(), group_id uuid, created_by uuid, payer_user_id uuid, description text default '', amount_cents int, source_game_id uuid, source_kind text, created_at timestamptz default now());
create table public.expense_shares(id uuid primary key default gen_random_uuid(), expense_id uuid, user_id uuid, guest_id uuid, sponsor_user_id uuid, share_cents int);
create table public.expense_payers(id uuid primary key default gen_random_uuid(), expense_id uuid, user_id uuid, guest_id uuid, sponsor_user_id uuid, paid_cents int);
create table public.settlements(id uuid primary key default gen_random_uuid(), group_id uuid, from_user_id uuid, to_user_id uuid, amount_cents int, method text, created_at timestamptz default now());
create table public.tee_times(id uuid primary key default gen_random_uuid(), group_id uuid, created_by uuid, title text, course text, play_date date, tee_off_times text[] default '{}', signup_deadline timestamptz, max_spots int, notes text, status text default 'upcoming');
create table public.tee_time_rsvps(id uuid primary key default gen_random_uuid(), tee_time_id uuid, user_id uuid, choice text);
create table public.friction_items(id uuid primary key default gen_random_uuid(), kind text, subject_user uuid, detail text, status text default 'open', first_seen timestamptz default now());
create table public.favorite_courses(id uuid primary key default gen_random_uuid(), group_id uuid, name text, deleted boolean default false, data jsonb);
create table public.course_freshness(course_id uuid primary key, group_id uuid, checked_at timestamptz default now(), api_data jsonb, diff jsonb, has_changes boolean default false, status text default 'none', updated_at timestamptz default now());
create function public.is_admin() returns boolean language sql security definer as $$ select exists(select 1 from public.profiles where id=auth.uid() and is_admin) $$;
create function public.is_group_member(g uuid, u uuid) returns boolean language sql security definer as $$ select exists(select 1 from public.group_members where group_id=g and user_id=u and status='active') $$;
-- 0092's sweep, reduced to the part 0165 wraps: it inserts the generic admin notice and reports 'new'.
create function public.sweep_friction(p_force boolean default false) returns jsonb language plpgsql security definer as $$
declare v_new int; begin
  select count(*) into v_new from friction_items where status='open';
  if v_new > 0 then
    insert into notifications(user_id, message, type, link)
    select p.id, v_new || ' new data-integrity flag' || case when v_new=1 then '' else 's' end || ' to review', 'friction', '/'
    from profiles p where p.is_admin;
  end if;
  return jsonb_build_object('ran', true, 'new', v_new);
end $$;
grant execute on function public.sweep_friction(boolean) to authenticated;
-- Pre-0165 writers, so the migration's create-or-replace and trigger drop/create meet existing objects.
create function public.notify_game_added() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.notify_money_owed() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.notify_money_paid() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.notify_tee_new() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.notify_bet_posted() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.notify_game_finished() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.notify_group_member() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trg_notify_game_added after insert on public.game_players for each row execute function public.notify_game_added();
create trigger trg_notify_money_owed after insert on public.expense_shares for each row execute function public.notify_money_owed();
create trigger trg_notify_money_paid after insert on public.settlements for each row execute function public.notify_money_paid();
create trigger trg_notify_tee_new after insert on public.tee_times for each row execute function public.notify_tee_new();
create trigger trg_notify_bet_posted after insert on public.expenses for each row execute function public.notify_bet_posted();
create trigger trg_notify_game_finished after update on public.games for each row execute function public.notify_game_finished();
create trigger trg_notify_group_member after insert or update on public.group_members for each row execute function public.notify_group_member();
create function public.create_notification(p_recipient uuid, p_message text, p_group_id uuid default null, p_type text default null, p_link text default null) returns void language sql as $$ select 1 $$;
create function public.record_course_freshness(p_course_id uuid, p_api_data jsonb, p_diff jsonb, p_has_changes boolean) returns void language sql as $$ select 1 $$;
create function public.send_tee_reminders() returns void language sql as $$ select 1 $$;
