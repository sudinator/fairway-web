-- 0210_scramble_handicap_methods.sql
--
-- 211.9 — Scramble handicaps, redesigned with the owner (Oct 21 2026). Two methods:
--   * "usga" — each team's handicap is worked out from its players' course handicaps with the allowance
--     percentages. The USGA's are the default (4 players 25/20/15/10, 3 players 30/20/10, 2 players 35/15, lowest
--     to highest), and a game may set its own (games.scramble_allowance: {"4": [30, 20, 15, 10], ...} — percent
--     per position, lowest course handicap first; a size without an entry uses the USGA's);
--   * "agreed" — the organizer enters each team's handicap, whatever the players agree (games.foursomes[].a_hcp /
--     b_hcp, 0209); a blank team plays scratch.
-- "gross" is no longer offered, but games created with it keep working. "Captains only" (team size 1 — each
-- team's captain uses the app, teammates play outside it) always uses agreed handicaps.
-- The live page's feed carries the game's percentages, so it ranks teams the same way as the app.
--
-- AUTHORIZATION: a check constraint, a column, and get_live_scorecard's output (still public by token — it now
-- also returns the game's allowance percentages). No grants.
-- TESTS: ci/assert-scramble.sql
--
-- Idempotent; safe to re-run.

begin;

alter table public.games add column if not exists scramble_allowance jsonb;
alter table public.games drop constraint if exists games_scramble_settings_chk;
alter table public.games add constraint games_scramble_settings_chk check (
  (scramble_team_size is null or scramble_team_size between 1 and 4)
  and (scramble_mode is null or scramble_mode in ('field', 'match'))
  and (scramble_handicap is null or scramble_handicap in ('usga', 'gross', 'agreed'))
  and (scramble_min_drives is null or scramble_min_drives between 1 and 9)
  and (scramble_allowance is null or jsonb_typeof(scramble_allowance) = 'object'));

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
      'scramble_allowance', g.scramble_allowance
    ),
    'players',         v_players,
    'pairings',        v_pairings,
    'foursomes',       v_foursomes,
    'alt_shot_scores', v_alt
  );
end;
$function$;

select public.record_migration('0210_scramble_handicap_methods');

commit;
