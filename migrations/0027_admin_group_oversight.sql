-- 0027_admin_group_oversight.sql
-- Phase 1 of master-admin oversight: a read-only overview of every group, plus a
-- soft archive/unarchive. Both are SECURITY DEFINER and gated to app admins
-- (is_admin()), so a master admin can see and tidy groups they are NOT a member
-- of, without loosening any table's RLS for normal users.

-- Cross-group overview: one row per group with light aggregates. Returns nothing
-- for non-admins (the WHERE is_admin() gate short-circuits the whole query).
create or replace function public.admin_group_overview()
returns table (
  group_id uuid, name text, status text,
  admin_names text, member_count int, rounds_count int, games_count int,
  last_activity timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    g.id, g.name, coalesce(g.status, 'active') as status,
    (select string_agg(coalesce(p.display_name, gm2.email, 'admin'), ', ')
       from group_members gm2 left join profiles p on p.id = gm2.user_id
       where gm2.group_id = g.id and gm2.role = 'admin' and gm2.status = 'active') as admin_names,
    (select count(*) from group_members gm where gm.group_id = g.id and gm.status = 'active')::int as member_count,
    (select count(*) from rounds r where r.group_id = g.id)::int as rounds_count,
    (select count(*) from games ga where ga.group_id = g.id)::int as games_count,
    greatest(
      coalesce((select max(r.played_at) from rounds r where r.group_id = g.id), 'epoch'::timestamptz),
      coalesce((select max(ga.created_at) from games ga where ga.group_id = g.id), 'epoch'::timestamptz),
      coalesce(g.created_at, 'epoch'::timestamptz)
    ) as last_activity
  from groups g
  where public.is_admin()
  order by last_activity desc;
$$;
grant execute on function public.admin_group_overview() to authenticated;

-- Soft archive / unarchive. Reversible: archived groups are hidden from members'
-- pickers (loadGroups only shows status='active') but no data is deleted.
create or replace function public.admin_set_group_status(p_group uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  if p_status not in ('active', 'archived') then return; end if;
  update groups set status = p_status where id = p_group;
end;
$$;
grant execute on function public.admin_set_group_status(uuid, text) to authenticated;
