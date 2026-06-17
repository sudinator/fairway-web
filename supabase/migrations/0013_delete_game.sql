-- 0013_delete_game.sql — organizer-only game delete, with optional round cleanup.
-- Default app behavior: deleting a game KEEPS each player's posted round (history).
-- Only when the game is deleted the same day it was created does the app pass
-- p_delete_rounds = true, which also removes the rounds (and their holes) that
-- were posted from this game. SECURITY DEFINER + organizer check.
create or replace function delete_game(p_game uuid, p_delete_rounds boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from games g where g.id = p_game and g.created_by = auth.uid()) then
    raise exception 'only the organizer can delete the game';
  end if;
  if p_delete_rounds then
    delete from holes  where round_id in (select id from rounds where game_id = p_game);
    delete from rounds where game_id = p_game;
  end if;
  delete from game_players where game_id = p_game;
  delete from games        where id      = p_game;
end $$;
