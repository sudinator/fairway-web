-- 0034_enforce_ban_in_access.sql
-- Make "banned" real at the data layer. These three helpers gate nearly all access
-- (RLS policies call is_group_member; admin RPCs call is_admin), so adding a
-- "not banned" check here enforces the ban everywhere without touching every policy.
-- Additive: for non-banned users the result is unchanged. HIGH blast radius — test
-- a suspended throwaway account is locked out AND a normal account still works before
-- relying on it. Re-running the original definitions reverts the behavior.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce((select is_admin and not coalesce(banned, false)
                   from profiles where id = auth.uid()), false);
$$;

create or replace function public.is_group_member(group_uuid uuid, user_uuid uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = group_uuid
      and gm.user_id = user_uuid
      and gm.status = 'active'
  )
  and not coalesce((select banned from profiles where id = user_uuid), false);
$$;

create or replace function public.is_group_admin(group_uuid uuid, user_uuid uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = group_uuid
      and gm.user_id = user_uuid
      and gm.status = 'active'
      and gm.role = 'admin'
  )
  and not coalesce((select banned from profiles where id = user_uuid), false);
$$;
