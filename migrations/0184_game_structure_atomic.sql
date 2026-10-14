-- 0184_game_structure_atomic.sql
--
-- External review (Oct 13), finding 4: team balancing saved each player's team with a separate
-- request, ignored failures, then built the foursomes from the PROPOSED assignment — one failed write
-- left a player on the old team inside a foursome built as if they had moved. Balanced matchups
-- saved tee groups and foursomes in two separate steps.
--
-- apply_game_structure writes the whole structure — teams, tee groups, and the foursomes built from
-- them — in ONE transaction: all of it lands or none of it does. Validated on the server: every
-- player must belong to this game, every team key must be one of the game's teams, and a player who
-- already has a score cannot change team (the rule the app's setup engine applies, enforced here).
--
-- AUTHORIZATION: SECURITY DEFINER; authenticated; the game's organizer or an active admin of its
-- club — the same rule as set_tee_groups (0061).
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.apply_game_structure(p_game uuid, p_teams jsonb, p_groups jsonb, p_foursomes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; v_keys text[]; v_bad text; v_teams int := 0; v_groups int := 0;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select id, created_by, group_id, teams into g from games where id = p_game for update;
  if g.id is null then raise exception 'no such game' using errcode = 'P0002'; end if;
  if not (auth.uid() = g.created_by or exists (select 1 from group_members m where m.group_id = g.group_id and m.user_id = auth.uid() and m.role = 'admin' and m.status = 'active')) then
    raise exception 'only the organizer or a club admin can change the line-up' using errcode = '42501';
  end if;

  -- Every named player belongs to this game.
  select string_agg(x.pid::text, ', ') into v_bad
    from (select (e->>'player')::uuid pid from jsonb_array_elements(coalesce(p_teams, '[]')) e
          union select (e->>'player')::uuid from jsonb_array_elements(coalesce(p_groups, '[]')) e) x
   where not exists (select 1 from game_players gp where gp.id = x.pid and gp.game_id = p_game);
  if v_bad is not null then raise exception 'not players in this game: %', v_bad using errcode = '22023'; end if;

  -- Team keys must be the game's own.
  select array_agg(t->>'key') into v_keys from jsonb_array_elements(coalesce(g.teams, '[]')) t;
  select string_agg(distinct e->>'team', ', ') into v_bad from jsonb_array_elements(coalesce(p_teams, '[]')) e
   where e->>'team' is not null and not ((e->>'team') = any(coalesce(v_keys, '{}')));
  if v_bad is not null then raise exception 'unknown team: %', v_bad using errcode = '22023'; end if;

  -- A player who has a score cannot change team.
  select string_agg(gp.display_name, ', ') into v_bad
    from jsonb_array_elements(coalesce(p_teams, '[]')) e
    join game_players gp on gp.id = (e->>'player')::uuid
   where gp.team is distinct from (e->>'team')
     and exists (select 1 from jsonb_array_elements(coalesce(gp.scores, '[]')) s where s <> 'null'::jsonb);
  if v_bad is not null then raise exception 'already scoring, cannot change team: %', v_bad using errcode = '55000'; end if;

  update game_players gp set team = e->>'team'
    from jsonb_array_elements(coalesce(p_teams, '[]')) e
   where gp.id = (e->>'player')::uuid and gp.game_id = p_game and gp.team is distinct from (e->>'team');
  get diagnostics v_teams = row_count;

  update game_players gp
     set tee_group = nullif(e->>'group', '')::smallint,
         is_marker = case when nullif(e->>'group', '') is null then false else gp.is_marker end
    from jsonb_array_elements(coalesce(p_groups, '[]')) e
   where gp.id = (e->>'player')::uuid and gp.game_id = p_game and gp.tee_group is distinct from nullif(e->>'group', '')::smallint;
  get diagnostics v_groups = row_count;

  if p_foursomes is not null then
    update games set foursomes = p_foursomes where id = p_game;
  end if;

  return jsonb_build_object('teams_changed', v_teams, 'groups_changed', v_groups, 'foursomes_saved', p_foursomes is not null);
end $$;
revoke all on function public.apply_game_structure(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_game_structure(uuid, jsonb, jsonb, jsonb) to authenticated;

select public.record_migration('0184_game_structure_atomic');

commit;
