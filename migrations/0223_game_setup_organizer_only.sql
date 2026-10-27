-- 0223_game_setup_organizer_only.sql
--
-- 212.52 — game SETUP is the organizer's (and system admins'), not every club admin's (owner, Oct 26: "a club admin can
-- save a game's teams and groups even if they are not a part of the game? that doesn't make sense" → "Organizer +
-- system admins only (match the app)"). The app only ever shows Manage Game to the game's creator, but six server
-- rules also let ANY active admin of the game's club act — even one not playing and not the creator:
--   apply_game_structure  (save the line-up: teams, groups, matches)        club admin → system admin
--   set_tee_groups        (save several players' groups)                    club admin → system admin
--   announce_game_players (send a draft to its players)                     club admin → system admin
--   set_player_bets       (turn a player's bets on or off)                  club admin → system admin
--   is_game_organizer     (side contests: create, change, delete, void)     club admin → system admin
--   drafts_private        (who can see a draft before it's sent)            club admin → removed
-- Each function is its current definition with only the club-admin condition swapped for public.is_admin() (system
-- admins: the admin tools), and the message corrected. Club admins keep their club powers elsewhere (members, the
-- Money tab, tee times); the tee-time link still checks the tee time's admin, as it should.
--
-- AUTHORIZATION: no grants change; the six rules narrow from "organizer or club admin" to "organizer or system admin".
-- TESTS: ci/assert-game-permissions.sql (who can do what, for every game function members can call)
--
-- Idempotent; safe to re-run.

begin;

CREATE OR REPLACE FUNCTION public.apply_game_structure(p_game uuid, p_teams jsonb, p_groups jsonb, p_foursomes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g record; v_keys text[]; v_bad text; v_teams int := 0; v_groups int := 0;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select id, created_by, group_id, teams into g from games where id = p_game for update;
  if g.id is null then raise exception 'no such game' using errcode = 'P0002'; end if;
  if not (auth.uid() = g.created_by or public.is_admin()) then
    raise exception 'only the organizer can change the line-up' using errcode = '42501';
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
end $function$;

CREATE OR REPLACE FUNCTION public.announce_game_players(p_game uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g record; v_n integer := 0; r record; v_note jsonb; v_line text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select id, created_by, group_id, players_notified_at into g from games where id = p_game for update;
  if g.id is null then raise exception 'no such game' using errcode = 'P0002'; end if;
  if not (auth.uid() = g.created_by or public.is_admin()) then
    raise exception 'only the organizer can send the game to its players' using errcode = '42501';
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
end $function$;

CREATE OR REPLACE FUNCTION public.set_tee_groups(p_game uuid, p_assignments jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare creator uuid; grp uuid;
begin
  select g.created_by, g.group_id into creator, grp from games g where g.id = p_game;
  if creator is null then raise exception 'no such game'; end if;
  if not (auth.uid() = creator
     or public.is_admin()) then
    raise exception 'not authorized to assign tee groups';
  end if;

  update game_players gp
     set tee_group = a.grp_num::smallint,
         is_marker = case when a.grp_num is null then false else gp.is_marker end
    from (
      select (elem->>'player')::uuid                as player_id,
             nullif(elem->>'group','')::int         as grp_num
      from jsonb_array_elements(p_assignments) elem
    ) a
   where gp.id = a.player_id
     and gp.game_id = p_game;   -- safety: only ever touch this game's players
end $function$;

CREATE OR REPLACE FUNCTION public.set_player_bets(p_player uuid, p_bets boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare gid uuid; creator uuid; grp uuid;
begin
  select gp.game_id into gid from game_players gp where gp.id = p_player;
  if gid is null then raise exception 'no such player'; end if;
  select g.created_by, g.group_id into creator, grp from games g where g.id = gid;
  if auth.uid() = creator
     or public.is_admin() then
    update game_players set bets = p_bets where id = p_player;
  else
    raise exception 'not authorized to set betting status';
  end if;
end $function$;

-- side contests (and anything else asking "is this the organizer?")
create or replace function public.is_game_organizer(p_game uuid) returns boolean
language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from games g where g.id = p_game and g.created_by = auth.uid())
      or coalesce(public.is_admin(), false);
$function$;

-- drafts: only the organizer (and system admins) until sent — "only I see it until I send it"
create or replace function public.game_announced_or_mine(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select g.players_notified_at is not null or g.created_by = auth.uid() or public.is_admin()
                     from games g where g.id = p_game), true)
$$;
revoke all on function public.game_announced_or_mine(uuid) from public, anon;
grant execute on function public.game_announced_or_mine(uuid) to authenticated;
drop policy if exists drafts_private on public.games;
create policy drafts_private on public.games as restrictive for all to authenticated
  using (players_notified_at is not null or created_by = auth.uid() or public.is_admin())
  with check (players_notified_at is not null or created_by = auth.uid() or public.is_admin());

select public.record_migration('0223_game_setup_organizer_only');

commit;
