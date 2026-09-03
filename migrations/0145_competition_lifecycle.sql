-- 0145_competition_lifecycle.sql
-- Adds permission-checked Ryder Cup rename/deletion plus system-admin game oversight.
-- AUTHORIZATION: only the Ryder Cup organizer, a current club admin, or a system admin may
-- rename or delete an uncompleted Cup. Once a linked game is ended or has a posted round, only a
-- system admin may delete it. The same completed-game boundary is enforced for standalone Games.
-- Deletion removes Alternate Shot posted rounds because they are shared-ball records and preserves
-- own-ball rounds. System-admin inspection is read-only and never adds the admin as a player.

begin;

create or replace function public.rename_team_competition(
  p_competition uuid,
  p_name text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_name text;
  v_new_name text := btrim(coalesce(p_name, ''));
  v_group uuid;
  v_actor text;
begin
  if auth.uid() is null
     or not public.can_manage_competition(p_competition, auth.uid()) then
    raise exception 'Only the Ryder Cup organizer, a club admin, or a system admin can rename it';
  end if;

  if v_new_name = '' or length(v_new_name) > 120 then
    raise exception 'Ryder Cup title must be between 1 and 120 characters';
  end if;

  select c.name, c.group_id
    into v_old_name, v_group
    from public.competitions c
   where c.id = p_competition
   for update;

  if not found then
    raise exception 'Ryder Cup not found';
  end if;

  if v_old_name = v_new_name then
    return v_new_name;
  end if;

  update public.competitions
     set name = v_new_name,
         updated_at = now()
   where id = p_competition;

  select coalesce(nullif(btrim(p.display_name), ''), 'Someone')
    into v_actor
    from public.profiles p
   where p.id = auth.uid();

  insert into public.activity_log (
    actor_id, actor_name, action, summary, group_id
  ) values (
    auth.uid(),
    coalesce(v_actor, 'Someone'),
    'competition_renamed',
    format('Renamed Ryder Cup "%s" to "%s"', v_old_name, v_new_name),
    v_group
  );

  return v_new_name;
end;
$$;

revoke all on function public.rename_team_competition(uuid, text)
  from public, anon;

grant execute on function public.rename_team_competition(uuid, text)
  to authenticated;

-- Organizers may remove an uncompleted standalone Game. An ended Game, or one with any posted
-- round, is a historical record and can only be removed through the system-admin repair RPC.
create or replace function public.delete_game(
  p_game uuid,
  p_delete_rounds boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
begin
  select *
    into v_game
    from public.games g
   where g.id = p_game
   for update;

  if not found or v_game.created_by is distinct from auth.uid() then
    raise exception 'Only the organizer can delete this game';
  end if;

  if v_game.status = 'ended'
     or exists (
       select 1
         from public.rounds r
        where r.game_id = p_game
          and r.deleted_at is null
     ) then
    raise exception 'Only a system admin can delete a completed game';
  end if;

  -- No posted round can exist beyond the completed-game guard above. Keep the historical
  -- parameter for client/backward compatibility while making the preservation rule explicit.
  if p_delete_rounds then
    delete from public.holes h
     where h.round_id in (
       select r.id from public.rounds r where r.game_id = p_game
     );
    delete from public.rounds r where r.game_id = p_game;
  end if;

  delete from public.game_players gp where gp.game_id = p_game;
  delete from public.games g where g.id = p_game;
end;
$$;

revoke all on function public.delete_game(uuid, boolean)
  from public, anon;

grant execute on function public.delete_game(uuid, boolean)
  to authenticated;

-- System-admin deletion preserves own-ball history. Alternate Shot is the exception: the posted
-- score represents a side sharing one ball, so it is removed with the Game rather than retained as
-- an individual round.
create or replace function public.admin_delete_game(
  p_game uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_actor text;
  v_removed_alt_rounds integer := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only a system admin can delete this game';
  end if;

  select *
    into v_game
    from public.games g
   where g.id = p_game
   for update;

  if not found then
    raise exception 'Game not found';
  end if;

  if v_game.game_type = 'alt_shot' then
    select count(*)::integer
      into v_removed_alt_rounds
      from public.rounds r
     where r.game_id = p_game;

    delete from public.holes h
     where h.round_id in (
       select r.id from public.rounds r where r.game_id = p_game
     );
    delete from public.rounds r where r.game_id = p_game;
  end if;

  delete from public.game_players gp where gp.game_id = p_game;
  delete from public.games g where g.id = p_game;

  select coalesce(nullif(btrim(p.display_name), ''), 'Someone')
    into v_actor
    from public.profiles p
   where p.id = auth.uid();

  insert into public.activity_log (
    actor_id, actor_name, action, summary, group_id
  ) values (
    auth.uid(),
    coalesce(v_actor, 'Someone'),
    'admin_game_repair',
    case
      when v_game.game_type = 'alt_shot' then format(
        'System admin deleted game "%s" and %s Alternate Shot shared-ball round%s',
        v_game.name,
        v_removed_alt_rounds,
        case when v_removed_alt_rounds = 1 then '' else 's' end
      )
      else format(
        'System admin deleted game "%s" and preserved posted own-ball rounds',
        v_game.name
      )
    end,
    v_game.group_id
  );
end;
$$;

revoke all on function public.admin_delete_game(uuid)
  from public, anon;

grant execute on function public.admin_delete_game(uuid)
  to authenticated;

-- The normal co-player policy intentionally hides game_players from outsiders. System admins need
-- SELECT-only visibility to inspect a Game without joining it; mutation remains RPC-gated.
drop policy if exists "system admins read game players"
  on public.game_players;

create policy "system admins read game players"
  on public.game_players
  as permissive
  for select
  to authenticated
  using (public.is_admin());

-- Searchable, bounded system-admin directory. It returns operational metadata only and never
-- changes membership, so opening a Game from Admin does not create a game_players row.
create or replace function public.admin_game_oversight(
  p_search text default null,
  p_status text default 'all',
  p_limit integer default 200
)
returns table (
  game_id uuid,
  code text,
  game_name text,
  course text,
  game_type text,
  game_status text,
  played_at date,
  created_at timestamptz,
  ended_at timestamptz,
  group_id uuid,
  group_name text,
  organizer_id uuid,
  organizer_name text,
  player_count integer,
  player_names text,
  posted_round_count integer,
  competition_id uuid,
  competition_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_status text := lower(coalesce(p_status, 'all'));
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 500));
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only a system admin can inspect all games';
  end if;

  if v_status not in ('all', 'active', 'ended', 'ryder_cup') then
    raise exception 'Unknown game status filter';
  end if;

  return query
  select
    g.id,
    g.code::text,
    g.name::text,
    g.course::text,
    g.game_type::text,
    g.status::text,
    g.played_at,
    g.created_at,
    g.ended_at,
    g.group_id,
    coalesce(gr.name, 'No club')::text,
    g.created_by,
    coalesce(nullif(btrim(op.display_name), ''), op.email, 'Unknown organizer')::text,
    coalesce(pp.player_count, 0)::integer,
    coalesce(pp.player_names, '')::text,
    coalesce(rr.posted_round_count, 0)::integer,
    cs.competition_id,
    c.name::text
  from public.games g
  left join public.groups gr on gr.id = g.group_id
  left join public.profiles op on op.id = g.created_by
  left join public.competition_sessions cs on cs.game_id = g.id
  left join public.competitions c on c.id = cs.competition_id
  left join lateral (
    select
      count(*)::integer as player_count,
      string_agg(gp.display_name, ', ' order by lower(gp.display_name))::text as player_names
    from public.game_players gp
    where gp.game_id = g.id
  ) pp on true
  left join lateral (
    select count(*)::integer as posted_round_count
    from public.rounds r
    where r.game_id = g.id
      and r.deleted_at is null
  ) rr on true
  where
    (v_status = 'all'
      or (v_status = 'active' and g.status is distinct from 'ended')
      or (v_status = 'ended' and g.status = 'ended')
      or (v_status = 'ryder_cup' and cs.competition_id is not null))
    and (
      v_search is null
      or g.name ilike '%' || v_search || '%'
      or g.code ilike '%' || v_search || '%'
      or g.course ilike '%' || v_search || '%'
      or coalesce(gr.name, '') ilike '%' || v_search || '%'
      or coalesce(op.display_name, '') ilike '%' || v_search || '%'
      or coalesce(op.email, '') ilike '%' || v_search || '%'
      or coalesce(pp.player_names, '') ilike '%' || v_search || '%'
      or coalesce(c.name, '') ilike '%' || v_search || '%'
    )
  order by coalesce(g.played_at, g.created_at::date) desc, g.created_at desc
  limit v_limit;
end;
$$;

revoke all on function public.admin_game_oversight(text, text, integer)
  from public, anon;

grant execute on function public.admin_game_oversight(text, text, integer)
  to authenticated;

create or replace function public.delete_team_competition(
  p_competition uuid
)
returns table (
  deleted_games integer,
  deleted_alt_shot_rounds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_group uuid;
  v_actor text;
  v_status text;
  v_protected boolean := false;
  v_game_ids uuid[] := array[]::uuid[];
  v_alt_shot_game_ids uuid[] := array[]::uuid[];
  v_game_count integer := 0;
  v_alt_round_count integer := 0;
begin
  select c.name, c.group_id, c.status
    into v_name, v_group, v_status
    from public.competitions c
   where c.id = p_competition
   for update;

  if not found then
    raise exception 'Ryder Cup not found';
  end if;

  if auth.uid() is null
     or not public.can_manage_competition(p_competition, auth.uid()) then
    raise exception 'Only the Ryder Cup organizer, a club admin, or a system admin can delete it';
  end if;

  select
    coalesce(array_agg(cs.game_id) filter (where cs.game_id is not null), array[]::uuid[]),
    coalesce(array_agg(cs.game_id) filter (
      where cs.game_id is not null and cs.format = 'alt_shot'
    ), array[]::uuid[])
    into v_game_ids, v_alt_shot_game_ids
    from public.competition_sessions cs
   where cs.competition_id = p_competition;

  v_game_count := cardinality(v_game_ids);

  select
    v_status = 'complete'
    or exists (
      select 1
      from public.games g
      where g.id = any(v_game_ids)
        and g.status = 'ended'
    )
    or exists (
      select 1
      from public.rounds r
      where r.game_id = any(v_game_ids)
        and r.deleted_at is null
    )
    into v_protected;

  if v_protected and not public.is_admin() then
    raise exception 'Only a system admin can delete a Ryder Cup containing completed games';
  end if;

  -- The locked-schedule trigger correctly blocks ordinary session deletion. This authorized
  -- lifecycle transaction must lower that guard before linked-game cascades remove session rows.
  update public.competitions
     set schedule_status = 'draft',
         schedule_locked_at = null,
         schedule_locked_by = null,
         updated_at = now()
   where id = p_competition;

  select count(*)::integer
    into v_alt_round_count
    from public.rounds r
   where r.game_id = any(v_alt_shot_game_ids);

  -- Holes do not rely on an FK cascade in the historical baseline.
  delete from public.holes h
   where h.round_id in (
     select r.id
       from public.rounds r
      where r.game_id = any(v_alt_shot_game_ids)
   );

  -- A shared Alternate Shot score is not an individual's played-ball round.
  delete from public.rounds r
   where r.game_id = any(v_alt_shot_game_ids);

  -- Four-Ball and Singles posted rounds intentionally remain in personal history.
  delete from public.game_players gp
   where gp.game_id = any(v_game_ids);

  delete from public.games g
   where g.id = any(v_game_ids);

  select coalesce(nullif(btrim(p.display_name), ''), 'Someone')
    into v_actor
    from public.profiles p
   where p.id = auth.uid();

  insert into public.activity_log (
    actor_id, actor_name, action, summary, group_id
  ) values (
    auth.uid(),
    coalesce(v_actor, 'Someone'),
    'competition_deleted',
    format(
      'Deleted Ryder Cup "%s" and %s linked game%s; preserved own-ball rounds and removed %s Alternate Shot round%s',
      v_name,
      v_game_count,
      case when v_game_count = 1 then '' else 's' end,
      v_alt_round_count,
      case when v_alt_round_count = 1 then '' else 's' end
    ),
    v_group
  );

  delete from public.competitions
   where id = p_competition;

  return query select v_game_count, v_alt_round_count;
end;
$$;

revoke all on function public.delete_team_competition(uuid)
  from public, anon;

grant execute on function public.delete_team_competition(uuid)
  to authenticated;

commit;

select public.record_migration('0145_competition_lifecycle');
