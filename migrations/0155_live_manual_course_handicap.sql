-- 0155_live_manual_course_handicap.sql
--
-- The public pages ignored manual course handicaps.
--
-- get_live_scorecard (0151) and get_live_competition (0152) each compute a player's `ch` by
-- deriving from handicap index, slope and rating WHENEVER those are present, falling back to
-- course_handicap only when they are not. A manual figure lives in course_handicap with
-- course_handicap_source = 'manual' (0153), and such players normally DO have an index -- so the
-- derivation always won and the entered number was silently discarded. Measured: a manual 12
-- scored as 18.87.
--
-- Both functions now prefer a manual figure, matching lib/game-shape.chBasis, the one rule every
-- client-side scorer uses.
--
-- AUTHORIZATION: unchanged. Both remain token-scoped public reads with the contracts stated in
-- 0151 and 0152 -- anonymous by design, authorized by an unguessable share_token, EXECUTE revoked
-- from public and granted to anon and authenticated. This migration changes one expression each.
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.get_live_scorecard(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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

  select * into g from games where share_token = p_token;
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
      'ended_at',         g.ended_at
    ),
    'players',         v_players,
    'pairings',        v_pairings,
    'foursomes',       v_foursomes,
    'alt_shot_scores', v_alt
  );
end;
$function$;

revoke all on function public.get_live_scorecard(text) from public;

revoke all on function public.get_live_scorecard(text) from public;
grant execute on function public.get_live_scorecard(text) to anon, authenticated;

create or replace function public.get_live_competition(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  c        competitions%rowtype;
  v_sessions jsonb;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  select * into c from competitions where share_token = p_token;
  if c.id is null then
    return null;
  end if;
  -- Same retention as a game link: a finished Cup stops resolving after three days.
  if c.status = 'complete' and c.completed_at is not null and c.completed_at < now() - interval '3 days' then
    return null;
  end if;

  select coalesce(jsonb_agg(sess order by sess_order), '[]'::jsonb)
  into v_sessions
  from (
    select
      s.session_order as sess_order,
      jsonb_build_object(
        'id',                  s.id,
        'name',                s.name,
        'format',              s.format,
        'session_order',       s.session_order,
        'play_date',           s.play_date,
        'points_per_match',    s.points_per_match,
        'planned_match_count', s.planned_match_count,
        -- null when the session has no linked game yet: the page shows it as not started.
        'game', case when g.id is null then null else jsonb_build_object(
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
          'ended_at',         g.ended_at
        ) end,
        'players',   coalesce(pl.players, '[]'::jsonb),
        'pairings',  coalesce(pr.pairings, '[]'::jsonb),
        'foursomes', coalesce(fo.foursomes, '[]'::jsonb),
        'alt_shot_scores', coalesce(al.rows, '[]'::jsonb)
      ) as sess
    from competition_sessions s
    left join games g on g.id = s.game_id
    left join lateral (
      select
        jsonb_agg(jsonb_build_object(
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
          'scores',    coalesce(gp.scores, '[]'::jsonb)
        ) order by gp.created_at) as players,
        coalesce(jsonb_object_agg(gp.user_id::text, gp.id::text) filter (where gp.user_id is not null), '{}'::jsonb)
          || coalesce(jsonb_object_agg(gp.id::text, gp.id::text), '{}'::jsonb) as umap
      from game_players gp where gp.game_id = g.id
    ) pl on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('a', pl.umap ->> (x ->> 'a'), 'b', pl.umap ->> (x ->> 'b'))) as pairings
      from jsonb_array_elements(coalesce(g.pairings, '[]'::jsonb)) x
    ) pr on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', f ->> 'id', 'name', f ->> 'name',
               'swap', coalesce((f ->> 'swap')::boolean, false),
               'a', (select coalesce(jsonb_agg(pl.umap ->> uid) filter (where pl.umap ->> uid is not null), '[]'::jsonb)
                     from jsonb_array_elements_text(coalesce(f -> 'a', '[]'::jsonb)) uid),
               'b', (select coalesce(jsonb_agg(pl.umap ->> uid) filter (where pl.umap ->> uid is not null), '[]'::jsonb)
                     from jsonb_array_elements_text(coalesce(f -> 'b', '[]'::jsonb)) uid)
             )) as foursomes
      from jsonb_array_elements(coalesce(g.foursomes, '[]'::jsonb)) f
    ) fo on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'foursome_id', a.foursome_id, 'side', a.side,
               'hole_index', a.hole_index, 'strokes', a.strokes
             ) order by a.foursome_id, a.side, a.hole_index) as rows
      from game_alt_shot_scores a where a.game_id = g.id
    ) al on true
    where s.competition_id = c.id
  ) q;

  return jsonb_build_object(
    -- The Cup's OWN roster: one row per person with a fixed A/B team, from competition_players.
    -- Deriving the roster from session player rows counts each human once PER SESSION, because
    -- game_players.id is a different row each time — a 6-a-side Cup reported "24 players, 12 v 12"
    -- on the public page (188.4).
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id',        cp.user_id,
               'display_name',   cp.display_name,
               'avatar_url',     cp.avatar_url,
               'team_key',       cp.team_key,
               'handicap_index', cp.handicap_index
             ) order by cp.team_key, cp.display_name)
      from competition_players cp where cp.competition_id = c.id
    ), '[]'::jsonb),
    'competition', jsonb_build_object(
      'name',            c.name,
      'location',        c.location,
      'start_date',      c.start_date,
      'status',          c.status,
      'team_a_name',     c.team_a_name,
      'team_b_name',     c.team_b_name,
      'tie_rule',        c.tie_rule,
      'schedule_status', c.schedule_status,
      'completed_at',    c.completed_at
    ),
    'sessions', v_sessions
  );
end;
$function$;


revoke all on function public.get_live_competition(text) from public;
grant execute on function public.get_live_competition(text) to anon, authenticated;

select public.record_migration('0155_live_manual_course_handicap');

commit;
