-- READ ONLY hard gate: rebuilt/live core RLS structure must match the hardened Production contract.
-- Generated from ci/core_rls_production_baseline.json captured 2026-08-14.
-- Expression semantics are proved separately in disposable fresh-DB CI by
-- ci/assert-core-rls-expressions.sql; this file intentionally does not compare
-- pg_policies.qual/with_check text because PostgreSQL deparser output is not a stable contract.

do $$
declare
  bad_count integer;
  policy_diff_count integer;
begin
  select count(*) into bad_count
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in ('activity_log','favorite_courses','game_players','games','group_courses','group_invites','group_members','groups','holes','notifications','profiles','rounds')
    and (not c.relrowsecurity or c.relforcerowsecurity);
  if bad_count <> 0 then
    raise exception 'Core RLS table-state mismatch: % table(s)', bad_count;
  end if;

  select 12 - count(*) into bad_count
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relname in ('activity_log','favorite_courses','game_players','games','group_courses','group_invites','group_members','groups','holes','notifications','profiles','rounds');
  if bad_count <> 0 then
    raise exception 'Core RLS table missing: % table(s)', bad_count;
  end if;

  with expected(tablename, policyname, permissive, roles, cmd, qual, with_check) as (
    values
      ('activity_log'::text, 'admins read activity'::text, 'PERMISSIVE'::text, 'public'::text, 'SELECT'::text, '(EXISTS ( SELECT 1
     FROM profiles p
    WHERE ((p.id = auth.uid()) AND (p.is_admin = true))))'::text, null::text),
      ('activity_log'::text, 'insert own activity'::text, 'PERMISSIVE'::text, 'public'::text, 'INSERT'::text, null::text, '(actor_id = auth.uid())'::text),
      ('favorite_courses'::text, 'admin sets vetted'::text, 'PERMISSIVE'::text, 'public'::text, 'UPDATE'::text, '(EXISTS ( SELECT 1
     FROM profiles p
    WHERE ((p.id = auth.uid()) AND (p.is_admin = true))))'::text, 'true'::text),
      ('favorite_courses'::text, 'anyone reads courses'::text, 'PERMISSIVE'::text, 'public'::text, 'SELECT'::text, '(auth.uid() IS NOT NULL)'::text, null::text),
      ('favorite_courses'::text, 'authenticated_adds_global_courses'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'INSERT'::text, null::text, '(auth.uid() IS NOT NULL)'::text),
      ('favorite_courses'::text, 'course_admin_updates_global_courses'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'UPDATE'::text, 'is_admin()'::text, 'is_admin()'::text),
      ('favorite_courses'::text, 'creator or admin deletes'::text, 'PERMISSIVE'::text, 'public'::text, 'DELETE'::text, '((user_id = auth.uid()) OR is_admin())'::text, null::text),
      ('favorite_courses'::text, 'favorite_courses_group_member_all'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'ALL'::text, 'is_group_member(group_id, auth.uid())'::text, 'is_group_member(group_id, auth.uid())'::text),
      ('favorite_courses'::text, 'favorite_courses_select_global_non_deleted'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'SELECT'::text, '(COALESCE(deleted, false) = false)'::text, null::text),
      ('favorite_courses'::text, 'read vetted courses'::text, 'PERMISSIVE'::text, 'public'::text, 'SELECT'::text, '((vetted = true) AND (auth.uid() IS NOT NULL))'::text, null::text),
      ('game_players'::text, 'edit own scores'::text, 'PERMISSIVE'::text, 'public'::text, 'UPDATE'::text, '(auth.uid() = user_id)'::text, '(auth.uid() = user_id)'::text),
      ('game_players'::text, 'join as self'::text, 'PERMISSIVE'::text, 'public'::text, 'INSERT'::text, null::text, '((auth.uid() = user_id) AND is_group_member(( SELECT g.group_id
     FROM games g
    WHERE (g.id = game_players.game_id)), auth.uid()))'::text),
      ('game_players'::text, 'marker_can_update_group_scores'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'UPDATE'::text, '(EXISTS ( SELECT 1
     FROM games g
    WHERE ((g.id = game_players.game_id) AND (g.marker_user_id = auth.uid()))))'::text, '(EXISTS ( SELECT 1
     FROM games g
    WHERE ((g.id = game_players.game_id) AND (g.marker_user_id = auth.uid()))))'::text),
      ('game_players'::text, 'members_add_guests'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'INSERT'::text, null::text, '((is_guest = true) AND (user_id IS NULL) AND (EXISTS ( SELECT 1
     FROM (games g
       JOIN group_members gm ON ((gm.group_id = g.group_id)))
    WHERE ((g.id = game_players.game_id) AND (gm.user_id = auth.uid())))))'::text),
      ('game_players'::text, 'members_delete_guests'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'DELETE'::text, '((is_guest = true) AND (EXISTS ( SELECT 1
     FROM (games g
       JOIN group_members gm ON ((gm.group_id = g.group_id)))
    WHERE ((g.id = game_players.game_id) AND (gm.user_id = auth.uid())))))'::text, null::text),
      ('game_players'::text, 'members_select_guests'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'SELECT'::text, '((is_guest = true) AND (user_id IS NULL) AND (EXISTS ( SELECT 1
     FROM (games g
       JOIN group_members gm ON ((gm.group_id = g.group_id)))
    WHERE ((g.id = game_players.game_id) AND (gm.user_id = auth.uid())))))'::text, null::text),
      ('game_players'::text, 'members_update_guests'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'UPDATE'::text, '((is_guest = true) AND (EXISTS ( SELECT 1
     FROM (games g
       JOIN group_members gm ON ((gm.group_id = g.group_id)))
    WHERE ((g.id = game_players.game_id) AND (gm.user_id = auth.uid())))))'::text, '((is_guest = true) AND (EXISTS ( SELECT 1
     FROM (games g
       JOIN group_members gm ON ((gm.group_id = g.group_id)))
    WHERE ((g.id = game_players.game_id) AND (gm.user_id = auth.uid())))))'::text),
      ('game_players'::text, 'organizer adds players'::text, 'PERMISSIVE'::text, 'public'::text, 'INSERT'::text, null::text, '((auth.uid() = user_id) OR (EXISTS ( SELECT 1
     FROM games g
    WHERE ((g.id = game_players.game_id) AND (g.created_by = auth.uid())))))'::text),
      ('game_players'::text, 'organizer manages players'::text, 'PERMISSIVE'::text, 'public'::text, 'UPDATE'::text, '(EXISTS ( SELECT 1
     FROM games g
    WHERE ((g.id = game_players.game_id) AND (g.created_by = auth.uid()))))'::text, '(EXISTS ( SELECT 1
     FROM games g
    WHERE ((g.id = game_players.game_id) AND (g.created_by = auth.uid()))))'::text),
      ('game_players'::text, 'organizer removes players'::text, 'PERMISSIVE'::text, 'public'::text, 'DELETE'::text, '((auth.uid() = user_id) OR (EXISTS ( SELECT 1
     FROM games g
    WHERE ((g.id = game_players.game_id) AND (g.created_by = auth.uid())))))'::text, null::text),
      ('game_players'::text, 'see co-players'::text, 'PERMISSIVE'::text, 'public'::text, 'SELECT'::text, 'is_game_member(game_id)'::text, null::text),
      ('game_players'::text, 'system admins read game players'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'SELECT'::text, 'is_admin()'::text, null::text),
      ('game_players'::text, 'tee_group_marker_can_update'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'UPDATE'::text, 'is_tee_group_marker(game_id, tee_group)'::text, 'is_tee_group_marker(game_id, tee_group)'::text),
      ('games'::text, 'create games'::text, 'PERMISSIVE'::text, 'public'::text, 'INSERT'::text, null::text, '(auth.uid() = created_by)'::text),
      ('games'::text, 'find or member games'::text, 'PERMISSIVE'::text, 'public'::text, 'SELECT'::text, '(is_game_member(id) OR is_group_member(group_id, auth.uid()) OR (created_by = auth.uid()) OR is_admin())'::text, null::text),
      ('games'::text, 'organizer deletes game'::text, 'PERMISSIVE'::text, 'public'::text, 'DELETE'::text, '(created_by = auth.uid())'::text, null::text),
      ('games'::text, 'update own games'::text, 'PERMISSIVE'::text, 'public'::text, 'UPDATE'::text, '(auth.uid() = created_by)'::text, '(auth.uid() = created_by)'::text),
      ('group_courses'::text, 'add group_courses'::text, 'PERMISSIVE'::text, 'public'::text, 'INSERT'::text, null::text, '(EXISTS ( SELECT 1
     FROM group_members gm
    WHERE ((gm.group_id = group_courses.group_id) AND (gm.user_id = auth.uid()) AND (gm.status = ''active''::text))))'::text),
      ('group_courses'::text, 'ga delete group_courses'::text, 'PERMISSIVE'::text, 'public'::text, 'DELETE'::text, '(is_group_admin(group_id, auth.uid()) OR is_admin())'::text, null::text),
      ('group_courses'::text, 'read group_courses'::text, 'PERMISSIVE'::text, 'public'::text, 'SELECT'::text, '(auth.role() = ''authenticated''::text)'::text, null::text),
      ('group_courses'::text, 'remove group_courses'::text, 'PERMISSIVE'::text, 'public'::text, 'DELETE'::text, '(EXISTS ( SELECT 1
     FROM group_members gm
    WHERE ((gm.group_id = group_courses.group_id) AND (gm.user_id = auth.uid()) AND (gm.status = ''active''::text))))'::text, null::text),
      ('group_invites'::text, 'ga delete invites'::text, 'PERMISSIVE'::text, 'public'::text, 'DELETE'::text, '(is_group_admin(group_id, auth.uid()) OR is_admin())'::text, null::text),
      ('group_invites'::text, 'group_invites_admin_delete'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'DELETE'::text, 'is_group_admin(group_id, auth.uid())'::text, null::text),
      ('group_invites'::text, 'group_invites_admin_select'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'SELECT'::text, 'is_group_admin(group_id, auth.uid())'::text, null::text),
      ('group_invites'::text, 'group_invites_admin_update'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'UPDATE'::text, 'is_group_admin(group_id, auth.uid())'::text, 'is_group_admin(group_id, auth.uid())'::text),
      ('group_members'::text, 'ga delete memberships'::text, 'PERMISSIVE'::text, 'public'::text, 'DELETE'::text, '(is_group_admin(group_id, auth.uid()) OR is_admin())'::text, null::text),
      ('group_members'::text, 'group_members_insert_admin_or_self'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'INSERT'::text, null::text, '(is_group_admin(group_id, auth.uid()) OR ((user_id = auth.uid()) AND (role = ''admin''::text) AND (status = ''active''::text)))'::text),
      ('group_members'::text, 'group_members_select_visible'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'SELECT'::text, '(is_group_member(group_id, auth.uid()) OR (user_id = auth.uid()) OR (lower((email)::text) = lower(COALESCE((auth.jwt() ->> ''email''::text), ''''::text))))'::text, null::text),
      ('group_members'::text, 'group_members_update_admin_or_self_invite'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'UPDATE'::text, '(is_group_admin(group_id, auth.uid()) OR (lower((email)::text) = lower(COALESCE((auth.jwt() ->> ''email''::text), ''''::text))))'::text, '(is_group_admin(group_id, auth.uid()) OR (user_id = auth.uid()))'::text),
      ('groups'::text, 'admin updates groups'::text, 'PERMISSIVE'::text, 'public'::text, 'UPDATE'::text, '(EXISTS ( SELECT 1
     FROM profiles p
    WHERE ((p.id = auth.uid()) AND (p.is_admin = true))))'::text, 'true'::text),
      ('groups'::text, 'group admin can delete group'::text, 'PERMISSIVE'::text, 'public'::text, 'DELETE'::text, '(is_group_admin(id, auth.uid()) OR is_admin())'::text, null::text),
      ('groups'::text, 'groups_insert_authenticated'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'INSERT'::text, null::text, '(created_by = auth.uid())'::text),
      ('groups'::text, 'groups_select_member'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'SELECT'::text, '(is_group_member(id, auth.uid()) OR (created_by = auth.uid()))'::text, null::text),
      ('groups'::text, 'groups_update_admin'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'UPDATE'::text, 'is_group_admin(id, auth.uid())'::text, 'is_group_admin(id, auth.uid())'::text),
      ('holes'::text, 'admin reads all holes'::text, 'PERMISSIVE'::text, 'public'::text, 'SELECT'::text, 'is_admin()'::text, null::text),
      ('holes'::text, 'admin updates all holes'::text, 'PERMISSIVE'::text, 'public'::text, 'UPDATE'::text, 'is_admin()'::text, 'is_admin()'::text),
      ('holes'::text, 'own holes'::text, 'PERMISSIVE'::text, 'public'::text, 'ALL'::text, '(EXISTS ( SELECT 1
     FROM rounds
    WHERE ((rounds.id = holes.round_id) AND (rounds.user_id = auth.uid()))))'::text, '(EXISTS ( SELECT 1
     FROM rounds
    WHERE ((rounds.id = holes.round_id) AND (rounds.user_id = auth.uid()))))'::text),
      ('notifications'::text, 'create notifications'::text, 'PERMISSIVE'::text, 'public'::text, 'INSERT'::text, null::text, '(user_id = auth.uid())'::text),
      ('notifications'::text, 'read own notifications'::text, 'PERMISSIVE'::text, 'public'::text, 'SELECT'::text, '(user_id = auth.uid())'::text, null::text),
      ('notifications'::text, 'update own notifications'::text, 'PERMISSIVE'::text, 'public'::text, 'UPDATE'::text, '(user_id = auth.uid())'::text, null::text),
      ('profiles'::text, 'insert own profile'::text, 'PERMISSIVE'::text, 'public'::text, 'INSERT'::text, null::text, '(id = auth.uid())'::text),
      ('profiles'::text, 'read own, co-members, or admin'::text, 'PERMISSIVE'::text, 'public'::text, 'SELECT'::text, '((id = auth.uid()) OR is_admin() OR shares_active_club(id))'::text, null::text),
      ('profiles'::text, 'update own or admin all'::text, 'PERMISSIVE'::text, 'public'::text, 'UPDATE'::text, '((id = auth.uid()) OR is_admin())'::text, '((id = auth.uid()) OR is_admin())'::text),
      ('rounds'::text, 'admin reads all rounds'::text, 'PERMISSIVE'::text, 'public'::text, 'SELECT'::text, 'is_admin()'::text, null::text),
      ('rounds'::text, 'admin updates all rounds'::text, 'PERMISSIVE'::text, 'public'::text, 'UPDATE'::text, 'is_admin()'::text, 'is_admin()'::text),
      ('rounds'::text, 'own rounds'::text, 'PERMISSIVE'::text, 'public'::text, 'ALL'::text, '(auth.uid() = user_id)'::text, '(auth.uid() = user_id)'::text),
      ('rounds'::text, 'rounds_group_member_insert'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'INSERT'::text, null::text, '((user_id = auth.uid()) AND is_group_member(group_id, auth.uid()))'::text),
      ('rounds'::text, 'rounds_group_member_select'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'SELECT'::text, '((user_id = auth.uid()) OR is_group_member(group_id, auth.uid()))'::text, null::text),
      ('rounds'::text, 'rounds_group_owner_delete'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'DELETE'::text, '((user_id = auth.uid()) OR is_group_admin(group_id, auth.uid()))'::text, null::text),
      ('rounds'::text, 'rounds_group_owner_update'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'UPDATE'::text, '((user_id = auth.uid()) OR is_group_admin(group_id, auth.uid()))'::text, '((user_id = auth.uid()) OR is_group_admin(group_id, auth.uid()))'::text)
  ), actual as (
    select tablename::text, policyname::text, permissive::text,
           array_to_string(roles, ',')::text as roles, cmd::text
    from pg_policies
    where schemaname='public' and tablename in ('activity_log','favorite_courses','game_players','games','group_courses','group_invites','group_members','groups','holes','notifications','profiles','rounds')
  ), diff_keys as (
    select coalesce(e.tablename,a.tablename) tablename, coalesce(e.policyname,a.policyname) policyname
    from expected e
    full outer join actual a using (tablename, policyname)
    where e.tablename is null or a.tablename is null
       or e.permissive is distinct from a.permissive
       or e.roles is distinct from a.roles
       or e.cmd is distinct from a.cmd
  )
  select count(*) into policy_diff_count from diff_keys;

  if policy_diff_count <> 0 then
    raise exception 'Core RLS structural contract mismatch: % policy key(s)', policy_diff_count;
  end if;
end $$;

-- Browser roles need ordinary row operations only, never DDL-like table privileges.
do $$
declare
  t text;
  r text;
  got text[];
  expected text[] := array['DELETE','INSERT','SELECT','UPDATE'];
begin
  foreach t in array array['activity_log','favorite_courses','game_players','games','group_courses','group_invites','group_members','groups','holes','notifications','profiles','rounds'] loop
    foreach r in array array['anon','authenticated'] loop
      select array_agg(privilege_type order by privilege_type) into got
      from information_schema.role_table_grants
      where table_schema='public' and table_name=t and grantee=r;
      if got is distinct from expected then
        raise exception 'Core table grant mismatch for %.%: got %', t, r, got;
      end if;
    end loop;
  end loop;
end $$;

select 'core RLS live structural contract PASS: 12 tables / 60 policy identities+metadata / least-privilege grants' as result;
