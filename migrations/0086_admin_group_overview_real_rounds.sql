-- 0086_admin_group_overview_real_rounds.sql
-- Fix (sibling of 0085): admin_group_overview.rounds_count counted ALL rows in `rounds`
-- for a club, including soft-deleted + in-progress, inflating per-club round totals in
-- Clubs oversight. Also filter the last_activity round lookup so a deleted/in-progress
-- round doesn't register as club activity. Real-round definition matches the rest of the
-- app: deleted_at is null AND status <> 'in_progress'. Pure function fix; no data change.
create or replace function public.admin_group_overview()
returns table (
  group_id uuid, name text, status text,
  admin_names text, member_count int, rounds_count int, games_count int,
  last_activity timestamptz, my_support boolean, is_default boolean
)
language sql security definer set search_path = public
as $$
  select
    g.id, g.name, coalesce(g.status, 'active') as status,
    (select string_agg(coalesce(p.display_name, gm2.email, 'admin'), ', ')
       from group_members gm2 left join profiles p on p.id = gm2.user_id
       where gm2.group_id = g.id and gm2.role = 'admin' and gm2.status = 'active'
         and gm2.is_support = false) as admin_names,
    (select count(*) from group_members gm where gm.group_id = g.id and gm.status = 'active' and gm.is_support = false)::int as member_count,
    (select count(*) from rounds r
       where r.group_id = g.id and r.deleted_at is null
         and coalesce(r.status, 'final') <> 'in_progress')::int as rounds_count,
    (select count(*) from games ga where ga.group_id = g.id)::int as games_count,
    greatest(
      coalesce((select max(r.played_at) from rounds r
                  where r.group_id = g.id and r.deleted_at is null
                    and coalesce(r.status, 'final') <> 'in_progress'), 'epoch'::timestamptz),
      coalesce((select max(ga.created_at) from games ga where ga.group_id = g.id), 'epoch'::timestamptz),
      coalesce(g.created_at, 'epoch'::timestamptz)
    ) as last_activity,
    exists (select 1 from group_members gm3
            where gm3.group_id = g.id and gm3.user_id = auth.uid() and gm3.is_support = true) as my_support,
    coalesce(g.is_default, false) as is_default
  from groups g
  where public.is_admin()
  order by last_activity desc;
$$;
grant execute on function public.admin_group_overview() to authenticated;
