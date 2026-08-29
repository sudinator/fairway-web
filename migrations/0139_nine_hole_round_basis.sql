-- 0139_nine_hole_round_basis.sql
--
-- AUTHORIZATION: authenticated callers only. All three functions are SECURITY DEFINER and are
-- reachable only through the existing game/organizer paths, which already check membership and
-- ownership; this migration changes the VALUES written, never who may write them. EXECUTE is
-- revoked from public and anon and granted to authenticated, deny-by-default.
--
-- Post a NINE-hole game on a nine-hole basis.
--
-- THE BUG
-- A 9-hole game posted a round holding 9 holes but carrying the game's FULL values:
--   course_par      = 72  (the whole course -- course_par is deliberately never sliced)
--   course_handicap = the eighteen-hole figure
--   rating          = the eighteen-hole rating
-- Downstream, roundDifferential saw 9 holes against par 72 and took the PARTIAL-round path,
-- filling NINE phantom holes with net par. That is the pre-2024 combining method applied to holes
-- nobody intended to play, and it wrote a wrong differential into the player's record.
--
-- THE RULE
-- WHS accepts 9-hole scores -- immediately, since January 2024 -- provided the nine has a published
-- Course Rating and Slope Rating. Formats where you do not play your own ball (alternate shot,
-- scramble) still do not post, because they produce no individual score.
--
-- THE APPROXIMATION, STATED PLAINLY
--   rating -> half      par -> half      course_handicap -> half
--   slope  -> UNCHANGED
-- Slope is a RATIO on the 55-155 scale, not a stroke count: a published 9-hole Slope for a hard
-- nine is still ~140, not ~70. Halving it applies the difficulty adjustment twice -- 3.5 strokes
-- too few on a 113 course, 4.8 on a 155 course, and the error GROWS with difficulty, so it would
-- hurt exactly the players it should help most. lib/golf.ts nineHoleBasis() does the same for
-- rounds not posted from a game, and lib/nine-hole-posting.test.ts pins that error's size.
--
-- GolfCourseAPI publishes no per-nine ratings, so this is the best available. BNN is not the record
-- of truth for handicaps, and the app already approximates in this spirit when it fills an
-- unfinished round's missing holes with net par.
--
-- ONLY AN EXACT NINE (n = 9). A 10-17 hole round is an eighteen with holes missing and keeps the
-- net-par fill. Different situations; the code must not collapse them.
--
-- Regenerated from 0110_games_always_scored_date.sql, the LIVE definition -- 0045 has been
-- superseded twice and patching it would have changed nothing. Everything else is unchanged.

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
        course_handicap = case when n = 9 then round(pl.course_handicap / 2.0)::int else pl.course_handicap end,
        group_id = g.group_id,
        status = 'final', gross_score = gross
      where id = rid;
    else
      insert into rounds (
        user_id, course, tee_name, rating, slope, course_par, handicap_index,
        course_handicap, group_id, played_at, status, gross_score, game_id
      ) values (
        pl.user_id, g.course, pl.tee_name,
        case when n = 9 then pl.rating / 2.0 else pl.rating end,
        pl.slope,                                    -- slope is a RATIO: never halved
        case when n = 9 then parsum else g.course_par end,
        pl.handicap_index,
        case when n = 9 then round(pl.course_handicap / 2.0)::int else pl.course_handicap end,
        g.group_id, rdate, 'final', gross, p_game
      )
      on conflict (game_id, user_id) do update set
        course = excluded.course, tee_name = excluded.tee_name, rating = excluded.rating,
        slope = excluded.slope, course_par = excluded.course_par,
        handicap_index = excluded.handicap_index, course_handicap = excluded.course_handicap,
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
        course_handicap = case when n = 9 then round(pl.course_handicap / 2.0)::int else pl.course_handicap end,
        group_id = g.group_id,
        status = 'final', gross_score = gross
      where id = rid;
    else
      insert into rounds (
        user_id, course, tee_name, rating, slope, course_par, handicap_index,
        course_handicap, group_id, played_at, status, gross_score, game_id
      ) values (
        pl.user_id, g.course, pl.tee_name,
        case when n = 9 then pl.rating / 2.0 else pl.rating end,
        pl.slope,                                    -- slope is a RATIO: never halved
        case when n = 9 then parsum else g.course_par end,
        pl.handicap_index,
        case when n = 9 then round(pl.course_handicap / 2.0)::int else pl.course_handicap end,
        g.group_id, rdate, 'final', gross, p_game
      )
      on conflict (game_id, user_id) do update set
        course = excluded.course, tee_name = excluded.tee_name, rating = excluded.rating,
        slope = excluded.slope, course_par = excluded.course_par,
        handicap_index = excluded.handicap_index, course_handicap = excluded.course_handicap,
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

-- Organizer-only: correct a whole game's date. Moves the game's display/schedule date AND every
-- posted round for that game together, so all players stay in sync. Past-date confirmation is done
-- client-side. security definer so the organizer can touch other players' round rows (RLS-guarded).
create or replace function public.set_game_played_date(p_game uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from games where id = p_game and created_by = auth.uid()) then
    raise exception 'only the organizer can change the game date';
  end if;
  update games  set played_at = p_date where id = p_game;
  update rounds set played_at = p_date where game_id = p_game;
end;
$$;
grant execute on function public.set_game_played_date(uuid, date) to authenticated;

-- NOTE: 0110 ended with a one-time backfill that force-set every game round's played_at to its
-- creation date. It is deliberately NOT carried over here. Re-running it would overwrite any date
-- an organizer has corrected since, silently, across every game round in the database. Regenerating
-- a function from an older migration inherits that migration's DATA statements too, and those are
-- one-time by nature. 0139 redefines functions only.

-- Deny by default: these are SECURITY DEFINER and write into handicap records.
revoke all on function public.post_game_rounds_internal(uuid, boolean) from public;
revoke all on function public.post_game_rounds_internal(uuid, boolean) from anon;
revoke all on function public.post_group_rounds(uuid, integer) from public;
revoke all on function public.post_group_rounds(uuid, integer) from anon;
revoke all on function public.set_game_played_date(uuid, date) from public;
revoke all on function public.set_game_played_date(uuid, date) from anon;
grant execute on function public.post_group_rounds(uuid, integer) to authenticated;
grant execute on function public.set_game_played_date(uuid, date) to authenticated;

select public.record_migration('0139_nine_hole_round_basis');
