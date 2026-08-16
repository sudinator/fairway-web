-- 0138_change_game_course_before_scoring.sql
-- Atomically replace an active, unscored game's course snapshot and invalidate
-- every player tee snapshot.
-- AUTHORIZATION: authenticated callers only; SECURITY DEFINER body locks the game and requires games.created_by = auth.uid() before any write. The organizer must deliberately select valid tees
-- from the new course after the change; no cross-course tee inference is allowed.

create or replace function public.change_game_course_before_scoring(
  p_game uuid,
  p_course text,
  p_course_par integer,
  p_holes_meta jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_n integer;
  v_blank jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_game
  from public.games
  where id = p_game
  for update;

  if not found then
    raise exception 'game not found' using errcode = 'P0002';
  end if;
  if v_game.created_by is distinct from auth.uid() then
    raise exception 'only the organizer can change the course' using errcode = '42501';
  end if;
  if coalesce(v_game.status, 'active') = 'ended' then
    raise exception 'ended games cannot change course' using errcode = '23514';
  end if;
  if nullif(btrim(p_course), '') is null then
    raise exception 'course is required' using errcode = '23514';
  end if;
  if p_course_par is null or p_course_par <= 0 then
    raise exception 'valid course par is required' using errcode = '23514';
  end if;
  if p_holes_meta is null or jsonb_typeof(p_holes_meta) <> 'array' or jsonb_array_length(p_holes_meta) = 0 then
    raise exception 'valid hole metadata is required' using errcode = '23514';
  end if;

  -- Lock player rows and re-check the authoritative score state inside this transaction.
  perform 1 from public.game_players where game_id = p_game for update;
  if exists (
    select 1
    from public.game_players gp,
         lateral jsonb_array_elements(coalesce(gp.scores, '[]'::jsonb)) s(value)
    where gp.game_id = p_game and s.value <> 'null'::jsonb
  ) then
    raise exception 'course cannot change after scoring begins' using errcode = '23514';
  end if;

  v_n := jsonb_array_length(p_holes_meta);
  select coalesce(jsonb_agg(null::jsonb), '[]'::jsonb)
    into v_blank
    from generate_series(1, v_n);

  update public.games
     set course = btrim(p_course),
         course_par = p_course_par,
         holes_meta = p_holes_meta
   where id = p_game;

  update public.game_players
     set tee_name = null,
         rating = null,
         slope = null,
         course_handicap = null,
         scores = v_blank,
         putts = v_blank,
         fairways = v_blank,
         penalties = v_blank,
         sand = v_blank,
         clock_start = null,
         clock_end = null,
         group_locked = false
   where game_id = p_game;
end $$;

revoke all on function public.change_game_course_before_scoring(uuid,text,integer,jsonb) from public;
revoke all on function public.change_game_course_before_scoring(uuid,text,integer,jsonb) from anon;
grant execute on function public.change_game_course_before_scoring(uuid,text,integer,jsonb) to authenticated;

select public.record_migration('0138_change_game_course_before_scoring');
