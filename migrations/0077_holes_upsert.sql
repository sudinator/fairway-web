-- 0077_holes_upsert.sql
-- Make the per-hole writes in the round-posting functions idempotent under concurrency.
-- Both post_game_rounds and post_group_rounds do `delete from holes where round_id = rid`
-- then insert one row per played hole. Under READ COMMITTED, two concurrent posts of the
-- same (game,user) each snapshot no committed holes, so both delete-nothing and both insert
-- a full set -> the round ends up with every hole doubled (36 rows for 18), which doubles
-- gross/net/Stableford and the scoring buckets and renders each hole twice.
--
-- Fix: the hole insert now uses ON CONFLICT (round_id, hole_number) DO UPDATE, so the losing
-- racer updates the existing row in place instead of inserting a duplicate. Requires the
-- unique index from 0076 (holes_round_hole_uk) — run 0076 first.
-- Only the hole-insert clause changed; everything else matches 0044/0045.

create or replace function public.post_game_rounds(p_game uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
  if g.created_by is distinct from auth.uid() then return; end if;

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
        )
        on conflict (round_id, hole_number) do update set
          par = excluded.par, stroke_index = excluded.stroke_index, strokes = excluded.strokes,
          putts = excluded.putts, fairway = excluded.fairway, penalties = excluded.penalties,
          sand = excluded.sand, yardage = excluded.yardage;
      end if;
    end loop;
  end loop;
end;
$$;

grant execute on function public.post_game_rounds(uuid) to authenticated;

create or replace function public.post_group_rounds(p_game uuid, p_tee_group int)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
  if not exists (
    select 1 from game_players where game_id = p_game and user_id = auth.uid()
  ) then
    return;
  end if;

  hmeta := coalesce(g.holes_meta, '[]'::jsonb);
  n := jsonb_array_length(hmeta);
  rdate := coalesce(g.played_at, g.created_at::date, current_date);

  for pl in
    select * from game_players
    where game_id = p_game and user_id is not null and tee_group = p_tee_group
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
        )
        on conflict (round_id, hole_number) do update set
          par = excluded.par, stroke_index = excluded.stroke_index, strokes = excluded.strokes,
          putts = excluded.putts, fairway = excluded.fairway, penalties = excluded.penalties,
          sand = excluded.sand, yardage = excluded.yardage;
      end if;
    end loop;
  end loop;
end;
$$;

grant execute on function public.post_group_rounds(uuid, int) to authenticated;
