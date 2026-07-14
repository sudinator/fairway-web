-- 0103_game_autocomplete.sql
-- Auto-complete fully-scored games. When every player's holes are in but the organizer never tapped
-- "End game": (1) nudge the organizer 2h later to end it (noting it will auto-complete at end of day),
-- and (2) auto-end + post everyone's rounds at the end of the day (US Eastern), attributed
-- 'system:auto' — mirroring the stale in-progress ROUND sweep (0083, finish_stale_rounds). A game with
-- ANY partially-scored player is treated as still in progress and is never auto-completed.

alter table public.games add column if not exists scored_at    timestamptz; -- first seen fully scored
alter table public.games add column if not exists end_nudge_at timestamptz; -- organizer nudge sent

-- Posting body extracted so a system sweep can post WITHOUT being the organizer. post_game_rounds
-- keeps its organizer-only gate and delegates here; the sweep calls this directly with p_system=true.
-- Body is identical to the prior post_game_rounds (migration 0044) minus the auth gate, plus the
-- system attribution at the end. Keep in sync if the posting logic ever changes.
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

-- Organizer-gated wrapper (unchanged behavior for the client "End game" button).
create or replace function public.post_game_rounds(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_creator uuid;
begin
  select created_by into v_creator from games where id = p_game;
  if v_creator is null then return; end if;
  if v_creator is distinct from auth.uid() then return; end if;  -- organizer only
  perform public.post_game_rounds_internal(p_game, false);
end;
$$;
grant execute on function public.post_game_rounds(uuid) to authenticated;

-- The sweep: throttled to once/hour (system_jobs). Stamps scored_at when a game is fully scored,
-- clears it if a score is later removed, nudges the organizer 2h later, and auto-ends + posts at the
-- end of the ET day it became fully scored. Returns the number of games auto-completed.
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
    where status is distinct from 'ended' and created_at > now() - interval '30 days'
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
