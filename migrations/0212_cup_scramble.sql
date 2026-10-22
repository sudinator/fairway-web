-- 0212_cup_scramble.sql
--
-- 212.3 — Scramble as a Ryder Cup session format (owner, Oct 21 2026: "we should absolutely offer scramble in Ryder
-- Cup … it has to be the same number of players in a team facing off against the opponent"). A scramble session is a
-- set of team v team matches, one scramble team from each Cup side, every team of the session's size (2, 3 or 4);
-- points as other sessions (win 1, halve ½ each).
--   * competition_sessions.format accepts 'scramble'; competition_sessions.scramble_team_size (2–4);
--   * guard_competition_game_structure: a Cup scramble game is team v team, and no team is larger than the
--     session's size (setup requires every match to be exactly N v N before play); its trigger now also fires
--     when scramble_mode changes;
--   * get_live_competition carries each scramble game's handicap method, percentages and entered team handicaps.
--
-- AUTHORIZATION: a check constraint and column on competition_sessions; the guard trigger function (SECURITY
-- DEFINER, no grants); get_live_competition's output (still public by token). No grants.
-- TESTS: ci/assert-scramble.sql
--
-- Idempotent; safe to re-run.

begin;

alter table public.competition_sessions drop constraint if exists competition_sessions_format_check;
alter table public.competition_sessions add constraint competition_sessions_format_check check (format = any (array['fourball', 'alt_shot', 'match', 'trifecta', 'scramble']));
alter table public.competition_sessions add column if not exists scramble_team_size smallint;
alter table public.competition_sessions drop constraint if exists competition_sessions_scramble_team_size_check;
alter table public.competition_sessions add constraint competition_sessions_scramble_team_size_check check (scramble_team_size is null or scramble_team_size between 2 and 4);

CREATE OR REPLACE FUNCTION public.guard_competition_game_structure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cs public.competition_sessions%rowtype;
  c public.competitions%rowtype;
begin
  select * into cs from public.competition_sessions where game_id = old.id limit 1;
  if not found then return new; end if;
  select * into c from public.competitions where id = cs.competition_id;
  if new.group_id is distinct from c.group_id then raise exception 'Cup session game must remain in the Cup club'; end if;
  if new.game_type::text <> cs.format then raise exception 'Cup session format cannot change after linking'; end if;
  if cs.format = 'trifecta' and not public.valid_cup_trifecta_structure(new) then
    raise exception 'Cup Trifecta requires complete 2-v-2 foursomes, match scoring and best ball';
  end if;
  -- 0212: a Cup scramble is team v team, and no team may be larger than the session's size (owner: the two teams in
  -- a match have the same number of players; setup requires every match to be exactly N v N before play).
  if cs.format = 'scramble' then
    if new.scramble_mode is distinct from 'match' then raise exception 'A Ryder Cup scramble is team v team'; end if;
    if exists (select 1 from jsonb_array_elements(coalesce(new.foursomes, '[]'::jsonb)) f
                where jsonb_array_length(coalesce(f -> 'a', '[]'::jsonb)) > coalesce(cs.scramble_team_size, 2)
                   or jsonb_array_length(coalesce(f -> 'b', '[]'::jsonb)) > coalesce(cs.scramble_team_size, 2)) then
      raise exception 'Teams in this Ryder Cup scramble have % players each', coalesce(cs.scramble_team_size, 2);
    end if;
  end if;
  if jsonb_array_length(coalesce(to_jsonb(new.teams), '[]'::jsonb)) <> 2
     or coalesce(new.teams->0->>'key','') <> 'A'
     or coalesce(new.teams->1->>'key','') <> 'B'
     or coalesce(new.teams->0->>'name','') <> c.team_a_name
     or coalesce(new.teams->1->>'name','') <> c.team_b_name then
    raise exception 'Cup session team names cannot change after linking';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_live_competition(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c        competitions%rowtype;
  v_sessions jsonb;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  select * into c from competitions where share_token = p_token or share_slug = p_token;
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
          'ended_at',         g.ended_at,
          -- 0212: a scramble session's handicap method, percentages and mode
          'scramble_mode',      g.scramble_mode,
          'scramble_handicap',  g.scramble_handicap,
          'scramble_allowance', g.scramble_allowance,
          'scramble_team_size', g.scramble_team_size
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
               'a_hcp', case when jsonb_typeof(f -> 'a_hcp') = 'number' then f -> 'a_hcp' end,
               'b_hcp', case when jsonb_typeof(f -> 'b_hcp') = 'number' then f -> 'b_hcp' end,
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

-- the guard must also run when a scramble's mode changes (it ran only for the structure columns)
drop trigger if exists competition_game_structure_contract on public.games;
create trigger competition_game_structure_contract before update of group_id, game_type, teams, foursomes, trifecta_scoring, team_score_mode, scramble_mode
  on public.games for each row execute function public.guard_competition_game_structure();

select public.record_migration('0212_cup_scramble');

commit;
