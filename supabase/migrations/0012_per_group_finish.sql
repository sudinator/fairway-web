-- 0012_per_group_finish.sql — per-group finishing vs whole-game end.
--  * A group's MARKER can lock ONLY their own tee group (finish_tee_group).
--  * Only the ORGANIZER can end the whole game (finish_game, redefined here to
--    be organizer-only — markers no longer end the whole game).
--  * If the organizer is also a marker, finishing THEIR group locks just that
--    group; it does NOT end the game (separate action).

alter table game_players add column if not exists group_locked boolean not null default false;

-- Marker locks their own tee group (foursome). Touches only group_locked.
create or replace function finish_tee_group(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare grp smallint;
begin
  select tee_group into grp from game_players
   where game_id = p_game and user_id = auth.uid() and is_marker = true;
  if grp is null then raise exception 'only this group''s marker can finish the group'; end if;
  update game_players set group_locked = true where game_id = p_game and tee_group = grp;
end $$;

-- Whole-game end is ORGANIZER ONLY now.
create or replace function finish_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from games g where g.id = p_game and g.created_by = auth.uid()) then
    raise exception 'only the organizer can end the whole game';
  end if;
  update games set status = 'ended' where id = p_game;
end $$;
