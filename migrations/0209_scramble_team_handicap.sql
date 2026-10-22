-- 0209_scramble_team_handicap.sql
--
-- 211.8 — Scramble: one app player per team, and team handicaps entered directly (owner, Oct 21 2026). At an
-- outing, only one golfer per team may use BNN: their teammates stay outside the app, the player scores for the
-- team, and the team handicap comes from the outing (there is nothing to calculate it from). And for any scramble,
-- the organizer may enter a team's handicap instead of the calculated USGA allowance.
--   * games.scramble_team_size may be 1 ("teammates play outside the app"); a team then has one player;
--   * a team's entered handicap is stored on its group (games.foursomes[].a_hcp / .b_hcp — null = calculated);
--     the organizer sets it in Setup → Teams (the games row is the organizer's to change);
--   * save_scramble_side_score accepts a one-player team only in a game set up that way (otherwise 2–4 as before);
--   * the live page's feed carries the entered handicaps, so it ranks teams the same way as the app.
--
-- AUTHORIZATION: unchanged — save_scramble_side_score keeps its permission rules (not callable directly; through
-- save_scramble_score_fenced, authenticated); get_live_scorecard stays public by token.
-- TESTS: ci/assert-scramble.sql
--
-- Idempotent; safe to re-run.

begin;

alter table public.games drop constraint if exists games_scramble_settings_chk;
alter table public.games add constraint games_scramble_settings_chk check (
  (scramble_team_size is null or scramble_team_size between 1 and 4)
  and (scramble_mode is null or scramble_mode in ('field', 'match'))
  and (scramble_handicap is null or scramble_handicap in ('usga', 'gross'))
  and (scramble_min_drives is null or scramble_min_drives between 1 and 9));

CREATE OR REPLACE FUNCTION public.save_scramble_side_score(p_game uuid, p_foursome_id text, p_side text, p_hole_index integer, p_strokes integer, p_drive_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_game public.games%rowtype; v_foursome jsonb; v_side_members jsonb; v_authorized boolean := false; v_tee_group smallint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_game is null then raise exception 'Game is required'; end if;
  if nullif(btrim(p_foursome_id), '') is null then raise exception 'Group is required'; end if;
  if p_side not in ('a', 'b') then raise exception 'Scramble team side must be a or b'; end if;
  if p_hole_index is null or p_hole_index < 0 or p_hole_index > 17 then raise exception 'Hole index must be between 0 and 17'; end if;
  if p_strokes is not null and (p_strokes < 1 or p_strokes > 30) then raise exception 'Strokes must be between 1 and 30'; end if;

  select g.* into v_game from public.games g where g.id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.game_type is distinct from 'scramble' then raise exception 'Team scoring here is only valid for a Scramble'; end if;

  select f into v_foursome from jsonb_array_elements(coalesce(v_game.foursomes, '[]'::jsonb)) as f where f ->> 'id' = p_foursome_id limit 1;
  if v_foursome is null then raise exception 'Scramble group not found'; end if;
  v_side_members := coalesce(v_foursome -> p_side, '[]'::jsonb);
  -- 0209: a one-player team (its teammates play outside the app) only when the game is set up that way
  if jsonb_typeof(v_side_members) <> 'array' or jsonb_array_length(v_side_members) not between (case when v_game.scramble_team_size = 1 then 1 else 2 end) and 4 then
    raise exception 'A scramble team has 2 to 4 players';
  end if;
  if p_drive_key is not null and not (v_side_members ? p_drive_key) then
    raise exception 'That drive belongs to someone who isn''t on this team';
  end if;

  -- The same permission rules as alternate shot (save_alt_shot_side_score).
  select gp.tee_group into v_tee_group from public.game_players gp
   where gp.game_id = p_game and (v_side_members ? coalesce(gp.user_id::text, gp.id::text)) and gp.tee_group is not null
   order by gp.tee_group limit 1;
  if public.is_admin() then v_authorized := true;
  elsif v_game.created_by = auth.uid() then v_authorized := true;
  elsif v_game.marker_user_id = auth.uid() then v_authorized := true;
  elsif v_tee_group is not null and public.is_tee_group_marker(p_game, v_tee_group) then v_authorized := true;
  else
    v_authorized := exists (select 1 from public.game_players gp where gp.game_id = p_game and gp.user_id = auth.uid()
                             and (v_side_members ? coalesce(gp.user_id::text, gp.id::text)));
  end if;
  if not v_authorized then raise exception 'You are not allowed to score this scramble team'; end if;

  insert into public.game_alt_shot_scores (game_id, foursome_id, side, hole_index, strokes, drive_key, updated_at, updated_by)
  values (p_game, p_foursome_id, p_side, p_hole_index, p_strokes, p_drive_key, now(), auth.uid())
  on conflict (game_id, foursome_id, side, hole_index)
  do update set strokes = excluded.strokes, drive_key = excluded.drive_key, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  if p_strokes is not null then
    update public.games set alt_shot_scoring_started_at = coalesce(alt_shot_scoring_started_at, now()) where id = p_game;
  end if;
end $function$;
revoke all on function public.save_scramble_side_score(uuid, text, text, integer, integer, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_live_scorecard(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g           games%rowtype;
  v_players   jsonb;
  v_umap      jsonb;
  v_pairings  jsonb;
  v_foursomes jsonb;
  v_alt       jsonb;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  select * into g from games where share_token = p_token or lineup_slug = p_token;
  if g.id is null then
    return null;
  end if;
  if g.status = 'ended' and g.ended_at is not null and g.ended_at < now() - interval '3 days' then
    return null;
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id',              gp.id,
      'display_name',    gp.display_name,
      'avatar_url',      gp.avatar_url,
      'course_handicap', gp.course_handicap,
      -- A MANUAL course handicap is authoritative and must not be re-derived (0153/0155).
      -- Deriving whenever index/slope/rating exist meant the public pages ignored the
      -- entered figure entirely: a manual 12 was scored as 18.87.
      'ch', case
              when gp.course_handicap_source = 'manual' and gp.course_handicap is not null
              then gp.course_handicap
              when gp.handicap_index is not null and gp.slope is not null
                   and gp.rating is not null and g.course_par is not null
              then gp.handicap_index * (gp.slope / 113.0) + (gp.rating - g.course_par)
              else coalesce(gp.course_handicap, 0)
            end,
      'team',      gp.team,
      'tee_group', gp.tee_group,
      'no_show',   coalesce(gp.no_show, false),
      'scores',    coalesce(gp.scores,    '[]'::jsonb),
      'putts',     coalesce(gp.putts,     '[]'::jsonb),
      'fairways',  coalesce(gp.fairways,  '[]'::jsonb),
      'penalties', coalesce(gp.penalties, '[]'::jsonb),
      'sand',      coalesce(gp.sand,      '[]'::jsonb)
    ) order by gp.created_at), '[]'::jsonb),
    -- Both keys. A member is referenced by user_id in pairings/foursomes; a GUEST has no user_id and
    -- is referenced by their game_players.id. Mapping only the former dropped every guest (0151).
    coalesce(
      jsonb_object_agg(gp.user_id::text, gp.id::text) filter (where gp.user_id is not null),
      '{}'::jsonb
    ) || coalesce(jsonb_object_agg(gp.id::text, gp.id::text), '{}'::jsonb)
  into v_players, v_umap
  from game_players gp
  where gp.game_id = g.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'a', v_umap ->> (pr ->> 'a'),
           'b', v_umap ->> (pr ->> 'b')
         )), '[]'::jsonb)
  into v_pairings
  from jsonb_array_elements(coalesce(g.pairings, '[]'::jsonb)) pr;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',   f ->> 'id',
           'name', f ->> 'name',
           'swap', coalesce((f ->> 'swap')::boolean, false),
           -- 0209: a scramble team handicap entered by the organizer (null = calculated from its players)
           'a_hcp', case when jsonb_typeof(f -> 'a_hcp') = 'number' then f -> 'a_hcp' end,
           'b_hcp', case when jsonb_typeof(f -> 'b_hcp') = 'number' then f -> 'b_hcp' end,
           'a', (select coalesce(jsonb_agg(v_umap ->> uid) filter (where v_umap ->> uid is not null), '[]'::jsonb)
                 from jsonb_array_elements_text(coalesce(f -> 'a', '[]'::jsonb)) uid),
           'b', (select coalesce(jsonb_agg(v_umap ->> uid) filter (where v_umap ->> uid is not null), '[]'::jsonb)
                 from jsonb_array_elements_text(coalesce(f -> 'b', '[]'::jsonb)) uid)
         )), '[]'::jsonb)
  into v_foursomes
  from jsonb_array_elements(coalesce(g.foursomes, '[]'::jsonb)) f;

  -- Alternate Shot side scores. One row per (foursome, side, hole). NULL strokes is a deliberate
  -- clear tombstone and is preserved as json null.
  select coalesce(jsonb_agg(jsonb_build_object(
           'foursome_id', s.foursome_id,
           'side',        s.side,
           'hole_index',  s.hole_index,
           'strokes',     s.strokes
         ) order by s.foursome_id, s.side, s.hole_index), '[]'::jsonb)
  into v_alt
  from game_alt_shot_scores s
  where s.game_id = g.id;

  return jsonb_build_object(
    'game', jsonb_build_object(
      'name',             g.name,
      'course',           g.course,
      'course_par',       g.course_par,
      'game_type',        g.game_type,
      'status',           g.status,
      'allowance_pct',    g.allowance_pct,
      'team_score_mode',  g.team_score_mode,
      'trifecta_scoring', g.trifecta_scoring,
      'stroke_basis',     g.stroke_basis,
      'teams',            coalesce(g.teams, '[]'::jsonb),
      'holes_meta',       coalesce(g.holes_meta, '[]'::jsonb),
      'played_at',        g.played_at,
      'ended_at',         g.ended_at,
      -- 211.1: how a scramble's teams compete and are handicapped, so the live page can rank them
      'scramble_mode',     g.scramble_mode,
      'scramble_handicap', g.scramble_handicap
    ),
    'players',         v_players,
    'pairings',        v_pairings,
    'foursomes',       v_foursomes,
    'alt_shot_scores', v_alt
  );
end;
$function$;

select public.record_migration('0209_scramble_team_handicap');

commit;
