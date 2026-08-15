-- READ ONLY hard gate: live core RLS must match the checked-in Production baseline.
-- Generated from ci/core_rls_production_baseline.json captured 2026-08-14.

begin;

do $$
declare
  bad_count integer;
begin
  -- 12 core tables must have RLS enabled and FORCE RLS disabled, matching Production.
  select count(*) into bad_count
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in ('activity_log'::text, 'favorite_courses'::text, 'game_players'::text, 'games'::text, 'group_courses'::text, 'group_invites'::text, 'group_members'::text, 'groups'::text, 'holes'::text, 'notifications'::text, 'profiles'::text, 'rounds'::text)
    and (not c.relrowsecurity or c.relforcerowsecurity);
  if bad_count <> 0 then
    raise exception 'Core RLS table-state mismatch: % table(s)', bad_count;
  end if;

  select 12 - count(*) into bad_count
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relname in ('activity_log'::text, 'favorite_courses'::text, 'game_players'::text, 'games'::text, 'group_courses'::text, 'group_invites'::text, 'group_members'::text, 'groups'::text, 'holes'::text, 'notifications'::text, 'profiles'::text, 'rounds'::text);
  if bad_count <> 0 then
    raise exception 'Core RLS table missing: % table(s)', bad_count;
  end if;
end $$;

-- Materialize the expected Production policy contract and the actual rebuilt/live
-- policy state so CI can print exact row/field diagnostics before failing.
-- Keep raw pg_policies text here: until a difference is reviewed, formatting and
-- semantic drift are both treated as hard failures.
create temporary table _core_rls_expected (
  tablename text not null,
  policyname text not null,
  permissive text not null,
  roles text not null,
  cmd text not null,
  qual text,
  with_check text,
  primary key (tablename, policyname)
) on commit drop;

insert into _core_rls_expected
  (tablename, policyname, permissive, roles, cmd, qual, with_check)
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
      ('game_players'::text, 'tee_group_marker_can_update'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'UPDATE'::text, 'is_tee_group_marker(game_id, tee_group)'::text, 'is_tee_group_marker(game_id, tee_group)'::text),
      ('games'::text, 'create games'::text, 'PERMISSIVE'::text, 'public'::text, 'INSERT'::text, null::text, '(auth.uid() = created_by)'::text),
      ('games'::text, 'find or member games'::text, 'PERMISSIVE'::text, 'public'::text, 'SELECT'::text, '(is_game_member(id) OR is_group_member(group_id, auth.uid()) OR (created_by = auth.uid()) OR is_admin())'::text, null::text),
      ('games'::text, 'games_group_member_all'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'ALL'::text, 'is_group_member(group_id, auth.uid())'::text, 'is_group_member(group_id, auth.uid())'::text),
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
      ('rounds'::text, 'rounds_group_owner_update'::text, 'PERMISSIVE'::text, 'authenticated'::text, 'UPDATE'::text, '((user_id = auth.uid()) OR is_group_admin(group_id, auth.uid()))'::text, '((user_id = auth.uid()) OR is_group_admin(group_id, auth.uid()))'::text);

-- Parse the checked-in Production expressions through the SAME PostgreSQL engine
-- that owns the rebuilt/live policies before comparing them. pg_policies is a deparser:
-- equivalent CREATE POLICY source can be rendered differently across PostgreSQL builds.
-- We therefore let PostgreSQL parse/deparse the expected expressions on session-local
-- shadow tables, then compare that runtime-canonical output to the real public policies.
-- This does not weaken logical comparison: material predicate mutations remain different,
-- and representative security mutations are exercised below as hard self-tests.
select
  'CORE_RLS_DB_VERSION' as marker,
  current_setting('server_version') as server_version,
  version() as server_build;

do $$
declare
  t text;
begin
  foreach t in array array[
    'activity_log'::text, 'favorite_courses'::text, 'game_players'::text,
    'games'::text, 'group_courses'::text, 'group_invites'::text,
    'group_members'::text, 'groups'::text, 'holes'::text,
    'notifications'::text, 'profiles'::text, 'rounds'::text
  ] loop
    -- CREATE TABLE AS is deliberate: only column names/types are required to parse
    -- policy expressions; no Production rows, constraints, triggers or indexes are copied.
    execute format(
      'create temporary table %I on commit drop as select * from public.%I with no data',
      t, t
    );
  end loop;
end $$;

do $$
declare
  p record;
  stmt text;
begin
  for p in
    select * from _core_rls_expected order by tablename, policyname
  loop
    stmt := format(
      'create policy %I on pg_temp.%I as %s for %s to %s',
      p.policyname, p.tablename, p.permissive, p.cmd, p.roles
    );
    if p.qual is not null then
      stmt := stmt || format(' using (%s)', p.qual);
    end if;
    if p.with_check is not null then
      stmt := stmt || format(' with check (%s)', p.with_check);
    end if;
    execute stmt;
  end loop;
end $$;

create temporary table _core_rls_expected_runtime on commit drop as
select
  tablename::text,
  policyname::text,
  permissive::text,
  array_to_string(roles, ',')::text as roles,
  cmd::text,
  qual::text,
  with_check::text
from pg_policies
where schemaname = (select nspname from pg_namespace where oid = pg_my_temp_schema())
  and tablename in ('activity_log'::text, 'favorite_courses'::text, 'game_players'::text, 'games'::text, 'group_courses'::text, 'group_invites'::text, 'group_members'::text, 'groups'::text, 'holes'::text, 'notifications'::text, 'profiles'::text, 'rounds'::text);

do $$
declare
  bad_count integer;
begin
  select count(*) into bad_count
  from (
    (select tablename, policyname, permissive, roles, cmd from _core_rls_expected
     except
     select tablename, policyname, permissive, roles, cmd from _core_rls_expected_runtime)
    union all
    (select tablename, policyname, permissive, roles, cmd from _core_rls_expected_runtime
     except
     select tablename, policyname, permissive, roles, cmd from _core_rls_expected)
  ) d;
  if bad_count <> 0 then
    raise exception 'Core RLS expected-policy canonicalization lost metadata (% differing row(s))', bad_count;
  end if;

  select count(*) into bad_count from _core_rls_expected_runtime;
  if bad_count <> 60 then
    raise exception 'Core RLS expected-policy canonicalization produced % policies, expected 60', bad_count;
  end if;
end $$;

create temporary table _core_rls_actual on commit drop as
select
  tablename::text,
  policyname::text,
  permissive::text,
  array_to_string(roles, ',')::text as roles,
  cmd::text,
  qual::text,
  with_check::text
from pg_policies
where schemaname='public'
  and tablename in ('activity_log'::text, 'favorite_courses'::text, 'game_players'::text, 'games'::text, 'group_courses'::text, 'group_invites'::text, 'group_members'::text, 'groups'::text, 'holes'::text, 'notifications'::text, 'profiles'::text, 'rounds'::text);

-- Show non-failing source/deparser differences explicitly. These rows mean the raw
-- Production export text differs from this PostgreSQL build's rendering, while the
-- same-engine canonical expected expression is exactly equal to the actual policy.
select
  'CORE_RLS_RENDERING' as marker,
  r.tablename,
  r.policyname,
  concat_ws(', ',
    case when r.qual is distinct from a.qual then 'qual' end,
    case when r.with_check is distinct from a.with_check then 'with_check' end
  ) as rendering_fields,
  r.qual as production_export_qual,
  e.qual as runtime_expected_qual,
  a.qual as actual_qual,
  r.with_check as production_export_with_check,
  e.with_check as runtime_expected_with_check,
  a.with_check as actual_with_check
from _core_rls_expected r
join _core_rls_expected_runtime e using (tablename, policyname)
join _core_rls_actual a using (tablename, policyname)
where (r.qual is distinct from a.qual or r.with_check is distinct from a.with_check)
  and r.permissive is not distinct from a.permissive
  and r.roles is not distinct from a.roles
  and r.cmd is not distinct from a.cmd
  and e.qual is not distinct from a.qual
  and e.with_check is not distinct from a.with_check
order by r.tablename, r.policyname;

-- Canonicalization safety canaries. These run in PostgreSQL, not a regex normalizer:
-- one equivalent formatting variant MUST converge, while representative material
-- security mutations MUST remain distinct from the checked-in expected policy.
do $$
declare
  expected_expr text;
  canary_expr text;
begin
  execute 'create policy "__canary_equivalent_admin" on pg_temp.activity_log for select to public using (((EXISTS ( SELECT 1 FROM profiles p WHERE (((p.id = auth.uid())) AND ((p.is_admin = true))) ))))';
  select qual into expected_expr from _core_rls_expected_runtime where tablename='activity_log' and policyname='admins read activity';
  select qual into canary_expr from pg_policies where schemaname=(select nspname from pg_namespace where oid=pg_my_temp_schema()) and tablename='activity_log' and policyname='__canary_equivalent_admin';
  if canary_expr is distinct from expected_expr then
    raise exception 'Core RLS canonicalization self-test failed: equivalent formatting did not converge';
  end if;

  execute 'create policy "__canary_remove_admin" on pg_temp.activity_log for select to public using (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()))';
  select qual into canary_expr from pg_policies where schemaname=(select nspname from pg_namespace where oid=pg_my_temp_schema()) and tablename='activity_log' and policyname='__canary_remove_admin';
  if canary_expr is not distinct from expected_expr then
    raise exception 'Core RLS canonicalization self-test failed: removed admin predicate was not detected';
  end if;

  execute 'create policy "__canary_holes_or" on pg_temp.holes for select to public using (EXISTS (SELECT 1 FROM rounds WHERE (rounds.id = holes.round_id) OR (rounds.user_id = auth.uid())))';
  select qual into expected_expr from _core_rls_expected_runtime where tablename='holes' and policyname='own holes';
  select qual into canary_expr from pg_policies where schemaname=(select nspname from pg_namespace where oid=pg_my_temp_schema()) and tablename='holes' and policyname='__canary_holes_or';
  if canary_expr is not distinct from expected_expr then
    raise exception 'Core RLS canonicalization self-test failed: AND-to-OR mutation was not detected';
  end if;

  execute 'create policy "__canary_guest_without_flag" on pg_temp.game_players for insert to authenticated with check ((user_id IS NULL) AND (EXISTS (SELECT 1 FROM (games g JOIN group_members gm ON (gm.group_id = g.group_id)) WHERE (g.id = game_players.game_id) AND (gm.user_id = auth.uid()))))';
  select with_check into expected_expr from _core_rls_expected_runtime where tablename='game_players' and policyname='members_add_guests';
  select with_check into canary_expr from pg_policies where schemaname=(select nspname from pg_namespace where oid=pg_my_temp_schema()) and tablename='game_players' and policyname='__canary_guest_without_flag';
  if canary_expr is not distinct from expected_expr then
    raise exception 'Core RLS canonicalization self-test failed: removed is_guest predicate was not detected';
  end if;

  execute 'create policy "__canary_join_without_self" on pg_temp.game_players for insert to public with check (is_group_member((SELECT g.group_id FROM games g WHERE g.id = game_players.game_id), auth.uid()))';
  select with_check into expected_expr from _core_rls_expected_runtime where tablename='game_players' and policyname='join as self';
  select with_check into canary_expr from pg_policies where schemaname=(select nspname from pg_namespace where oid=pg_my_temp_schema()) and tablename='game_players' and policyname='__canary_join_without_self';
  if canary_expr is not distinct from expected_expr then
    raise exception 'Core RLS canonicalization self-test failed: removed self-ownership predicate was not detected';
  end if;

  execute 'create policy "__canary_organizer_marker" on pg_temp.game_players for update to public using (EXISTS (SELECT 1 FROM games g WHERE (g.id = game_players.game_id) AND (g.marker_user_id = auth.uid())))';
  select qual into expected_expr from _core_rls_expected_runtime where tablename='game_players' and policyname='organizer manages players';
  select qual into canary_expr from pg_policies where schemaname=(select nspname from pg_namespace where oid=pg_my_temp_schema()) and tablename='game_players' and policyname='__canary_organizer_marker';
  if canary_expr is not distinct from expected_expr then
    raise exception 'Core RLS canonicalization self-test failed: organizer ownership mutation was not detected';
  end if;

  execute 'create policy "__canary_group_course_no_active" on pg_temp.group_courses for insert to public with check (EXISTS (SELECT 1 FROM group_members gm WHERE (gm.group_id = group_courses.group_id) AND (gm.user_id = auth.uid())))';
  select with_check into expected_expr from _core_rls_expected_runtime where tablename='group_courses' and policyname='add group_courses';
  select with_check into canary_expr from pg_policies where schemaname=(select nspname from pg_namespace where oid=pg_my_temp_schema()) and tablename='group_courses' and policyname='__canary_group_course_no_active';
  if canary_expr is not distinct from expected_expr then
    raise exception 'Core RLS canonicalization self-test failed: removed active-membership predicate was not detected';
  end if;
end $$;

select 'CORE_RLS_CANARY_PASS' as marker,
       'same-engine rendering converges; material predicate mutations remain distinct' as result;

-- Genuine differences only: policy identity/metadata are compared exactly, while
-- USING/WITH CHECK compare against the same-engine parsed/deparsed expected form.
with paired as (
  select
    coalesce(r.tablename, a.tablename) as tablename,
    coalesce(r.policyname, a.policyname) as policyname,
    r.tablename is null as unexpected_actual,
    a.tablename is null as missing_expected,
    r.permissive as expected_permissive, a.permissive as actual_permissive,
    r.roles as expected_roles, a.roles as actual_roles,
    r.cmd as expected_cmd, a.cmd as actual_cmd,
    r.qual as production_export_qual,
    e.qual as expected_runtime_qual,
    a.qual as actual_qual,
    r.with_check as production_export_with_check,
    e.with_check as expected_runtime_with_check,
    a.with_check as actual_with_check
  from _core_rls_expected r
  join _core_rls_expected_runtime e using (tablename, policyname)
  full outer join _core_rls_actual a using (tablename, policyname)
), differences as (
  select *,
    concat_ws(', ',
      case when missing_expected then 'missing_expected' end,
      case when unexpected_actual then 'unexpected_actual' end,
      case when expected_permissive is distinct from actual_permissive then 'permissive' end,
      case when expected_roles is distinct from actual_roles then 'roles' end,
      case when expected_cmd is distinct from actual_cmd then 'cmd' end,
      case when expected_runtime_qual is distinct from actual_qual then 'qual' end,
      case when expected_runtime_with_check is distinct from actual_with_check then 'with_check' end
    ) as differing_fields
  from paired
  where missing_expected
     or unexpected_actual
     or expected_permissive is distinct from actual_permissive
     or expected_roles is distinct from actual_roles
     or expected_cmd is distinct from actual_cmd
     or expected_runtime_qual is distinct from actual_qual
     or expected_runtime_with_check is distinct from actual_with_check
)
select
  'CORE_RLS_DIFF' as marker,
  tablename, policyname, differing_fields,
  expected_permissive, actual_permissive,
  expected_roles, actual_roles,
  expected_cmd, actual_cmd,
  production_export_qual, expected_runtime_qual, actual_qual,
  production_export_with_check, expected_runtime_with_check, actual_with_check
from differences
order by tablename, policyname;

do $$
declare
  policy_diff_count integer;
begin
  with paired as (
    select
      coalesce(r.tablename, a.tablename) as tablename,
      coalesce(r.policyname, a.policyname) as policyname,
      r.tablename is null as unexpected_actual,
      a.tablename is null as missing_expected,
      r.permissive as expected_permissive, a.permissive as actual_permissive,
      r.roles as expected_roles, a.roles as actual_roles,
      r.cmd as expected_cmd, a.cmd as actual_cmd,
      e.qual as expected_runtime_qual, a.qual as actual_qual,
      e.with_check as expected_runtime_with_check, a.with_check as actual_with_check
    from _core_rls_expected r
    join _core_rls_expected_runtime e using (tablename, policyname)
    full outer join _core_rls_actual a using (tablename, policyname)
  )
  select count(*) into policy_diff_count
  from paired
  where missing_expected
     or unexpected_actual
     or expected_permissive is distinct from actual_permissive
     or expected_roles is distinct from actual_roles
     or expected_cmd is distinct from actual_cmd
     or expected_runtime_qual is distinct from actual_qual
     or expected_runtime_with_check is distinct from actual_with_check;

  if policy_diff_count <> 0 then
    raise exception 'Core RLS policy definitions differ from checked-in Production contract (% policy key(s)); see CORE_RLS_DIFF rows above', policy_diff_count;
  end if;
end $$;

-- Production grants the same seven table privileges to anon and authenticated.
do $$
declare
  t text;
  r text;
  got text[];
  expected text[] := array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'];
begin
  foreach t in array array['activity_log'::text, 'favorite_courses'::text, 'game_players'::text, 'games'::text, 'group_courses'::text, 'group_invites'::text, 'group_members'::text, 'groups'::text, 'holes'::text, 'notifications'::text, 'profiles'::text, 'rounds'::text] loop
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

select 'core RLS live contract PASS: 12 tables / 60 policies / grants match checked-in baseline' as result;

commit;
