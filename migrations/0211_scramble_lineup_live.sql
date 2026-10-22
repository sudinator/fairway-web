-- 0211_scramble_lineup_live.sql
--
-- 212.1 — the line-up card and the live scorecard show a scramble properly (owner, Oct 21 2026). The line-up's feed
-- (get_live_lineup) now carries the scramble's method, its own percentages and whether it's captains only, so the
-- card shows each team with its team handicap and how it was worked out; the live feed (get_live_scorecard) adds
-- captains only, the one scramble setting it lacked. Nothing else changes.
--
-- AUTHORIZATION: unchanged — both stay public by token (anon + authenticated, as 0205 left them); they return only
-- what they returned before, plus these game settings.
-- TESTS: ci/assert-scramble.sql
--
-- Idempotent; safe to re-run.

begin;

CREATE OR REPLACE FUNCTION public.get_live_lineup(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g record;
  v_players jsonb;
  v_tees jsonb;
  v_date date;
begin
  if p_token is null or length(p_token) < 8 then return null; end if;
  select * into g from games where share_token = p_token or lineup_slug = p_token;
  if g.id is null then return null; end if;
  v_date := coalesce(g.played_at, (g.created_at at time zone 'America/New_York')::date);
  if g.status = 'ended' then
    return jsonb_build_object('ended', true, 'name', g.name, 'course', g.course, 'code', g.code, 'played_on', v_date);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',                     gp.id,
      'user_id',                gp.user_id,
      'display_name',           gp.display_name,
      'handicap_index',         gp.handicap_index,
      'course_handicap',        gp.course_handicap,
      'course_handicap_source', gp.course_handicap_source,
      'slope',                  gp.slope,
      'rating',                 gp.rating,
      'tee_name',               gp.tee_name,
      'team',                   gp.team,
      'tee_group',              gp.tee_group,
      'no_show',                coalesce(gp.no_show, false)
    ) order by gp.display_name), '[]'::jsonb)
    into v_players
    from game_players gp where gp.game_id = g.id;

  select coalesce(fc.data -> 'tees', '[]'::jsonb) into v_tees
    from favorite_courses fc
   where coalesce(fc.deleted, false) = false
     and (fc.name = g.course or (fc.data ->> 'name') = g.course)
   order by (exists (select 1 from group_courses gc where gc.course_id = fc.id and gc.group_id = g.group_id)) desc,
            fc.created_at asc
   limit 1;

  return jsonb_build_object(
    'ended',         false,
    'id',            g.id,
    'code',          g.code,
    'name',          g.name,
    'course',        g.course,
    'played_on',     v_date,
    'played_at',     to_char(v_date, 'Dy Mon FMDD'),
    'game_type',     g.game_type,
    'status',        g.status,
    'allowance_pct', g.allowance_pct,
    'course_par',    g.course_par,
    'holes_meta',    coalesce(g.holes_meta, '[]'::jsonb),
    'teams',         g.teams,
    'pairings',      coalesce(g.pairings, '[]'::jsonb),
    'foursomes',     coalesce(g.foursomes, '[]'::jsonb),
    -- 0211: a scramble's teams, method and percentages, so the line-up can show team handicaps
    'scramble_mode',      g.scramble_mode,
    'scramble_handicap',  g.scramble_handicap,
    'scramble_allowance', g.scramble_allowance,
    'scramble_team_size', g.scramble_team_size,
    'players',       v_players,
    'course_tees',   coalesce(v_tees, '[]'::jsonb),
    'as_of',         now()
  );
end $function$;

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
      'scramble_handicap', g.scramble_handicap,
      -- 0210: the game's own allowance percentages (null = the USGA defaults)
      'scramble_allowance', g.scramble_allowance,
      'scramble_team_size', g.scramble_team_size   -- 0211: captains only (1)
    ),
    'players',         v_players,
    'pairings',        v_pairings,
    'foursomes',       v_foursomes,
    'alt_shot_scores', v_alt
  );
end;
$function$;

select public.record_migration('0211_scramble_lineup_live');

commit;
