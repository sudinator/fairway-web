-- 0219_create_game_complete.sql
--
-- 212.40 — ONE-STEP GAME CREATION, PHASE 2 (owner, Oct 25 2026): the single server step. create_game_complete saves a
-- game, its players and its teams / matchups / groups in ONE transaction — everything or nothing — and only then tells
-- the players, with their own setup in the notification (owner approved the wording, Oct 25):
--   "… you play the Blue tees (CH 18) · Reds, with Raj Mehta, v Sam Lee & Vikram Rao · Group 1"
-- "Create now, finish later": with p_announce = false the game is saved NOT YET ANNOUNCED — nobody is notified, not even
-- players added later in Manage Game — until announce_game_players sends everyone theirs at once.
-- No screen calls these yet (phase 3 moves the Create flow over, format by format). Today's Create is unchanged.
--
--   games.players_notified_at   when the players were told (null = not yet announced). Every existing game, and every
--                               game made the old way, is "announced" (default now()), so the per-player trigger behaves
--                               exactly as before for them.
--   notify_game_added()         unchanged text, now built by game_added_note(); stays quiet while create_game_complete
--                               runs (transaction-local setting) and for games not yet announced.
--   game_setup_line(game, p)    the player's own setup, e.g. "Reds, with Raj Mehta, v Sam Lee & Vikram Rao · Group 1".
--   announce_game_players(game) tells every member player once (organizer or club admin only; repeat calls do nothing).
--   create_game_complete(...)   the one step. SECURITY INVOKER: it runs with the ORGANIZER's own permissions, exactly
--                               like today's Create (the same row policies decide), and applies the line-up through the
--                               same all-or-nothing step Manage Game uses (apply_game_structure, 0184).
--
-- AUTHORIZATION: create_game_complete — authenticated only, and the existing row policies apply (create games: the
-- caller is created_by and a member of the club; organizer adds players). announce_game_players — authenticated, organizer
-- or club admin of that game (checked inside, SECURITY DEFINER to write the notifications). game_setup_line and
-- game_added_note — internal helpers, not callable by anon or authenticated. No table grants change.
-- TESTS: ci/assert-create-game-complete.sql (every phase-1 case stores exactly the phase-1 record) and
--        ci/assert-create-game-announce.sql (all-or-nothing, notifications, finish later, permissions, old path unchanged).
--
-- Idempotent; safe to re-run.

begin;

alter table public.games add column if not exists players_notified_at timestamptz default now();
update public.games set players_notified_at = coalesce(created_at, now()) where players_notified_at is null
  and not exists (select 1 from public.schema_migrations where id = '0219_create_game_complete');

-- "A, B and C"
create or replace function public.join_names(p_names text[]) returns text
language sql immutable set search_path = public as $$
  select case coalesce(array_length(p_names, 1), 0)
    when 0 then '' when 1 then p_names[1] when 2 then p_names[1] || ' and ' || p_names[2]
    else array_to_string(p_names[1:array_length(p_names, 1) - 1], ', ') || ' and ' || p_names[array_length(p_names, 1)] end
$$;

-- The "added to a game" notification for one player — the text notify_game_added has always written (0070, 0165).
create or replace function public.game_added_note(p_game uuid, p_player uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g record; p record; v_self boolean;
begin
  select id, name, course, game_type, code, created_by, group_id, created_at into g from games where id = p_game;
  select user_id, tee_name, course_handicap into p from game_players where id = p_player and game_id = p_game;
  if g.id is null or p.user_id is null then return null; end if;
  v_self := g.created_by is not null and p.user_id = g.created_by;
  return jsonb_build_object(
    'message', case when v_self
               then 'You set up "' || coalesce(g.name, 'a game') || '". Tap to open the game.'
               else public.person_label(g.created_by) || ' added you to "' || coalesce(g.name, 'a game') || '". Tap to open the game.' end,
    'group_id', g.group_id,
    'link', case when g.code is not null then '/?game=' || g.code else '/?tab=games' end,
    'detail', coalesce(g.course, '') ||
          case when g.course is not null then ' · ' else '' end ||
          'set up ' || to_char(g.created_at at time zone 'America/New_York', 'Dy Mon FMDD') ||
          ' · ' || replace(coalesce(g.game_type, 'game'), '_', ' ') ||
          case when g.code is not null then ' · code ' || g.code else '' end ||
          case when p.tee_name is not null then ' · you play the ' || p.tee_name || ' tees' else '' end ||
          case when p.course_handicap is not null then ' (CH ' || p.course_handicap || ')' else '' end);
end $$;

create or replace function public.notify_game_added()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_note jsonb; v_announced boolean;
begin
  if new.user_id is null then return new; end if;
  -- 0219: create_game_complete tells everyone at the end, with their setup; a game not yet announced tells no one yet.
  if coalesce(current_setting('bnn.defer_game_added', true), '') = 'on' then return new; end if;
  select players_notified_at is not null into v_announced from games where id = new.game_id;
  if v_announced is distinct from true then return new; end if;
  v_note := public.game_added_note(new.game_id, new.id);
  if v_note is null then return new; end if;
  insert into notifications (user_id, message, group_id, type, link, detail)
  values (new.user_id, v_note->>'message', (v_note->>'group_id')::uuid, 'game_added', v_note->>'link', v_note->>'detail');
  return new;
end $$;

-- The player's own setup, appended to the notification once the line-up exists.
create or replace function public.game_setup_line(p_game uuid, p_player uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare g record; me record; k text; f jsonb; side text; mates text[]; opps text[]; tname text; line text := ''; grp text := ''; pr jsonb; opp text;
begin
  select game_type, teams, pairings, foursomes, scramble_mode into g from games where id = p_game;
  select id, user_id, team, tee_group into me from game_players where id = p_player and game_id = p_game;
  if me.id is null then return ''; end if;
  k := coalesce(me.user_id::text, me.id::text);
  if me.tee_group is not null then grp := 'Group ' || me.tee_group; end if;
  select t->>'name' into tname from jsonb_array_elements(coalesce(g.teams, '[]')) t where t->>'key' = me.team limit 1;
  -- a team / foursome game: who is on my side, and who is on the other
  select x into f from jsonb_array_elements(case when jsonb_typeof(g.foursomes) = 'array' then g.foursomes else '[]' end) x
   where (x->'a') ? k or (x->'b') ? k limit 1;
  if f is not null then
    side := case when (f->'a') ? k then 'a' else 'b' end;
    select array_agg(gp.display_name order by ord) into mates
      from jsonb_array_elements_text(f->side) with ordinality s(key, ord)
      join game_players gp on gp.game_id = p_game and coalesce(gp.user_id::text, gp.id::text) = s.key where s.key <> k;
    select array_agg(gp.display_name order by ord) into opps
      from jsonb_array_elements_text(f->(case side when 'a' then 'b' else 'a' end)) with ordinality s(key, ord)
      join game_players gp on gp.game_id = p_game and coalesce(gp.user_id::text, gp.id::text) = s.key;
    if g.game_type = 'scramble' and coalesce(g.scramble_mode, 'field') <> 'match' then
      line := coalesce(f->>'name', 'Your team') || case when mates is not null then ' with ' || public.join_names(mates) else '' end;
    else
      line := concat_ws(', ', tname, case when mates is not null then 'with ' || public.join_names(mates) end,
                        case when opps is not null then 'v ' || array_to_string(opps, ' & ') end);
    end if;
    return concat_ws(' · ', nullif(line, ''), nullif(grp, ''));
  end if;
  -- a matchup game: my opponent
  select x into pr from jsonb_array_elements(coalesce(g.pairings, '[]')) x where x->>'a' = k or x->>'b' = k limit 1;
  if pr is not null then
    select gp.display_name into opp from game_players gp
     where gp.game_id = p_game and coalesce(gp.user_id::text, gp.id::text) = case when pr->>'a' = k then pr->>'b' else pr->>'a' end;
    return concat_ws(' · ', nullif(concat_ws(', ', tname, case when opp is not null then 'v ' || opp end), ''), nullif(grp, ''));
  end if;
  -- everyone for themselves: who is in my group (first names)
  if me.tee_group is null then return coalesce(tname, ''); end if;
  select array_agg(split_part(gp.display_name, ' ', 1) order by gp.created_at, gp.id) into mates
    from game_players gp where gp.game_id = p_game and gp.tee_group = me.tee_group and gp.id <> me.id and not coalesce(gp.no_show, false);
  return grp || case when mates is not null then ' with ' || public.join_names(mates) else '' end;
end $$;

-- Tell every member player once, with their setup. Organizer or club admin. Repeat calls do nothing.
create or replace function public.announce_game_players(p_game uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare g record; v_n integer := 0; r record; v_note jsonb; v_line text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select id, created_by, group_id, players_notified_at into g from games where id = p_game for update;
  if g.id is null then raise exception 'no such game' using errcode = 'P0002'; end if;
  if not (auth.uid() = g.created_by or exists (select 1 from group_members m where m.group_id = g.group_id and m.user_id = auth.uid() and m.role = 'admin' and m.status = 'active')) then
    raise exception 'only the organizer or a club admin can announce the game' using errcode = '42501';
  end if;
  if g.players_notified_at is not null then return 0; end if;
  for r in select id, user_id from game_players where game_id = p_game and user_id is not null order by created_at, id loop
    v_note := public.game_added_note(p_game, r.id);
    if v_note is null then continue; end if;
    v_line := public.game_setup_line(p_game, r.id);
    insert into notifications (user_id, message, group_id, type, link, detail)
    values (r.user_id, v_note->>'message', (v_note->>'group_id')::uuid, 'game_added', v_note->>'link',
            (v_note->>'detail') || case when coalesce(v_line, '') <> '' then ' · ' || v_line else '' end);
    v_n := v_n + 1;
  end loop;
  update games set players_notified_at = now() where id = p_game;
  return v_n;
end $$;

-- The one step: game, players and line-up together, then (unless deferred) the announcement. Organizer's own rights.
create or replace function public.create_game_complete(
  p_game jsonb, p_players jsonb, p_teams jsonb default '[]', p_groups jsonb default '[]',
  p_foursomes jsonb default null, p_announce boolean default true)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid := coalesce(nullif(p_game->>'id', '')::uuid, gen_random_uuid()); v_cols text; v_pcols text; v_bad text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_game) <> 'object' or jsonb_typeof(p_players) <> 'array' then raise exception 'p_game must be an object and p_players a list' using errcode = '22023'; end if;
  -- every field named must be a real column (a typo is an error, never silently dropped)
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(p_game) k
   where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'games' and c.column_name = k);
  if v_bad is null then
    select string_agg(distinct k, ', ') into v_bad from jsonb_array_elements(p_players) e, jsonb_object_keys(e) k
     where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'game_players' and c.column_name = k);
  end if;
  if v_bad is not null then raise exception 'unknown fields: %', v_bad using errcode = '22023'; end if;
  perform set_config('bnn.defer_game_added', 'on', true);
  select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(p_game - 'id' - 'created_by' - 'players_notified_at') k;
  execute format('insert into public.games (id, created_by%s) select $1, auth.uid()%s from jsonb_populate_record(null::public.games, $2)',
                 coalesce(', ' || v_cols, ''), coalesce(', ' || v_cols, '')) using v_id, p_game;
  select string_agg(distinct quote_ident(k), ', ') into v_pcols from jsonb_array_elements(p_players) e, jsonb_object_keys(e - 'game_id') k;
  if v_pcols is not null then
    execute format('insert into public.game_players (game_id, %s) select $1, %s from jsonb_populate_recordset(null::public.game_players, $2)', v_pcols, v_pcols)
      using v_id, p_players;
  end if;
  if coalesce(jsonb_array_length(p_teams), 0) > 0 or coalesce(jsonb_array_length(p_groups), 0) > 0 or p_foursomes is not null then
    perform public.apply_game_structure(v_id, coalesce(p_teams, '[]'), coalesce(p_groups, '[]'), p_foursomes);
  end if;
  perform set_config('bnn.defer_game_added', 'off', true);
  if p_announce then
    update public.games set players_notified_at = null where id = v_id;
    perform public.announce_game_players(v_id);
  else
    update public.games set players_notified_at = null where id = v_id;
  end if;
  return v_id;
end $$;

revoke all on function public.join_names(text[]) from public, anon, authenticated;
revoke all on function public.game_added_note(uuid, uuid) from public, anon, authenticated;
revoke all on function public.game_setup_line(uuid, uuid) from public, anon, authenticated;
revoke all on function public.announce_game_players(uuid) from public, anon;
grant execute on function public.announce_game_players(uuid) to authenticated;
revoke all on function public.create_game_complete(jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.create_game_complete(jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to authenticated;

select public.record_migration('0219_create_game_complete');

commit;
