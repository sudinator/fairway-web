-- 0148_delete_competition_session_game.sql
-- Lets an authorized Cup manager remove a linked session game without deleting the
-- planned schedule row. Own-ball rounds remain historical; Alternate Shot shared-ball
-- rounds are removed with the game.
-- AUTHORIZATION: SECURITY DEFINER is restricted to authenticated callers and verifies
-- the canonical Cup organizer/club-admin/system-admin management predicate.

begin;

create or replace function public.delete_competition_session_game(p_game uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_session public.competition_sessions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to delete a Ryder Cup session game';
  end if;

  select * into v_game from public.games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;

  select * into v_session
    from public.competition_sessions
   where game_id = p_game
   for update;
  if not found then raise exception 'Game is not linked to a Ryder Cup session'; end if;

  if not public.can_manage_competition(v_session.competition_id, auth.uid()) then
    raise exception 'Only the Cup organizer or a club admin can delete this session game';
  end if;

  -- A game link is operational state, not a schedule/scoring-contract change. The
  -- locked-schedule guard deliberately permits this update.
  update public.competition_sessions set game_id = null where id = v_session.id;

  if v_game.game_type::text = 'alt_shot' then
    delete from public.holes h
     where h.round_id in (select r.id from public.rounds r where r.game_id = p_game);
    delete from public.rounds r where r.game_id = p_game;
  end if;

  delete from public.game_players gp where gp.game_id = p_game;
  delete from public.games g where g.id = p_game;
end;
$$;

revoke all on function public.delete_competition_session_game(uuid)
  from public, anon;
grant execute on function public.delete_competition_session_game(uuid)
  to authenticated;

select public.record_migration('0148_delete_competition_session_game');

commit;
