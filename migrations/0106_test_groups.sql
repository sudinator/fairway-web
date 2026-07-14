-- 0106_test_groups.sql
-- Mark a group as a TEST group (App Testing). Test-group games work fully — scoring, betting, money
-- ledger, live scorecard — but they NEVER post to individual Rounds / handicaps / stats, and they're
-- kept out of the ops sweep and stale-games panel so they generate no admin noise. Aggregate analytics
-- already exclude is_test PROFILES; combined with never creating test rounds, test activity stays fully
-- sandboxed. This recreates three functions from 0103/0104 with a test-group guard added.

alter table public.groups add column if not exists is_test boolean not null default false;
update public.groups set is_test = true where id = '41935c40-282b-4c61-8887-5d4554b764f7';  -- App Testing

create or replace function public.is_test_group(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_test from groups where id = p_group), false);
$$;
grant execute on function public.is_test_group(uuid) to authenticated;

-- (1) Posting: game-end + auto-complete both funnel through here. Bail before creating any rounds
--     when the game belongs to a test group.
create or replace function public.post_game_rounds_internal(p_game uuid, p_system boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  g       record;
  pl      record;
  rid     uuid;
  hmeta   jsonb;
  n       int;
  i       int;
  sc      int;
  gross   int;
  entered int;
  rdate   date;
begin
  select * into g from games where id = p_game;
  if not found then return; end if;
  if public.is_test_group(g.group_id) then return; end if;  -- test group: sandboxed, never posts rounds

  hmeta := coalesce(g.holes_meta, '[]'::jsonb);
  n := jsonb_array_length(hmeta);
  rdate := coalesce(g.played_at, g.created_at::date, current_date);

  for pl in
    select * from game_players where game_id = p_game and user_id is not null
  loop
    gross := 0; entered := 0;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        entered := entered + 1;
        gross := gross + sc;
      end if;
    end loop;
    if entered = 0 then continue; end if;

    select id into rid from rounds where game_id = p_game and user_id = pl.user_id limit 1;
    if rid is not null then
      update rounds set
        course = g.course, tee_name = pl.tee_name, rating = pl.rating, slope = pl.slope,
        course_par = g.course_par, handicap_index = pl.handicap_index,
        course_handicap = pl.course_handicap, group_id = g.group_id,
        played_at = rdate, status = 'final', gross_score = gross
      where id = rid;
    else
      insert into rounds (
        user_id, course, tee_name, rating, slope, course_par, handicap_index,
        course_handicap, group_id, played_at, status, gross_score, game_id
      ) values (
        pl.user_id, g.course, pl.tee_name, pl.rating, pl.slope, g.course_par, pl.handicap_index,
        pl.course_handicap, g.group_id, rdate, 'final', gross, p_game
      )
      on conflict (game_id, user_id) do update set
        course = excluded.course, tee_name = excluded.tee_name, rating = excluded.rating,
        slope = excluded.slope, course_par = excluded.course_par,
        handicap_index = excluded.handicap_index, course_handicap = excluded.course_handicap,
        group_id = excluded.group_id, played_at = excluded.played_at,
        status = excluded.status, gross_score = excluded.gross_score
      returning id into rid;
    end if;

    delete from holes where round_id = rid;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        insert into holes (
          round_id, hole_number, par, stroke_index, strokes, putts, fairway, penalties, sand, yardage
        ) values (
          rid,
          (hmeta->i->>'n')::int,
          (hmeta->i->>'par')::int,
          nullif(hmeta->i->>'si','')::int,
          sc,
          nullif(pl.putts->>i, '')::int,
          nullif(pl.fairways->>i, ''),
          coalesce(nullif(pl.penalties->>i, '')::int, 0),
          coalesce((pl.sand->>i)::boolean, false),
          nullif(hmeta->i->>'yards','')::int
        );
      end if;
    end loop;
  end loop;

  if p_system then
    update rounds set finished_by = 'system:auto', finished_at = coalesce(finished_at, now())
    where game_id = p_game;
  end if;
end;
$$;
grant execute on function public.post_game_rounds_internal(uuid, boolean) to authenticated;

-- (2) Sweep: skip test groups entirely — no organizer nudge, no auto-complete noise.
create or replace function public.sweep_stale_games()
returns int language plpgsql security definer set search_path = public as $fn$
declare
  v_last timestamptz; v_completed int := 0; v_scored timestamptz; autocomplete_ts timestamptz;
  g record; pl record; n int; i int; sc int; entered int; complete_players int; partial_players int; fully boolean;
begin
  select last_run into v_last from system_jobs where job = 'sweep_stale_games';
  if v_last is not null and v_last > now() - interval '1 hour' then return 0; end if;
  insert into system_jobs (job, last_run) values ('sweep_stale_games', now())
    on conflict (job) do update set last_run = now();

  for g in
    select * from games
    where status is distinct from 'ended'
      and created_at > now() - interval '30 days'
      and not public.is_test_group(group_id)
  loop
    n := jsonb_array_length(coalesce(g.holes_meta, '[]'::jsonb));
    if n = 0 then continue; end if;

    complete_players := 0; partial_players := 0;
    for pl in select * from game_players where game_id = g.id and user_id is not null loop
      entered := 0;
      for i in 0 .. n - 1 loop
        sc := nullif(pl.scores->>i, '')::int;
        if sc is not null and sc > 0 then entered := entered + 1; end if;
      end loop;
      if entered = n then complete_players := complete_players + 1;
      elsif entered > 0 then partial_players := partial_players + 1;
      end if;
    end loop;
    fully := (partial_players = 0 and complete_players >= 1);

    if not fully then
      if g.scored_at is not null then
        update games set scored_at = null, end_nudge_at = null where id = g.id;
      end if;
      continue;
    end if;

    if g.scored_at is null then
      update games set scored_at = now() where id = g.id;
      v_scored := now();
    else
      v_scored := g.scored_at;
    end if;

    autocomplete_ts := (date_trunc('day', v_scored at time zone 'America/New_York') + interval '1 day') at time zone 'America/New_York';

    if now() >= autocomplete_ts then
      perform public.post_game_rounds_internal(g.id, true);
      update games set status = 'ended', ended_at = coalesce(ended_at, now()) where id = g.id;
      v_completed := v_completed + 1;
    elsif g.end_nudge_at is null and now() >= v_scored + interval '2 hours' and g.created_by is not null then
      insert into notifications (user_id, message, group_id, type, link)
      values (
        g.created_by,
        'All scores are in for "' || coalesce(g.name, 'your game') || '". Tap to end the game and post everyone''s rounds — it will auto-complete at the end of today if you don''t.',
        g.group_id, 'game_autocomplete', '/?tab=games'
      );
      update games set end_nudge_at = now() where id = g.id;
    end if;
  end loop;

  return v_completed;
end $fn$;
grant execute on function public.sweep_stale_games() to authenticated;

-- (3) Stale-games admin panel: hide test groups so the ops view stays focused on real cleanup.
create or replace function public.admin_stale_games()
returns table (
  game_id uuid, name text, course text, club text, organizer text, holes int,
  created_at timestamptz, age_days numeric, players int,
  complete int, partial int, not_started int, verdict text, rounds_posted int
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;

  return query
  with ag as (
    select g.id, g.name, g.course, g.created_by, g.group_id, g.created_at,
           jsonb_array_length(coalesce(g.holes_meta, '[]'::jsonb)) as n
    from games g
    where g.status is distinct from 'ended'
      and g.created_at < now() - interval '24 hours'
      and not public.is_test_group(g.group_id)
  ),
  pp as (
    select ag.id as gid, ag.n,
           (select count(*) from generate_series(0, ag.n - 1) i
              where nullif(gp.scores->>i, '') is not null and (gp.scores->>i)::int > 0) as entered
    from ag join game_players gp on gp.game_id = ag.id
    where gp.user_id is not null and ag.n > 0
  ),
  agg as (
    select gid,
           count(*)::int                                          as players,
           count(*) filter (where entered = n)::int               as complete,
           count(*) filter (where entered > 0 and entered < n)::int as partial,
           count(*) filter (where entered = 0)::int               as not_started
    from pp group by gid
  )
  select
    ag.id,
    coalesce(ag.name, '(unnamed)')::text,
    ag.course::text,
    coalesce(gr.name, ag.group_id::text)::text,
    coalesce(p.display_name, p.email, ag.created_by::text)::text,
    ag.n,
    ag.created_at,
    round(extract(epoch from (now() - ag.created_at)) / 86400.0, 1),
    coalesce(a.players, 0),
    coalesce(a.complete, 0),
    coalesce(a.partial, 0),
    coalesce(a.not_started, 0),
    (case
       when coalesce(a.players, 0) = 0        then 'empty'
       when a.partial = 0 and a.complete >= 1 then 'fully_scored'
       when a.partial > 0                     then 'in_progress'
       else 'no_scores'
     end)::text,
    (select count(*)::int from rounds r where r.game_id = ag.id and r.deleted_at is null)
  from ag
  left join agg a      on a.gid = ag.id
  left join profiles p on p.id  = ag.created_by
  left join groups gr  on gr.id = ag.group_id
  order by
    case when a.partial = 0 and coalesce(a.complete, 0) >= 1 then 0
         when coalesce(a.players, 0) = 0 then 1
         when a.partial > 0 then 2
         else 3 end,
    ag.created_at asc;
end;
$$;
grant execute on function public.admin_stale_games() to authenticated;
