-- 0059_game_players_bets.sql
-- Per-player betting flag for the TGC money game. TGC members default IN (true);
-- guests are inserted OUT (the app sets bets=false on guest rows). Excluded
-- players still play and appear on the leaderboard, but they don't ante and
-- can't win — their would-be winnings flow to the next betting player, like an
-- amateur playing in a pro event. Existing rows default to true (no change to
-- past games). Idempotent. Run in the Supabase SQL editor. Run after 0058.

alter table public.game_players
  add column if not exists bets boolean not null default true;

-- Organizer-only setter so the game creator (or an active group admin) can toggle
-- ANY player's betting status. game_players UPDATE RLS otherwise only lets a
-- member edit guest rows or rows they mark, so a direct update can't reliably
-- exclude another member. SECURITY DEFINER + explicit auth check, mirroring
-- set_tee_group (0009). Does NOT touch scores.
create or replace function set_player_bets(p_player uuid, p_bets boolean)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid; creator uuid; grp uuid;
begin
  select gp.game_id into gid from game_players gp where gp.id = p_player;
  if gid is null then raise exception 'no such player'; end if;
  select g.created_by, g.group_id into creator, grp from games g where g.id = gid;
  if auth.uid() = creator
     or exists (select 1 from group_members m
                where m.group_id = grp and m.user_id = auth.uid()
                  and m.role = 'admin' and m.status = 'active') then
    update game_players set bets = p_bets where id = p_player;
  else
    raise exception 'not authorized to set betting status';
  end if;
end $$;

grant execute on function set_player_bets(uuid, boolean) to authenticated;
