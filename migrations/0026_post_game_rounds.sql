-- 0026_post_game_rounds.sql
-- Post every player's scorecard to their Rounds history the MOMENT a game ends,
-- instead of waiting for each player to reopen the game on their own device.
-- SECURITY DEFINER so the organizer's "End game" can write rounds for all players
-- (RLS otherwise lets a user write only their own round). Idempotent: one round
-- per (game, user), updated in place (with its holes) if it already exists — so a
-- reopen/edit/re-end flows the corrected scores through.

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
begin
  select * into g from games where id = p_game;
  if not found then return; end if;
  -- Only the game's organizer may bulk-post (matches the "End game" gate).
  if g.created_by is distinct from auth.uid() then return; end if;

  hmeta := coalesce(g.holes_meta, '[]'::jsonb);
  n := jsonb_array_length(hmeta);

  for pl in
    select * from game_players where game_id = p_game and user_id is not null
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

    -- Upsert the round row (one per game+user).
    select id into rid from rounds where game_id = p_game and user_id = pl.user_id limit 1;
    if rid is not null then
      update rounds set
        course = g.course, tee_name = pl.tee_name, rating = pl.rating, slope = pl.slope,
        course_par = g.course_par, handicap_index = pl.handicap_index,
        course_handicap = pl.course_handicap, group_id = g.group_id,
        played_at = coalesce(g.created_at, now()), status = 'final', gross_score = gross
      where id = rid;
      delete from holes where round_id = rid;
    else
      insert into rounds (
        user_id, course, tee_name, rating, slope, course_par, handicap_index,
        course_handicap, group_id, played_at, status, gross_score, game_id
      ) values (
        pl.user_id, g.course, pl.tee_name, pl.rating, pl.slope, g.course_par, pl.handicap_index,
        pl.course_handicap, g.group_id, coalesce(g.created_at, now()), 'final', gross, p_game
      ) returning id into rid;
    end if;

    -- Rewrite per-hole detail for played holes only.
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

grant execute on function public.post_game_rounds(uuid) to authenticated;
