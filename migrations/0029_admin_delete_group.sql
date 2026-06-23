-- 0029_admin_delete_group.sql
-- Phase 3 corrective tool: let a master admin hard-delete a group (e.g. a stray
-- duplicate "Main" spawned by the old safety-net). SECURITY DEFINER + is_admin()
-- gated. Designed to PRESERVE players' personal data: posted rounds are kept and
-- merely untagged from the group; only the group's own scaffolding is removed.
create or replace function public.admin_delete_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;

  -- Keep every player's round history — just drop the group tag so nothing is lost.
  update rounds set group_id = null where group_id = p_group;

  -- Games are group events: remove them and their per-player score rows.
  delete from game_players where game_id in (select id from games where group_id = p_group);
  delete from games where group_id = p_group;

  -- Course data: keep the records (other groups may reference them by id) but drop
  -- this group's ownership; remove only this group's library links.
  update favorite_courses set group_id = null where group_id = p_group;
  delete from group_courses where group_id = p_group;

  -- Group scaffolding.
  delete from group_invites where group_id = p_group;
  delete from group_members where group_id = p_group;
  delete from notifications where group_id = p_group;

  -- Anyone whose active group was this one re-defaults on next load.
  update profiles set active_group_id = null where active_group_id = p_group;

  delete from groups where id = p_group;
end;
$$;
grant execute on function public.admin_delete_group(uuid) to authenticated;
