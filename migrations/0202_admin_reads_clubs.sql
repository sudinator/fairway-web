-- 0202_admin_reads_clubs.sql
--
-- 210.12 — system admins can READ every club and membership (owner, Oct 20 2026). The rules for CHANGING
-- memberships already allow system admins in every club (is_admin()); the rules for reading never had the same
-- exception — a club and its memberships were visible only to that club's members. So Admin screens read under
-- member rules and silently showed only the owner's own clubs: Player admin listed Jigar Shukla in LEMG but not
-- PA-NJ golfers (which he runs), its add-to-club list, Admin → Users' admit-to-club list and Club reports' club
-- picker left out every club the owner isn't in, and removing someone from such a club silently did nothing
-- (a row you can't see can't be changed).
--
-- Now system admins can read every club and every membership — matching what they can already change. Nothing
-- changes for anyone else: members still see only their own clubs.
--
-- AUTHORIZATION: SELECT policies on public.groups and public.group_members gain `OR public.is_admin()`.
--
-- Idempotent; safe to re-run.

begin;

drop policy if exists groups_select_member on public.groups;
create policy groups_select_member on public.groups for select to authenticated
  using (public.is_group_member(id, auth.uid()) or created_by = auth.uid() or public.is_admin());

drop policy if exists group_members_select_visible on public.group_members;
create policy group_members_select_visible on public.group_members for select to authenticated
  using (public.is_group_member(group_id, auth.uid()) or user_id = auth.uid()
         or lower(email::text) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin());

select public.record_migration('0202_admin_reads_clubs');

commit;
