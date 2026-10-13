-- 0179_finish_game_closes_clocks.sql
--
-- Ending a game with a round clock still running failed with BN163 (staging game 718817, ended
-- after 9 holes, 2026-10-13).
--
-- finish_game_and_post_rounds closes every still-open round clock (game_players.clock_end). The
-- 0163 reset fence treats a clock_end change as a score write and requires the score context that
-- begin_game_score_write establishes — which the finish function never set. At 18 holes the clocks
-- are normally closed already, so it hid; end early and it fires every time. The function now sets
-- the context for its own, legitimate write — the organizer ending the game — at the game's current
-- scoring_version, before closing the clocks. Everything else in the function is unchanged (0130).
--
-- AUTHORIZATION: unchanged — SECURITY DEFINER, callers must be authenticated and the game's
-- organizer (auth.uid() = games.created_by); the primary-device check in the fence still applies.
-- Idempotent; safe to re-run.

begin;

create or replace function public.finish_game_and_post_rounds(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_version integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists (select 1 from games g where g.id=p_game and g.created_by=auth.uid()) then
    raise exception 'only the organizer can end the whole game' using errcode='42501';
  end if;
  update games set status='ended' where id=p_game;
  perform public.post_game_rounds_internal(p_game, false);
  -- Closing the clocks is a score-column write under the 0163 fence: establish the context first.
  select scoring_version into v_version from games where id=p_game;
  perform set_config('bnn.game_score_context', jsonb_build_object('game', p_game, 'version', v_version)::text, true);
  update game_players set clock_end=coalesce(clock_end, now())
   where game_id=p_game and clock_start is not null and clock_end is null;
end $$;
revoke all on function public.finish_game_and_post_rounds(uuid) from public, anon;
grant execute on function public.finish_game_and_post_rounds(uuid) to authenticated;

select public.record_migration('0179_finish_game_closes_clocks');

commit;
