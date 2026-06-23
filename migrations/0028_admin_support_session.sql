-- 0028_admin_support_session.sql
-- Phase 2 of master-admin oversight: a logged "support session". An app admin can
-- temporarily JOIN any group as a support member (role=admin), which reuses every
-- existing membership-based RLS policy — so they can view and make corrective edits
-- without weakening anyone else's access. Exiting removes ONLY the support row, never
-- a real membership. While present they appear in the roster: the visible "an admin
-- is here" signal, rather than silent observation. Entry/exit are logged client-side.

-- 1) Mark support memberships so we can tell them apart and clean only those up.
alter table public.group_members
  add column if not exists is_support boolean not null default false;

-- 2) Enter: add a temporary support membership if not already an active member.
--    p_email is the caller's email (group_members.email is populated for real rows too).
create or replace function public.admin_enter_group(p_group uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  -- Already in the group (real or prior support row)? Leave it untouched.
  if exists (
    select 1 from group_members
    where group_id = p_group and user_id = auth.uid() and status = 'active'
  ) then
    return;
  end if;
  insert into group_members (group_id, user_id, email, role, status, is_support)
  values (p_group, auth.uid(), coalesce(lower(p_email), ''), 'admin', 'active', true);
end;
$$;
grant execute on function public.admin_enter_group(uuid, text) to authenticated;

-- 3) Exit: remove ONLY the caller's support membership(s) for this group. A real
--    membership (is_support=false) is never touched.
create or replace function public.admin_exit_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  delete from group_members
  where group_id = p_group and user_id = auth.uid() and is_support = true;
end;
$$;
grant execute on function public.admin_exit_group(uuid) to authenticated;

-- 4) Overview gains my_support so the dashboard can show "In session / Exit".
--    Return-type change => must drop the 0027 version first.
drop function if exists public.admin_group_overview();
create or replace function public.admin_group_overview()
returns table (
  group_id uuid, name text, status text,
  admin_names text, member_count int, rounds_count int, games_count int,
  last_activity timestamptz, my_support boolean
)
language sql
security definer
set search_path = public
as $$
  select
    g.id, g.name, coalesce(g.status, 'active') as status,
    (select string_agg(coalesce(p.display_name, gm2.email, 'admin'), ', ')
       from group_members gm2 left join profiles p on p.id = gm2.user_id
       where gm2.group_id = g.id and gm2.role = 'admin' and gm2.status = 'active'
         and gm2.is_support = false) as admin_names,
    (select count(*) from group_members gm where gm.group_id = g.id and gm.status = 'active' and gm.is_support = false)::int as member_count,
    (select count(*) from rounds r where r.group_id = g.id)::int as rounds_count,
    (select count(*) from games ga where ga.group_id = g.id)::int as games_count,
    greatest(
      coalesce((select max(r.played_at) from rounds r where r.group_id = g.id), 'epoch'::timestamptz),
      coalesce((select max(ga.created_at) from games ga where ga.group_id = g.id), 'epoch'::timestamptz),
      coalesce(g.created_at, 'epoch'::timestamptz)
    ) as last_activity,
    exists (select 1 from group_members gm3
            where gm3.group_id = g.id and gm3.user_id = auth.uid() and gm3.is_support = true) as my_support
  from groups g
  where public.is_admin()
  order by last_activity desc;
$$;
grant execute on function public.admin_group_overview() to authenticated;
