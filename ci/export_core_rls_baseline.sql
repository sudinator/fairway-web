-- READ-ONLY production export for the legacy core-table RLS baseline.
-- Run in the Supabase SQL editor and export/copy the result. It does not modify data or schema.
with target(tablename) as (
  values
    ('profiles'),('rounds'),('holes'),('games'),('game_players'),('groups'),
    ('group_members'),('group_invites'),('group_courses'),('favorite_courses'),
    ('notifications'),('activity_log')
), table_state as (
  select
    'table'::text as record_type,
    n.nspname as schemaname,
    c.relname as tablename,
    null::text as policyname,
    null::text as permissive,
    null::text as roles,
    null::text as cmd,
    null::text as qual,
    null::text as with_check,
    c.relrowsecurity::text as rls_enabled,
    c.relforcerowsecurity::text as rls_forced,
    null::text as grantee,
    null::text as privilege_type
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  join target t on t.tablename=c.relname
  where n.nspname='public' and c.relkind='r'
), policies as (
  select
    'policy'::text as record_type,
    p.schemaname,
    p.tablename,
    p.policyname,
    p.permissive,
    array_to_string(p.roles, ',') as roles,
    p.cmd,
    p.qual,
    p.with_check,
    null::text as rls_enabled,
    null::text as rls_forced,
    null::text as grantee,
    null::text as privilege_type
  from pg_policies p
  join target t on t.tablename=p.tablename
  where p.schemaname='public'
), grants as (
  select distinct
    'grant'::text as record_type,
    g.table_schema as schemaname,
    g.table_name as tablename,
    null::text as policyname,
    null::text as permissive,
    null::text as roles,
    null::text as cmd,
    null::text as qual,
    null::text as with_check,
    null::text as rls_enabled,
    null::text as rls_forced,
    g.grantee,
    g.privilege_type
  from information_schema.role_table_grants g
  join target t on t.tablename=g.table_name
  where g.table_schema='public'
    and g.grantee in ('anon','authenticated')
)
select * from table_state
union all select * from policies
union all select * from grants
order by tablename, record_type, policyname nulls first, grantee nulls first, privilege_type nulls first;
