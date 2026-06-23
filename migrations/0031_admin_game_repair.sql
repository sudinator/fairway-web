-- 0031_admin_game_repair.sql
-- Phase 3: master-admin game repair. The organizer-only RPCs (finish_game,
-- reset_game_scores, delete_game) are gated to created_by, so an admin can't fix
-- another person's stuck game even inside a support session. These is_admin()-gated
-- SECURITY DEFINER overrides mirror the organizer actions for any game.

create or replace function public.admin_end_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  update games set status = 'ended', ended_at = coalesce(ended_at, now()) where id = p_game;
end; $$;
grant execute on function public.admin_end_game(uuid) to authenticated;

create or replace function public.admin_reopen_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  update games set status = 'active', ended_at = null where id = p_game;
end; $$;
grant execute on function public.admin_reopen_game(uuid) to authenticated;

-- Mirrors reset_game_scores exactly, but gated to app admins instead of organizer.
create or replace function public.admin_reset_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  update game_players
     set scores = '[]'::jsonb, putts = '[]'::jsonb, fairways = '[]'::jsonb,
         penalties = '[]'::jsonb, sand = '[]'::jsonb,
         clock_start = null, clock_end = null, group_locked = false, no_show = false
   where game_id = p_game;
  update games
     set status = case when status = 'ended' then 'active' else status end,
         scores_reset_at = now()
   where id = p_game;
end; $$;
grant execute on function public.admin_reset_game(uuid) to authenticated;

-- Deletes the game + its player rows. KEEPS any rounds already posted to players'
-- history (unlike the same-day organizer delete) — a repair shouldn't wipe records.
create or replace function public.admin_delete_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  delete from game_players where game_id = p_game;
  delete from games where id = p_game;
end; $$;
grant execute on function public.admin_delete_game(uuid) to authenticated;

-- Hand the game to a new organizer (must be an existing player in the game).
create or replace function public.admin_reassign_organizer(p_game uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  if not exists (select 1 from game_players gp where gp.game_id = p_game and gp.user_id = p_user) then
    raise exception 'new organizer must be a player in the game';
  end if;
  update games set created_by = p_user where id = p_game;
end; $$;
grant execute on function public.admin_reassign_organizer(uuid, uuid) to authenticated;
