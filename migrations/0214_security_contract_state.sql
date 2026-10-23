-- 0214_security_contract_state.sql
--
-- 212.8 — the security contract, checked on PRODUCTION too (owner, Oct 22). The contract (211.2) checks the database
-- built from migrations, so a rule or permission changed by hand in production's dashboard went unseen.
-- security_contract_state() reports exactly what the contract checks — every access rule, every member / visitor
-- table privilege, who can call each privileged function, and the no-exceptions rules (RLS off, a privileged function
-- without a fixed search_path, a member-writable table without the approved-accounts rule) — and file storage: the
-- avatars' access rules and each bucket's public / size / type settings. The contract check reads
-- this ONE function locally, in GitHub's fresh database and — read-only, with the server key — on production
-- (nightly, and on every pull request), comparing it with ci/security_contract.json.
--
-- AUTHORIZATION: security_contract_state() — SECURITY DEFINER, revoked from public / anon / authenticated; the
-- server (service role) only. Read-only: it reads the catalog and returns JSON.
-- TESTS: ci/assert-security-contract-state.sql
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.security_contract_state()
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select jsonb_build_object(
    'rls_off', coalesce((select jsonb_agg(c.relname order by c.relname) from pg_class c
                          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity), '[]'::jsonb),
    'policies', coalesce((select jsonb_object_agg(c.relname || '.' || p.polname, jsonb_build_object(
                            'cmd', p.polcmd::text,
                            'roles', array_to_string(array(select coalesce(nullif(r.rolname, ''), 'public') from unnest(p.polroles) o left join pg_roles r on r.oid = o order by 1), ','),
                            'using', pg_get_expr(p.polqual, p.polrelid),
                            'check', pg_get_expr(p.polwithcheck, p.polrelid)))
                          from pg_policy p join pg_class c on c.oid = p.polrelid where c.relnamespace = 'public'::regnamespace), '{}'::jsonb),
    'table_grants', coalesce((select jsonb_object_agg(g.grantee || ':' || g.table_name, g.privs) from (
                               select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) privs
                                 from information_schema.role_table_grants
                                where table_schema = 'public' and grantee in ('anon', 'authenticated') group by 1, 2) g), '{}'::jsonb),
    'definer_execute', coalesce((select jsonb_object_agg(p.oid::regprocedure::text,
                               concat_ws(',', case when has_function_privilege('anon', p.oid, 'execute') then 'anon' end,
                                              case when has_function_privilege('authenticated', p.oid, 'execute') then 'authenticated' end))
                               from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype), '{}'::jsonb),
    'definer_no_search_path', coalesce((select jsonb_agg(p.oid::regprocedure::text order by 1) from pg_proc p
                               where p.pronamespace = 'public'::regnamespace and p.prosecdef
                                 and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cf where cf like 'search_path=%')), '[]'::jsonb),
    'writable_without_guard', coalesce((select jsonb_agg(distinct c.relname order by c.relname) from information_schema.role_table_grants g
                               join pg_class c on c.relname = g.table_name and c.relnamespace = 'public'::regnamespace
                              where g.table_schema = 'public' and g.grantee = 'authenticated' and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
                                and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'guard_active_account')), '[]'::jsonb),
    -- file storage (avatars): its access rules and each bucket's public / size / type settings
    'storage_policies', coalesce((select jsonb_object_agg(p.polname, jsonb_build_object(
                            'cmd', p.polcmd::text,
                            'roles', array_to_string(array(select coalesce(nullif(r.rolname, ''), 'public') from unnest(p.polroles) o left join pg_roles r on r.oid = o order by 1), ','),
                            'using', pg_get_expr(p.polqual, p.polrelid),
                            'check', pg_get_expr(p.polwithcheck, p.polrelid)))
                          from pg_policy p join pg_class c on c.oid = p.polrelid
                         where c.relnamespace = to_regnamespace('storage') and c.relname = 'objects'), '{}'::jsonb),
    'buckets', coalesce((select jsonb_object_agg(b.id, jsonb_build_object('public', b.public, 'file_size_limit', b.file_size_limit, 'allowed_mime_types', b.allowed_mime_types))
                          from storage.buckets b), '{}'::jsonb)
  )
$$;
revoke all on function public.security_contract_state() from public, anon, authenticated;
grant execute on function public.security_contract_state() to service_role;

select public.record_migration('0214_security_contract_state');

commit;
