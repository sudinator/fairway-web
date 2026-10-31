-- 0233_club_score_and_report_contracts.sql
-- 212.77: authorized club settlements; ended-card protection; public manual-handicap source;
-- profile name changes preserve the original names on existing game records.
-- AUTHORIZATION: record_settlement adds active target-club membership, preserving party/admin checks.
-- Other functions retain their existing grants and scopes. No history/data rewrite.
-- TESTS: ci/assert-agreed-audit-fixes.sql, ci/assert-name-change.sql and report/live parity tests.
begin;

create or replace function public.record_settlement(
  p_group uuid, p_from uuid, p_to uuid, p_amount integer, p_method text,
  p_event uuid, p_status text, p_dedup text, p_allocs jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare s_id uuid; alloc_sum integer; rec jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.group_members gm
      where gm.group_id = p_group and gm.user_id = auth.uid() and gm.status = 'active') then
    raise exception 'Active club membership is required to record a payment' using errcode = '42501';
  end if;
  if not (p_from = auth.uid() or p_to = auth.uid()
          or exists (select 1 from group_members gm where gm.group_id = p_group and gm.user_id = auth.uid()
                     and gm.status = 'active' and gm.role in ('admin','owner'))) then
    raise exception 'not allowed to record this payment';
  end if;

  select coalesce(sum((e->>'amount_cents')::int), 0) into alloc_sum
    from jsonb_array_elements(coalesce(p_allocs, '[]'::jsonb)) e;
  if alloc_sum <> p_amount then
    raise exception 'allocations (%) must sum to the payment amount (%)', alloc_sum, p_amount;
  end if;

  insert into settlements (group_id, from_user_id, to_user_id, amount_cents, method, event_id, status, dedup_key, created_by)
    values (p_group, p_from, p_to, p_amount, p_method, p_event, coalesce(p_status, 'confirmed'), p_dedup, auth.uid())
    returning id into s_id;

  for rec in select * from jsonb_array_elements(coalesce(p_allocs, '[]'::jsonb)) loop
    insert into settlement_allocations (settlement_id, group_id, expense_id, amount_cents)
      values (s_id, p_group, nullif(rec->>'expense_id','')::uuid, (rec->>'amount_cents')::int);
  end loop;

  return s_id;
end $$;
grant execute on function public.record_settlement(uuid,uuid,uuid,integer,text,uuid,text,text,jsonb) to authenticated;


CREATE OR REPLACE FUNCTION public.guard_player_setup_locks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g record;
begin
  if public.setup_lock_exempt() then return new; end if;
  select status, game_type, teams, foursomes, alt_shot_scoring_started_at into g from games where id = new.game_id;
  if tg_op = 'INSERT' then
    if g.status = 'ended' then raise exception 'This game has ended. Reopen it before adding players.' using errcode = '55000'; end if;
    if public.game_scoring_started(new.game_id) and public.game_view(g.game_type, g.teams, g.foursomes) not in ('stableford', 'stroke', 'skins_individual') then
      raise exception 'Players can''t be added after scoring starts in a match or team contest — that would change the competitive structure.' using errcode = '55000';
    end if;
    return new;
  end if;
  if g.status = 'ended' then
    -- Late scores: participants cannot edit OR clear an ended card. Organizer resets remain authorized.
    if (old.scores, old.putts, old.fairways, old.penalties, old.sand) is distinct from (new.scores, new.putts, new.fairways, new.penalties, new.sand)
       and not exists (select 1 from games og where og.id = new.game_id and og.created_by = auth.uid()) then
      raise exception 'This game has ended, so its scores can''t change. Ask the organizer to reopen it.' using errcode = 'BN164';
    end if;
    -- 1: setup on an ended game
    if (old.team, old.tee_group, old.handicap_index, old.rating, old.slope, old.tee_name, old.course_handicap, old.course_handicap_source, old.no_show, old.flight)
       is distinct from (new.team, new.tee_group, new.handicap_index, new.rating, new.slope, new.tee_name, new.course_handicap, new.course_handicap_source, new.no_show, new.flight) then
      raise exception 'This game has ended. Reopen it before editing this setting.' using errcode = '55000';
    end if;
    return new;
  end if;
  -- 11: a scored player's team (a direct change; apply_game_structure already refuses it)
  if old.team is distinct from new.team
     and (public.jsonb_has_value(old.scores) or (g.game_type in ('alt_shot', 'scramble') and g.alt_shot_scoring_started_at is not null)) then
    raise exception '% already has scores. Team membership is frozen once that player''s scoring begins.', coalesce(new.display_name, 'This player') using errcode = '55000';
  end if;
  return new;
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
      'course_handicap_source', case when gp.course_handicap_source = 'manual' and gp.course_handicap is not null then 'manual' else 'derived' end,
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
      'skins_mode',       g.skins_mode,   -- 0218: how a tied skins hole is settled (carryover | split)
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
          'course_handicap_source', case when gp.course_handicap_source = 'manual' and gp.course_handicap is not null then 'manual' else 'derived' end,
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


create or replace function public.set_my_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_name text := nullif(trim(p_name), '');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if v_name is null or length(v_name) < 2 then raise exception 'Please enter your name.' using errcode = '22023'; end if;
  update profiles     set display_name = v_name where id      = auth.uid();
end $$;

revoke all on function public.set_my_display_name(text) from public;
grant execute on function public.set_my_display_name(text) to authenticated;


select public.record_migration('0233_club_score_and_report_contracts');
commit;
