-- 0032_admin_merge_users_groups.sql
-- Phase 4 + 5: the most destructive admin tools. ALL is_admin()-gated SECURITY
-- DEFINER. Several are IRREVERSIBLE — test on throwaway data first.
--   Phase 4: admin_merge_group
--   Phase 5: admin_set_banned, admin_revoke_group_invites, admin_wipe_user,
--            admin_merge_users (+ preview), admin_list_users

-- Ban flag for app-wide bans (enforced in the app shell).
alter table public.profiles add column if not exists banned boolean not null default false;

-- ---------- Phase 4: merge one group into another ----------
-- Moves source's data into target, then deletes source. Dedups by the natural
-- keys (member email, course name/id). NOTE: course rows are kept (other groups
-- may reference them by id); only the source group's links/ownership move.
create or replace function public.admin_merge_group(p_source uuid, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  if p_source = p_target then raise exception 'source and target must differ'; end if;

  update rounds set group_id = p_target where group_id = p_source;
  update games  set group_id = p_target where group_id = p_source;

  delete from group_members s where s.group_id = p_source
    and exists (select 1 from group_members t where t.group_id = p_target and lower(t.email) = lower(s.email));
  update group_members set group_id = p_target where group_id = p_source;

  delete from favorite_courses s where s.group_id = p_source
    and exists (select 1 from favorite_courses t where t.group_id = p_target and t.name = s.name);
  update favorite_courses set group_id = p_target where group_id = p_source;

  delete from group_courses s where s.group_id = p_source
    and exists (select 1 from group_courses t where t.group_id = p_target and t.course_id = s.course_id);
  update group_courses set group_id = p_target where group_id = p_source;

  update group_invites set group_id = p_target where group_id = p_source;
  update notifications  set group_id = p_target where group_id = p_source;
  update activity_log   set group_id = p_target where group_id = p_source;
  update profiles set active_group_id = p_target where active_group_id = p_source;

  delete from groups where id = p_source;
end; $$;
grant execute on function public.admin_merge_group(uuid, uuid) to authenticated;

-- ---------- Phase 5: ban / unban ----------
create or replace function public.admin_set_banned(p_user uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  update profiles set banned = p_banned where id = p_user;
end; $$;
grant execute on function public.admin_set_banned(uuid, boolean) to authenticated;

-- ---------- Phase 5: revoke a group's outstanding invite links ----------
create or replace function public.admin_revoke_group_invites(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  update group_invites set status = 'revoked', expires_at = now()
   where group_id = p_group and status = 'active';
end; $$;
grant execute on function public.admin_revoke_group_invites(uuid) to authenticated;

-- ---------- Phase 5: list all users (admin console) ----------
create or replace function public.admin_list_users()
returns table (
  id uuid, display_name text, email text, is_admin boolean, banned boolean,
  handicap_index numeric, group_count int, rounds_count int
)
language sql security definer set search_path = public as $$
  select p.id, p.display_name, p.email, p.is_admin, coalesce(p.banned, false),
         p.handicap_index,
         (select count(*) from group_members gm where gm.user_id = p.id and gm.status = 'active')::int,
         (select count(*) from rounds r where r.user_id = p.id)::int
  from profiles p
  where public.is_admin()
  order by p.display_name nulls last;
$$;
grant execute on function public.admin_list_users() to authenticated;

-- ---------- Phase 5: wipe a user's personal data (data-deletion request) ----------
-- Deletes the user's own scoring data + profile. Leaves group games (others'
-- shared data) intact; their organizer slot can be reassigned via game repair.
create or replace function public.admin_wipe_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  delete from holes where round_id in (select id from rounds where user_id = p_user);
  delete from rounds where user_id = p_user;
  delete from game_players where user_id = p_user;
  delete from favorite_courses where user_id = p_user;
  delete from group_members where user_id = p_user;
  delete from notifications where user_id = p_user;
  delete from profiles where id = p_user;
end; $$;
grant execute on function public.admin_wipe_user(uuid) to authenticated;

-- ---------- Phase 5: merge two accounts (dedup) ----------
-- Preview = what would move from p_remove into p_keep (no changes).
create or replace function public.admin_merge_users_preview(p_keep uuid, p_remove uuid)
returns table (rounds int, games_organized int, game_player_rows int, memberships int)
language sql security definer set search_path = public as $$
  select
    (select count(*) from rounds where user_id = p_remove)::int,
    (select count(*) from games where created_by = p_remove)::int,
    (select count(*) from game_players where user_id = p_remove)::int,
    (select count(*) from group_members where user_id = p_remove)::int
  where public.is_admin();
$$;
grant execute on function public.admin_merge_users_preview(uuid, uuid) to authenticated;

-- Execute the merge: reassign every reference from p_remove to p_keep, then delete
-- p_remove's profile. IRREVERSIBLE. (The auth login for p_remove is NOT deleted —
-- remove it in the Supabase Auth dashboard if needed so it can't recreate a profile.)
create or replace function public.admin_merge_users(p_keep uuid, p_remove uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  if p_keep = p_remove then raise exception 'keep and remove must differ'; end if;

  update rounds          set user_id    = p_keep where user_id    = p_remove;
  update games           set created_by = p_keep where created_by = p_remove;
  update games           set marker_user_id = p_keep where marker_user_id = p_remove;

  delete from game_players gp where gp.user_id = p_remove
    and exists (select 1 from game_players k where k.game_id = gp.game_id and k.user_id = p_keep);
  update game_players    set user_id   = p_keep where user_id   = p_remove;
  update game_players    set scored_by = p_keep where scored_by = p_remove;

  delete from group_members gm where gm.user_id = p_remove
    and exists (select 1 from group_members k where k.group_id = gm.group_id and k.user_id = p_keep);
  update group_members   set user_id = p_keep where user_id = p_remove;

  update favorite_courses set user_id    = p_keep where user_id    = p_remove;
  update favorite_courses set deleted_by = p_keep where deleted_by = p_remove;
  update group_courses    set added_by   = p_keep where added_by   = p_remove;
  update group_invites    set created_by = p_keep where created_by = p_remove;
  update group_invites    set used_by    = p_keep where used_by    = p_remove;
  update activity_log     set actor_id       = p_keep where actor_id       = p_remove;
  update activity_log     set target_user_id = p_keep where target_user_id = p_remove;
  update notifications    set user_id = p_keep where user_id = p_remove;

  delete from profiles where id = p_remove;
end; $$;
grant execute on function public.admin_merge_users(uuid, uuid) to authenticated;
