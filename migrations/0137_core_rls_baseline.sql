-- 0137_core_rls_baseline.sql
-- Reconstruct the live Production RLS contract for the 12 core tables whose
-- policies historically existed only in the live database / SCHEMA.md.
-- Source: read-only pg_policies + pg_class export from Production on 2026-08-14.
-- This migration is intentionally idempotent: enable RLS, drop each known policy,
-- then recreate the exact Production policy definition.

alter table public.activity_log enable row level security;
alter table public.activity_log no force row level security;
alter table public.favorite_courses enable row level security;
alter table public.favorite_courses no force row level security;
alter table public.game_players enable row level security;
alter table public.game_players no force row level security;
alter table public.games enable row level security;
alter table public.games no force row level security;
alter table public.group_courses enable row level security;
alter table public.group_courses no force row level security;
alter table public.group_invites enable row level security;
alter table public.group_invites no force row level security;
alter table public.group_members enable row level security;
alter table public.group_members no force row level security;
alter table public.groups enable row level security;
alter table public.groups no force row level security;
alter table public.holes enable row level security;
alter table public.holes no force row level security;
alter table public.notifications enable row level security;
alter table public.notifications no force row level security;
alter table public.profiles enable row level security;
alter table public.profiles no force row level security;
alter table public.rounds enable row level security;
alter table public.rounds no force row level security;

-- Production currently grants table privileges to anon/authenticated and relies on RLS
-- for row authorization. Make that contract explicit for fresh-database rebuilds.
grant delete, insert, references, select, trigger, truncate, update on table
  public.activity_log,
  public.favorite_courses,
  public.game_players,
  public.games,
  public.group_courses,
  public.group_invites,
  public.group_members,
  public.groups,
  public.holes,
  public.notifications,
  public.profiles,
  public.rounds
to anon, authenticated;


drop policy if exists "admins read activity" on public.activity_log;
create policy "admins read activity" on public.activity_log as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));

drop policy if exists "insert own activity" on public.activity_log;
create policy "insert own activity" on public.activity_log as permissive for insert to public
  with check ((actor_id = auth.uid()));

drop policy if exists "admin sets vetted" on public.favorite_courses;
create policy "admin sets vetted" on public.favorite_courses as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))))
  with check (true);

drop policy if exists "anyone reads courses" on public.favorite_courses;
create policy "anyone reads courses" on public.favorite_courses as permissive for select to public
  using ((auth.uid() IS NOT NULL));

drop policy if exists "authenticated_adds_global_courses" on public.favorite_courses;
create policy "authenticated_adds_global_courses" on public.favorite_courses as permissive for insert to authenticated
  with check ((auth.uid() IS NOT NULL));

drop policy if exists "course_admin_updates_global_courses" on public.favorite_courses;
create policy "course_admin_updates_global_courses" on public.favorite_courses as permissive for update to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "creator or admin deletes" on public.favorite_courses;
create policy "creator or admin deletes" on public.favorite_courses as permissive for delete to public
  using (((user_id = auth.uid()) OR is_admin()));

drop policy if exists "favorite_courses_group_member_all" on public.favorite_courses;
create policy "favorite_courses_group_member_all" on public.favorite_courses as permissive for all to authenticated
  using (is_group_member(group_id, auth.uid()))
  with check (is_group_member(group_id, auth.uid()));

drop policy if exists "favorite_courses_select_global_non_deleted" on public.favorite_courses;
create policy "favorite_courses_select_global_non_deleted" on public.favorite_courses as permissive for select to authenticated
  using ((COALESCE(deleted, false) = false));

drop policy if exists "read vetted courses" on public.favorite_courses;
create policy "read vetted courses" on public.favorite_courses as permissive for select to public
  using (((vetted = true) AND (auth.uid() IS NOT NULL)));

drop policy if exists "edit own scores" on public.game_players;
create policy "edit own scores" on public.game_players as permissive for update to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

drop policy if exists "join as self" on public.game_players;
create policy "join as self" on public.game_players as permissive for insert to public
  with check (((auth.uid() = user_id) AND is_group_member(( SELECT g.group_id
   FROM games g
  WHERE (g.id = game_players.game_id)), auth.uid())));

drop policy if exists "marker_can_update_group_scores" on public.game_players;
create policy "marker_can_update_group_scores" on public.game_players as permissive for update to authenticated
  using ((EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_players.game_id) AND (g.marker_user_id = auth.uid())))))
  with check ((EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_players.game_id) AND (g.marker_user_id = auth.uid())))));

drop policy if exists "members_add_guests" on public.game_players;
create policy "members_add_guests" on public.game_players as permissive for insert to authenticated
  with check (((is_guest = true) AND (user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM (games g
     JOIN group_members gm ON ((gm.group_id = g.group_id)))
  WHERE ((g.id = game_players.game_id) AND (gm.user_id = auth.uid()))))));

drop policy if exists "members_delete_guests" on public.game_players;
create policy "members_delete_guests" on public.game_players as permissive for delete to authenticated
  using (((is_guest = true) AND (EXISTS ( SELECT 1
   FROM (games g
     JOIN group_members gm ON ((gm.group_id = g.group_id)))
  WHERE ((g.id = game_players.game_id) AND (gm.user_id = auth.uid()))))));

drop policy if exists "members_select_guests" on public.game_players;
create policy "members_select_guests" on public.game_players as permissive for select to authenticated
  using (((is_guest = true) AND (user_id IS NULL) AND (EXISTS ( SELECT 1
   FROM (games g
     JOIN group_members gm ON ((gm.group_id = g.group_id)))
  WHERE ((g.id = game_players.game_id) AND (gm.user_id = auth.uid()))))));

drop policy if exists "members_update_guests" on public.game_players;
create policy "members_update_guests" on public.game_players as permissive for update to authenticated
  using (((is_guest = true) AND (EXISTS ( SELECT 1
   FROM (games g
     JOIN group_members gm ON ((gm.group_id = g.group_id)))
  WHERE ((g.id = game_players.game_id) AND (gm.user_id = auth.uid()))))))
  with check (((is_guest = true) AND (EXISTS ( SELECT 1
   FROM (games g
     JOIN group_members gm ON ((gm.group_id = g.group_id)))
  WHERE ((g.id = game_players.game_id) AND (gm.user_id = auth.uid()))))));

drop policy if exists "organizer adds players" on public.game_players;
create policy "organizer adds players" on public.game_players as permissive for insert to public
  with check (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_players.game_id) AND (g.created_by = auth.uid()))))));

drop policy if exists "organizer manages players" on public.game_players;
create policy "organizer manages players" on public.game_players as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_players.game_id) AND (g.created_by = auth.uid())))))
  with check ((EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_players.game_id) AND (g.created_by = auth.uid())))));

drop policy if exists "organizer removes players" on public.game_players;
create policy "organizer removes players" on public.game_players as permissive for delete to public
  using (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_players.game_id) AND (g.created_by = auth.uid()))))));

drop policy if exists "see co-players" on public.game_players;
create policy "see co-players" on public.game_players as permissive for select to public
  using (is_game_member(game_id));

drop policy if exists "tee_group_marker_can_update" on public.game_players;
create policy "tee_group_marker_can_update" on public.game_players as permissive for update to authenticated
  using (is_tee_group_marker(game_id, tee_group))
  with check (is_tee_group_marker(game_id, tee_group));

drop policy if exists "create games" on public.games;
create policy "create games" on public.games as permissive for insert to public
  with check ((auth.uid() = created_by));

drop policy if exists "find or member games" on public.games;
create policy "find or member games" on public.games as permissive for select to public
  using ((is_game_member(id) OR is_group_member(group_id, auth.uid()) OR (created_by = auth.uid()) OR is_admin()));

drop policy if exists "games_group_member_all" on public.games;
create policy "games_group_member_all" on public.games as permissive for all to authenticated
  using (is_group_member(group_id, auth.uid()))
  with check (is_group_member(group_id, auth.uid()));

drop policy if exists "organizer deletes game" on public.games;
create policy "organizer deletes game" on public.games as permissive for delete to public
  using ((created_by = auth.uid()));

drop policy if exists "update own games" on public.games;
create policy "update own games" on public.games as permissive for update to public
  using ((auth.uid() = created_by))
  with check ((auth.uid() = created_by));

drop policy if exists "add group_courses" on public.group_courses;
create policy "add group_courses" on public.group_courses as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM group_members gm
  WHERE ((gm.group_id = group_courses.group_id) AND (gm.user_id = auth.uid()) AND (gm.status = 'active'::text)))));

drop policy if exists "ga delete group_courses" on public.group_courses;
create policy "ga delete group_courses" on public.group_courses as permissive for delete to public
  using ((is_group_admin(group_id, auth.uid()) OR is_admin()));

drop policy if exists "read group_courses" on public.group_courses;
create policy "read group_courses" on public.group_courses as permissive for select to public
  using ((auth.role() = 'authenticated'::text));

drop policy if exists "remove group_courses" on public.group_courses;
create policy "remove group_courses" on public.group_courses as permissive for delete to public
  using ((EXISTS ( SELECT 1
   FROM group_members gm
  WHERE ((gm.group_id = group_courses.group_id) AND (gm.user_id = auth.uid()) AND (gm.status = 'active'::text)))));

drop policy if exists "ga delete invites" on public.group_invites;
create policy "ga delete invites" on public.group_invites as permissive for delete to public
  using ((is_group_admin(group_id, auth.uid()) OR is_admin()));

drop policy if exists "group_invites_admin_delete" on public.group_invites;
create policy "group_invites_admin_delete" on public.group_invites as permissive for delete to authenticated
  using (is_group_admin(group_id, auth.uid()));

drop policy if exists "group_invites_admin_select" on public.group_invites;
create policy "group_invites_admin_select" on public.group_invites as permissive for select to authenticated
  using (is_group_admin(group_id, auth.uid()));

drop policy if exists "group_invites_admin_update" on public.group_invites;
create policy "group_invites_admin_update" on public.group_invites as permissive for update to authenticated
  using (is_group_admin(group_id, auth.uid()))
  with check (is_group_admin(group_id, auth.uid()));

drop policy if exists "ga delete memberships" on public.group_members;
create policy "ga delete memberships" on public.group_members as permissive for delete to public
  using ((is_group_admin(group_id, auth.uid()) OR is_admin()));

drop policy if exists "group_members_insert_admin_or_self" on public.group_members;
create policy "group_members_insert_admin_or_self" on public.group_members as permissive for insert to authenticated
  with check ((is_group_admin(group_id, auth.uid()) OR ((user_id = auth.uid()) AND (role = 'admin'::text) AND (status = 'active'::text))));

drop policy if exists "group_members_select_visible" on public.group_members;
create policy "group_members_select_visible" on public.group_members as permissive for select to authenticated
  using ((is_group_member(group_id, auth.uid()) OR (user_id = auth.uid()) OR (lower((email)::text) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))));

drop policy if exists "group_members_update_admin_or_self_invite" on public.group_members;
create policy "group_members_update_admin_or_self_invite" on public.group_members as permissive for update to authenticated
  using ((is_group_admin(group_id, auth.uid()) OR (lower((email)::text) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))))
  with check ((is_group_admin(group_id, auth.uid()) OR (user_id = auth.uid())));

drop policy if exists "admin updates groups" on public.groups;
create policy "admin updates groups" on public.groups as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))))
  with check (true);

drop policy if exists "group admin can delete group" on public.groups;
create policy "group admin can delete group" on public.groups as permissive for delete to public
  using ((is_group_admin(id, auth.uid()) OR is_admin()));

drop policy if exists "groups_insert_authenticated" on public.groups;
create policy "groups_insert_authenticated" on public.groups as permissive for insert to authenticated
  with check ((created_by = auth.uid()));

drop policy if exists "groups_select_member" on public.groups;
create policy "groups_select_member" on public.groups as permissive for select to authenticated
  using ((is_group_member(id, auth.uid()) OR (created_by = auth.uid())));

drop policy if exists "groups_update_admin" on public.groups;
create policy "groups_update_admin" on public.groups as permissive for update to authenticated
  using (is_group_admin(id, auth.uid()))
  with check (is_group_admin(id, auth.uid()));

drop policy if exists "admin reads all holes" on public.holes;
create policy "admin reads all holes" on public.holes as permissive for select to public
  using (is_admin());

drop policy if exists "admin updates all holes" on public.holes;
create policy "admin updates all holes" on public.holes as permissive for update to public
  using (is_admin())
  with check (is_admin());

drop policy if exists "own holes" on public.holes;
create policy "own holes" on public.holes as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM rounds
  WHERE ((rounds.id = holes.round_id) AND (rounds.user_id = auth.uid())))))
  with check ((EXISTS ( SELECT 1
   FROM rounds
  WHERE ((rounds.id = holes.round_id) AND (rounds.user_id = auth.uid())))));

drop policy if exists "create notifications" on public.notifications;
create policy "create notifications" on public.notifications as permissive for insert to public
  with check ((user_id = auth.uid()));

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications as permissive for select to public
  using ((user_id = auth.uid()));

drop policy if exists "update own notifications" on public.notifications;
create policy "update own notifications" on public.notifications as permissive for update to public
  using ((user_id = auth.uid()));

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles as permissive for insert to public
  with check ((id = auth.uid()));

drop policy if exists "read own, co-members, or admin" on public.profiles;
create policy "read own, co-members, or admin" on public.profiles as permissive for select to public
  using (((id = auth.uid()) OR is_admin() OR shares_active_club(id)));

drop policy if exists "update own or admin all" on public.profiles;
create policy "update own or admin all" on public.profiles as permissive for update to public
  using (((id = auth.uid()) OR is_admin()))
  with check (((id = auth.uid()) OR is_admin()));

drop policy if exists "admin reads all rounds" on public.rounds;
create policy "admin reads all rounds" on public.rounds as permissive for select to public
  using (is_admin());

drop policy if exists "admin updates all rounds" on public.rounds;
create policy "admin updates all rounds" on public.rounds as permissive for update to public
  using (is_admin())
  with check (is_admin());

drop policy if exists "own rounds" on public.rounds;
create policy "own rounds" on public.rounds as permissive for all to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

drop policy if exists "rounds_group_member_insert" on public.rounds;
create policy "rounds_group_member_insert" on public.rounds as permissive for insert to authenticated
  with check (((user_id = auth.uid()) AND is_group_member(group_id, auth.uid())));

drop policy if exists "rounds_group_member_select" on public.rounds;
create policy "rounds_group_member_select" on public.rounds as permissive for select to authenticated
  using (((user_id = auth.uid()) OR is_group_member(group_id, auth.uid())));

drop policy if exists "rounds_group_owner_delete" on public.rounds;
create policy "rounds_group_owner_delete" on public.rounds as permissive for delete to authenticated
  using (((user_id = auth.uid()) OR is_group_admin(group_id, auth.uid())));

drop policy if exists "rounds_group_owner_update" on public.rounds;
create policy "rounds_group_owner_update" on public.rounds as permissive for update to authenticated
  using (((user_id = auth.uid()) OR is_group_admin(group_id, auth.uid())))
  with check (((user_id = auth.uid()) OR is_group_admin(group_id, auth.uid())));

select public.record_migration('0137_core_rls_baseline');
