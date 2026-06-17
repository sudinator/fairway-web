-- 0011_finish_game.sql — let the organizer OR any group marker finish a game.
-- SECURITY DEFINER + auth.uid(): only the game creator or a marker in the game
-- may end it; touches only games.status.
create or replace function finish_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from games g where g.id = p_game and g.created_by = auth.uid())
     and not exists (select 1 from game_players w where w.game_id = p_game and w.user_id = auth.uid() and w.is_marker = true)
  then
    raise exception 'only the organizer or a marker can finish the game';
  end if;
  update games set status = 'ended' where id = p_game;
end $$;
