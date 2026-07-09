-- 0072_profiles_readable_by_comembers.sql
-- Members could only read their OWN profile row (SELECT policy was
-- `id = auth.uid() OR is_admin()`), so non-admin members saw emails + letter avatars
-- instead of their club-mates' names/photos everywhere (Club member list, Players tab,
-- Money tab, game-setup roster, tee-group shuffle). App admins never saw the bug because
-- is_admin() let them read all rows. This lets a member also read the profile of anyone
-- they share an ACTIVE club (group) with. A SECURITY DEFINER helper does the co-membership
-- check so the policy's own subquery isn't itself filtered by group_members' RLS.
create or replace function public.shares_active_club(other uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from group_members me
    join group_members them on them.group_id = me.group_id
    where me.user_id = auth.uid() and me.status = 'active'
      and them.user_id = other  and them.status = 'active'
  );
$$;

drop policy if exists "read own or admin all" on public.profiles;
drop policy if exists "read own, co-members, or admin" on public.profiles;
create policy "read own, co-members, or admin" on public.profiles
for select using (
  id = auth.uid()
  or public.is_admin()
  or public.shares_active_club(id)
);
