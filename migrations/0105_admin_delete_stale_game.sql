-- 0105_admin_delete_stale_game.sql
-- System-admin one-click delete for a STALE game from the Operations panel. Safety-gated: only deletes
-- a game that is (a) not already ended and (b) has NO live (non-deleted) posted rounds — so we never
-- strand a player's round pointing at a deleted game (which the integrity check flags as
-- 'orphaned_game_id'). Any leftover soft-deleted rounds for the game have their game_id nulled so
-- nothing dangles. Mirrors admin_delete_game's cleanup (game_players + games) with those guards.
-- Returns a status string the client reacts to: forbidden | not_found | not_stale | has_rounds | deleted.
create or replace function public.admin_delete_stale_game(p_game uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text; v_live int;
begin
  if not public.is_admin() then return 'forbidden'; end if;

  select status into v_status from games where id = p_game;
  if not found then return 'not_found'; end if;
  if v_status = 'ended' then return 'not_stale'; end if;

  select count(*) into v_live from rounds where game_id = p_game and deleted_at is null;
  if v_live > 0 then return 'has_rounds'; end if;

  update rounds set game_id = null where game_id = p_game;  -- detach any soft-deleted rounds
  delete from game_players where game_id = p_game;
  delete from games where id = p_game;
  return 'deleted';
end;
$$;
grant execute on function public.admin_delete_stale_game(uuid) to authenticated;
