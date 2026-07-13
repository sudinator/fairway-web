-- 0085_admin_list_users_real_rounds.sql
-- Fix: admin_list_users.rounds_count counted ALL rows in `rounds` for a user, including
-- soft-deleted (deleted_at not null) and in-progress rounds. A user with phantom/duplicate
-- in-progress rows or soft-deleted rounds therefore showed an inflated count in Admin ->
-- Users (e.g. 38) that disagreed with the player card's real-round count (e.g. 3).
-- Align the count with the app's standard real-round definition used everywhere else:
-- not deleted, and not in-progress. Pure function fix; no data changes. Safe to re-run.
create or replace function public.admin_list_users()
returns table (
  id uuid, display_name text, email text, is_admin boolean, banned boolean,
  handicap_index numeric, group_count int, rounds_count int
)
language sql security definer set search_path = public as $$
  select p.id, p.display_name, p.email, p.is_admin, coalesce(p.banned, false),
         p.handicap_index,
         (select count(*) from group_members gm where gm.user_id = p.id and gm.status = 'active')::int,
         (select count(*) from rounds r
            where r.user_id = p.id
              and r.deleted_at is null
              and coalesce(r.status, 'final') <> 'in_progress')::int
  from profiles p
  where public.is_admin()
  order by p.display_name nulls last;
$$;
grant execute on function public.admin_list_users() to authenticated;
