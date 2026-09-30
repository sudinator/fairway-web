-- 0161_game_round_manual_handicap.sql
-- AUTHORIZATION: post_game_rounds_internal remains inaccessible to browser roles;
-- authorized finish/end/cron wrappers call it. post_group_rounds retains its
-- existing authenticated game-membership guard and grants. No wider write access.
-- Manual game handicaps already apply to the selected match length: preserve
-- the exact figure and its source/audit snapshot on both posting paths. Derived
-- nine-hole figures retain the existing halving approximation. No data backfill.

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
  parsum  int;
begin
  select * into g from games where id = p_game;
  if not found then return; end if;

  -- FORMATS THAT DO NOT POST TO HANDICAPS.
  -- Foursomes (alternate shot) is one ball per side, so the score belongs to the PAIR. After the
  -- score fan-out both partners' rows carry it, and posting would record it as each player's own
  -- individual round — a score neither of them shot alone. WHS does not accept a format that
  -- produces no individual score.
  -- Scramble is listed ahead of the format existing: the reason is identical, and an implementer
  -- should find the rule already here rather than rediscover it.
  if g.game_type in ('alt_shot', 'scramble') then return; end if;

  hmeta := coalesce(g.holes_meta, '[]'::jsonb);
  n := jsonb_array_length(hmeta);
  -- Par of the holes ACTUALLY in this game. For a nine this is a plain SUM, never half the course
  -- par: a back nine is commonly par 35 or 37, and half of 71 is 36 — wrong on both.
  select coalesce(sum((e->>'par')::int), 0) into parsum
  from jsonb_array_elements(hmeta) e;
  -- Games are scored live, so a round's recorded date is always the day it was scored (this first
  -- post). The game's play-date field is scheduling/display only. Re-posts preserve played_at, and an
  -- organizer can correct a whole game's date via set_game_played_date.
  rdate := (now() at time zone 'America/New_York')::date;

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
        course = g.course, tee_name = pl.tee_name,
        rating = case when n = 9 then pl.rating / 2.0 else pl.rating end,
        slope = pl.slope,                            -- slope is a RATIO: never halved
        course_par = case when n = 9 then parsum else g.course_par end,
        handicap_index = pl.handicap_index,
        course_handicap = case when n = 9 and coalesce(pl.course_handicap_source, 'derived') <> 'manual' then round(pl.course_handicap / 2.0)::int else pl.course_handicap end,
        course_handicap_source = coalesce(pl.course_handicap_source, 'derived'),
        course_handicap_set_by = pl.course_handicap_set_by,
        course_handicap_set_at = pl.course_handicap_set_at,
        group_id = g.group_id,
        status = 'final', gross_score = gross
      where id = rid;
    else
      insert into rounds (
        user_id, course, tee_name, rating, slope, course_par, handicap_index,
        course_handicap, course_handicap_source, course_handicap_set_by, course_handicap_set_at,
        group_id, played_at, status, gross_score, game_id
      ) values (
        pl.user_id, g.course, pl.tee_name,
        case when n = 9 then pl.rating / 2.0 else pl.rating end,
        pl.slope,                                    -- slope is a RATIO: never halved
        case when n = 9 then parsum else g.course_par end,
        pl.handicap_index,
        case when n = 9 and coalesce(pl.course_handicap_source, 'derived') <> 'manual' then round(pl.course_handicap / 2.0)::int else pl.course_handicap end,
        coalesce(pl.course_handicap_source, 'derived'), pl.course_handicap_set_by, pl.course_handicap_set_at,
        g.group_id, rdate, 'final', gross, p_game
      )
      on conflict (game_id, user_id) do update set
        course = excluded.course, tee_name = excluded.tee_name, rating = excluded.rating,
        slope = excluded.slope, course_par = excluded.course_par,
        handicap_index = excluded.handicap_index, course_handicap = excluded.course_handicap,
        course_handicap_source = excluded.course_handicap_source,
        course_handicap_set_by = excluded.course_handicap_set_by,
        course_handicap_set_at = excluded.course_handicap_set_at,
        group_id = excluded.group_id,
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
  parsum  int;
begin
  select * into g from games where id = p_game;
  if not found then return; end if;
  -- Caller must be a player in this game (any member can finish their group).
  if not exists (
    select 1 from game_players where game_id = p_game and user_id = auth.uid()
  ) then
    return;
  end if;

  -- FORMATS THAT DO NOT POST TO HANDICAPS.
  -- Foursomes (alternate shot) is one ball per side, so the score belongs to the PAIR. After the
  -- score fan-out both partners' rows carry it, and posting would record it as each player's own
  -- individual round — a score neither of them shot alone. WHS does not accept a format that
  -- produces no individual score.
  -- Scramble is listed ahead of the format existing: the reason is identical, and an implementer
  -- should find the rule already here rather than rediscover it.
  if g.game_type in ('alt_shot', 'scramble') then return; end if;

  hmeta := coalesce(g.holes_meta, '[]'::jsonb);
  n := jsonb_array_length(hmeta);
  -- Par of the holes ACTUALLY in this game. For a nine this is a plain SUM, never half the course
  -- par: a back nine is commonly par 35 or 37, and half of 71 is 36 — wrong on both.
  select coalesce(sum((e->>'par')::int), 0) into parsum
  from jsonb_array_elements(hmeta) e;
  -- Deliberately-entered date first, else the date it's actually scored.
  -- Games are scored live, so a round's recorded date is always the day it was scored (this first
  -- post). The game's play-date field is scheduling/display only. Re-posts preserve played_at, and an
  -- organizer can correct a whole game's date via set_game_played_date.
  rdate := (now() at time zone 'America/New_York')::date;

  for pl in
    select * from game_players
    where game_id = p_game and user_id is not null and tee_group = p_tee_group
  loop
    -- Tally entered holes + gross from the player's jsonb scores.
    gross := 0; entered := 0;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        entered := entered + 1;
        gross := gross + sc;
      end if;
    end loop;
    if entered = 0 then continue; end if;  -- didn't play

    -- Upsert the round row (one per game+user). ON CONFLICT keeps a racing client
    -- insert from aborting the whole post; it updates that row in place instead.
    select id into rid from rounds where game_id = p_game and user_id = pl.user_id limit 1;
    if rid is not null then
      update rounds set
        course = g.course, tee_name = pl.tee_name,
        rating = case when n = 9 then pl.rating / 2.0 else pl.rating end,
        slope = pl.slope,                            -- slope is a RATIO: never halved
        course_par = case when n = 9 then parsum else g.course_par end,
        handicap_index = pl.handicap_index,
        course_handicap = case when n = 9 and coalesce(pl.course_handicap_source, 'derived') <> 'manual' then round(pl.course_handicap / 2.0)::int else pl.course_handicap end,
        course_handicap_source = coalesce(pl.course_handicap_source, 'derived'),
        course_handicap_set_by = pl.course_handicap_set_by,
        course_handicap_set_at = pl.course_handicap_set_at,
        group_id = g.group_id,
        status = 'final', gross_score = gross
      where id = rid;
    else
      insert into rounds (
        user_id, course, tee_name, rating, slope, course_par, handicap_index,
        course_handicap, course_handicap_source, course_handicap_set_by, course_handicap_set_at,
        group_id, played_at, status, gross_score, game_id
      ) values (
        pl.user_id, g.course, pl.tee_name,
        case when n = 9 then pl.rating / 2.0 else pl.rating end,
        pl.slope,                                    -- slope is a RATIO: never halved
        case when n = 9 then parsum else g.course_par end,
        pl.handicap_index,
        case when n = 9 and coalesce(pl.course_handicap_source, 'derived') <> 'manual' then round(pl.course_handicap / 2.0)::int else pl.course_handicap end,
        coalesce(pl.course_handicap_source, 'derived'), pl.course_handicap_set_by, pl.course_handicap_set_at,
        g.group_id, rdate, 'final', gross, p_game
      )
      on conflict (game_id, user_id) do update set
        course = excluded.course, tee_name = excluded.tee_name, rating = excluded.rating,
        slope = excluded.slope, course_par = excluded.course_par,
        handicap_index = excluded.handicap_index, course_handicap = excluded.course_handicap,
        course_handicap_source = excluded.course_handicap_source,
        course_handicap_set_by = excluded.course_handicap_set_by,
        course_handicap_set_at = excluded.course_handicap_set_at,
        group_id = excluded.group_id,
        status = excluded.status, gross_score = excluded.gross_score
      returning id into rid;
    end if;

    -- Rewrite per-hole detail for played holes only.
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
end;
$$;

revoke all on function public.post_game_rounds_internal(uuid, boolean) from public, anon, authenticated;
revoke all on function public.post_group_rounds(uuid, integer) from public, anon;
grant execute on function public.post_group_rounds(uuid, integer) to authenticated;

select public.record_migration('0161_game_round_manual_handicap');
