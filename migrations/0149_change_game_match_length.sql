-- 0149_change_game_match_length.sql
-- Atomically change an active, unscored game's hole selection while preserving
-- players, tees, teams, groups, matchups and contests.
-- AUTHORIZATION: authenticated callers only; SECURITY DEFINER locks the game and
-- player rows, requires games.created_by = auth.uid(), and rechecks every score
-- source before changing the positional hole contract.

begin;

create or replace function public.change_game_match_length_before_scoring(
  p_game uuid,
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
    raise exception 'Authentication required';
  end if;

  select * into v_game
    from public.games
   where id = p_game
   for update;

  if not found then raise exception 'Game not found'; end if;
  if v_game.created_by is distinct from auth.uid() then
    raise exception 'Only the game organizer can change the number of holes';
  end if;
  if coalesce(v_game.status, 'active') = 'ended' then
    raise exception 'Ended games cannot change the number of holes';
  end if;

  if p_holes_meta is null
     or jsonb_typeof(p_holes_meta) <> 'array'
     or jsonb_array_length(p_holes_meta) not in (9, 18)
     or exists (
       select 1
         from jsonb_array_elements(p_holes_meta) h
        where jsonb_typeof(h) <> 'object'
           or coalesce((h->>'n')::integer, 0) <= 0
           or coalesce((h->>'par')::integer, 0) <= 0
     )
     or (
       select count(distinct h->>'n')
         from jsonb_array_elements(p_holes_meta) h
     ) <> jsonb_array_length(p_holes_meta) then
    raise exception 'Valid unique metadata for 9 or 18 holes is required';
  end if;

  perform 1 from public.game_players where game_id = p_game for update;

  if v_game.alt_shot_scoring_started_at is not null
     or exists (
       select 1
         from public.game_players gp,
              lateral jsonb_array_elements(coalesce(gp.scores, '[]'::jsonb)) s(value)
        where gp.game_id = p_game
          and s.value <> 'null'::jsonb
     )
     or exists (
       select 1 from public.game_alt_shot_scores ass where ass.game_id = p_game
     ) then
    raise exception 'The number of holes is locked once scoring begins';
  end if;

  v_n := jsonb_array_length(p_holes_meta);
  select coalesce(jsonb_agg(null::jsonb), '[]'::jsonb)
    into v_blank
    from generate_series(1, v_n);

  update public.games
     set holes_meta = p_holes_meta
   where id = p_game;

  update public.game_players
     set scores = v_blank,
         putts = v_blank,
         fairways = v_blank,
         penalties = v_blank,
         sand = v_blank,
         clock_start = null,
         clock_end = null,
         group_locked = false
   where game_id = p_game;
end;
$$;

revoke all on function public.change_game_match_length_before_scoring(uuid,jsonb)
  from public, anon;
grant execute on function public.change_game_match_length_before_scoring(uuid,jsonb)
  to authenticated;

select public.record_migration('0149_change_game_match_length');

commit;
