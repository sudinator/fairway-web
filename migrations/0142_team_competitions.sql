-- 0142_team_competitions.sql
-- Ryder Cup-style multi-session team competitions.
-- AUTHORIZATION: tables are RLS-gated to active club viewers and organizer/admin structural writers; the session-link validation trigger is not directly executable by app roles.
-- A competition owns two persistent team rosters. Each session links to one ordinary BNN game
-- (Four-Ball, Alternate Shot, or team Singles Match), so existing scoring remains authoritative
-- and this schema only adds the aggregation layer.

begin;

create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  location text,
  start_date date not null,
  status text not null default 'active' check (status in ('draft','active','complete')),
  team_a_name text not null default 'Team 1' check (length(btrim(team_a_name)) > 0),
  team_b_name text not null default 'Team 2' check (length(btrim(team_b_name)) > 0),
  constraint competitions_distinct_team_names_chk check (lower(btrim(team_a_name)) <> lower(btrim(team_b_name))),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists competitions_group_date_idx on public.competitions(group_id, start_date desc);

create table if not exists public.competition_players (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team_key text not null check (team_key in ('A','B')),
  display_name text not null,
  avatar_url text,
  handicap_index numeric,
  primary key (competition_id, user_id)
);
create index if not exists competition_players_team_idx on public.competition_players(competition_id, team_key);

create table if not exists public.competition_sessions (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  format text not null check (format in ('fourball','alt_shot','match')),
  session_order integer not null check (session_order > 0),
  play_date date not null,
  points_per_match numeric(6,2) not null default 1 check (points_per_match > 0 and points_per_match <= 10),
  game_id uuid unique references public.games(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (competition_id, session_order)
);
create index if not exists competition_sessions_comp_idx on public.competition_sessions(competition_id, session_order);

-- A linked session must be a normal BNN team game from the same club, with only Cup-roster
-- members and the exact persistent Cup team assignment. This prevents a direct API caller from
-- linking an unrelated game or silently drifting the event roster/team contract.
create or replace function public.validate_competition_session_game()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.competitions%rowtype;
  g public.games%rowtype;
begin
  if new.game_id is null then return new; end if;
  select * into c from public.competitions where id = new.competition_id;
  if not found then raise exception 'Competition not found'; end if;
  select * into g from public.games where id = new.game_id;
  if not found then raise exception 'Game not found'; end if;
  if g.group_id is distinct from c.group_id then raise exception 'Cup session game must belong to the same club'; end if;
  if g.game_type::text <> new.format then raise exception 'Cup session format must match the linked game'; end if;
  if jsonb_array_length(coalesce(to_jsonb(g.teams), '[]'::jsonb)) <> 2 then raise exception 'Cup session game must have exactly two teams'; end if;
  if coalesce(g.teams->0->>'key','') <> 'A' or coalesce(g.teams->1->>'key','') <> 'B'
     or coalesce(g.teams->0->>'name','') <> c.team_a_name or coalesce(g.teams->1->>'name','') <> c.team_b_name then
    raise exception 'Cup session game team identities must match the Cup';
  end if;
  if exists (
    select 1
    from public.game_players gp
    left join public.competition_players cp
      on cp.competition_id = new.competition_id and cp.user_id = gp.user_id
    where gp.game_id = new.game_id
      and (gp.user_id is null or cp.user_id is null or gp.team is distinct from cp.team_key)
  ) then
    raise exception 'Every Cup session player must be on the Cup roster and keep the same team';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_competition_session_game() from public, anon, authenticated;

drop trigger if exists competition_session_game_contract on public.competition_sessions;
create trigger competition_session_game_contract
before insert or update of game_id, competition_id, format on public.competition_sessions
for each row execute function public.validate_competition_session_game();

-- Once a game is linked to a Cup session, preserve the parent Cup contract. The ordinary
-- game remains the scoring engine, but its roster/team identity cannot drift away from the Cup.
create or replace function public.guard_competition_game_player()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game uuid := case when tg_op = 'DELETE' then old.game_id else new.game_id end;
  v_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  v_team text := case when tg_op = 'DELETE' then old.team else new.team end;
  v_comp uuid;
  v_expected text;
begin
  select cs.competition_id into v_comp
    from public.competition_sessions cs
   where cs.game_id = v_game
   limit 1;
  if v_comp is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if v_user is null then raise exception 'Cup sessions cannot contain guests'; end if;
  select cp.team_key into v_expected
    from public.competition_players cp
   where cp.competition_id = v_comp and cp.user_id = v_user;
  if v_expected is null then raise exception 'Cup session players must belong to the Cup roster'; end if;
  if v_team is distinct from v_expected then raise exception 'Cup session player team must match the Cup roster'; end if;
  return new;
end;
$$;
revoke all on function public.guard_competition_game_player() from public, anon, authenticated;
drop trigger if exists competition_game_player_contract on public.game_players;
create trigger competition_game_player_contract
before insert or update of game_id, user_id, team on public.game_players
for each row execute function public.guard_competition_game_player();

create or replace function public.guard_competition_game_structure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cs public.competition_sessions%rowtype;
  c public.competitions%rowtype;
begin
  select * into cs from public.competition_sessions where game_id = old.id limit 1;
  if not found then return new; end if;
  select * into c from public.competitions where id = cs.competition_id;
  if new.group_id is distinct from c.group_id then raise exception 'Cup session game must remain in the Cup club'; end if;
  if new.game_type::text <> cs.format then raise exception 'Cup session format cannot change after linking'; end if;
  if jsonb_array_length(coalesce(to_jsonb(new.teams), '[]'::jsonb)) <> 2
     or coalesce(new.teams->0->>'key','') <> 'A'
     or coalesce(new.teams->1->>'key','') <> 'B'
     or coalesce(new.teams->0->>'name','') <> c.team_a_name
     or coalesce(new.teams->1->>'name','') <> c.team_b_name then
    raise exception 'Cup session team names cannot change after linking';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_competition_game_structure() from public, anon, authenticated;
drop trigger if exists competition_game_structure_contract on public.games;
create trigger competition_game_structure_contract
before update of group_id, game_type, teams on public.games
for each row execute function public.guard_competition_game_structure();

-- Freeze the persistent Cup roster/team names after the first child game is linked. This keeps
-- every later session on the same two sides while still allowing harmless metadata edits.
create or replace function public.guard_competition_roster_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comp uuid;
begin
  if tg_table_name = 'competitions' then
    v_comp := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_comp := case when tg_op = 'DELETE' then old.competition_id else new.competition_id end;
  end if;
  if exists (select 1 from public.competition_sessions where competition_id = v_comp and game_id is not null) then
    if tg_table_name = 'competition_players' then
      raise exception 'Cup roster is locked after the first session is linked';
    elsif old.team_a_name is distinct from new.team_a_name or old.team_b_name is distinct from new.team_b_name then
      raise exception 'Cup team names are locked after the first session is linked';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.guard_competition_roster_change() from public, anon, authenticated;
drop trigger if exists competition_roster_contract on public.competition_players;
create trigger competition_roster_contract
before insert or update or delete on public.competition_players
for each row execute function public.guard_competition_roster_change();
drop trigger if exists competition_team_names_contract on public.competitions;
create trigger competition_team_names_contract
before update of team_a_name, team_b_name on public.competitions
for each row execute function public.guard_competition_roster_change();

alter table public.competitions enable row level security;
alter table public.competition_players enable row level security;
alter table public.competition_sessions enable row level security;

grant select, insert, update, delete on public.competitions to authenticated;
grant select, insert, update, delete on public.competition_players to authenticated;
grant select, insert, update, delete on public.competition_sessions to authenticated;

-- Competition: active club members may read; club/system admins create; creator, club admin, or system admin may edit/delete.
drop policy if exists competition_select on public.competitions;
create policy competition_select on public.competitions for select to authenticated
using (public.is_group_member(group_id, auth.uid()) or public.is_admin());

drop policy if exists competition_insert on public.competitions;
create policy competition_insert on public.competitions for insert to authenticated
with check (created_by = auth.uid() and (public.is_group_admin(group_id, auth.uid()) or public.is_admin()));

drop policy if exists competition_update on public.competitions;
create policy competition_update on public.competitions for update to authenticated
using (public.is_admin() or (public.is_group_member(group_id, auth.uid()) and (created_by = auth.uid() or public.is_group_admin(group_id, auth.uid()))))
with check (public.is_admin() or (public.is_group_member(group_id, auth.uid()) and (created_by = auth.uid() or public.is_group_admin(group_id, auth.uid()))));

drop policy if exists competition_delete on public.competitions;
create policy competition_delete on public.competitions for delete to authenticated
using (public.is_admin() or (public.is_group_member(group_id, auth.uid()) and (created_by = auth.uid() or public.is_group_admin(group_id, auth.uid()))));

-- Child rows inherit visibility/authorization from their parent competition.
drop policy if exists competition_players_select on public.competition_players;
create policy competition_players_select on public.competition_players for select to authenticated
using (exists (select 1 from public.competitions c where c.id = competition_players.competition_id and (public.is_group_member(c.group_id, auth.uid()) or public.is_admin())));

drop policy if exists competition_players_insert on public.competition_players;
create policy competition_players_insert on public.competition_players for insert to authenticated
with check (exists (select 1 from public.competitions c where c.id = competition_players.competition_id and (public.is_admin() or (public.is_group_member(c.group_id, auth.uid()) and (c.created_by = auth.uid() or public.is_group_admin(c.group_id, auth.uid()))))));

drop policy if exists competition_players_update on public.competition_players;
create policy competition_players_update on public.competition_players for update to authenticated
using (exists (select 1 from public.competitions c where c.id = competition_players.competition_id and (public.is_admin() or (public.is_group_member(c.group_id, auth.uid()) and (c.created_by = auth.uid() or public.is_group_admin(c.group_id, auth.uid()))))))
with check (exists (select 1 from public.competitions c where c.id = competition_players.competition_id and (public.is_admin() or (public.is_group_member(c.group_id, auth.uid()) and (c.created_by = auth.uid() or public.is_group_admin(c.group_id, auth.uid()))))));

drop policy if exists competition_players_delete on public.competition_players;
create policy competition_players_delete on public.competition_players for delete to authenticated
using (exists (select 1 from public.competitions c where c.id = competition_players.competition_id and (public.is_admin() or (public.is_group_member(c.group_id, auth.uid()) and (c.created_by = auth.uid() or public.is_group_admin(c.group_id, auth.uid()))))));

drop policy if exists competition_sessions_select on public.competition_sessions;
create policy competition_sessions_select on public.competition_sessions for select to authenticated
using (exists (select 1 from public.competitions c where c.id = competition_sessions.competition_id and (public.is_group_member(c.group_id, auth.uid()) or public.is_admin())));

drop policy if exists competition_sessions_insert on public.competition_sessions;
create policy competition_sessions_insert on public.competition_sessions for insert to authenticated
with check (exists (select 1 from public.competitions c where c.id = competition_sessions.competition_id and (public.is_admin() or (public.is_group_member(c.group_id, auth.uid()) and (c.created_by = auth.uid() or public.is_group_admin(c.group_id, auth.uid()))))));

drop policy if exists competition_sessions_update on public.competition_sessions;
create policy competition_sessions_update on public.competition_sessions for update to authenticated
using (exists (select 1 from public.competitions c where c.id = competition_sessions.competition_id and (public.is_admin() or (public.is_group_member(c.group_id, auth.uid()) and (c.created_by = auth.uid() or public.is_group_admin(c.group_id, auth.uid()))))))
with check (exists (select 1 from public.competitions c where c.id = competition_sessions.competition_id and (public.is_admin() or (public.is_group_member(c.group_id, auth.uid()) and (c.created_by = auth.uid() or public.is_group_admin(c.group_id, auth.uid()))))));

drop policy if exists competition_sessions_delete on public.competition_sessions;
create policy competition_sessions_delete on public.competition_sessions for delete to authenticated
using (exists (select 1 from public.competitions c where c.id = competition_sessions.competition_id and (public.is_admin() or (public.is_group_member(c.group_id, auth.uid()) and (c.created_by = auth.uid() or public.is_group_admin(c.group_id, auth.uid()))))));

-- Atomic Cup creation. The client supplies only user/team assignments; profile snapshots are resolved
-- in the database so a partial roster insert can never strand an empty/half-created competition.
create or replace function public.create_team_competition(
  p_group uuid,
  p_name text,
  p_location text,
  p_start_date date,
  p_team_a_name text,
  p_team_b_name text,
  p_roster jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_roster jsonb := coalesce(p_roster, '[]'::jsonb);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_group is null or not (public.is_group_admin(p_group, auth.uid()) or public.is_admin()) then
    raise exception 'Only a club admin or system admin can create a Cup';
  end if;
  if nullif(btrim(p_name), '') is null then raise exception 'Competition name is required'; end if;
  if p_start_date is null then raise exception 'Start date is required'; end if;
  if nullif(btrim(p_team_a_name), '') is null or nullif(btrim(p_team_b_name), '') is null then
    raise exception 'Both team names are required';
  end if;
  if lower(btrim(p_team_a_name)) = lower(btrim(p_team_b_name)) then
    raise exception 'Cup team names must be different';
  end if;
  if jsonb_typeof(v_roster) <> 'array' or jsonb_array_length(v_roster) < 2 then
    raise exception 'Cup roster must contain at least two players';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_roster) r
    where coalesce(r->>'team_key','') not in ('A','B') or nullif(r->>'user_id','') is null
  ) then
    raise exception 'Every Cup roster row needs a player and Team A or B';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_roster) r where r->>'team_key' = 'A')
     or not exists (select 1 from jsonb_array_elements(v_roster) r where r->>'team_key' = 'B') then
    raise exception 'Put at least one player on each Cup team';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_roster) r
      left join public.group_members gm
        on gm.group_id = p_group
       and gm.user_id = (r->>'user_id')::uuid
       and gm.status = 'active'
     where gm.user_id is null
  ) then
    raise exception 'Every Cup player must be an active club member';
  end if;

  insert into public.competitions (
    group_id, name, location, start_date, status, team_a_name, team_b_name, created_by
  ) values (
    p_group, btrim(p_name), nullif(btrim(coalesce(p_location,'')), ''), p_start_date, 'active',
    btrim(p_team_a_name), btrim(p_team_b_name), auth.uid()
  ) returning id into v_id;

  insert into public.competition_players (
    competition_id, user_id, team_key, display_name, avatar_url, handicap_index
  )
  select
    v_id,
    p.id,
    r->>'team_key',
    coalesce(nullif(btrim(p.display_name), ''), 'Player'),
    p.avatar_url,
    p.handicap_index
  from jsonb_array_elements(v_roster) r
  join public.profiles p on p.id = (r->>'user_id')::uuid;

  return v_id;
end;
$$;

revoke all on function public.create_team_competition(uuid, text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.create_team_competition(uuid, text, text, date, text, text, jsonb) to authenticated;

select public.record_migration('0142_team_competitions');
commit;
