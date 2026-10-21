-- 0205_anon_boundary.sql
--
-- 211.3 — defence in depth for signed-out visitors (owner, Oct 21 2026). Measured before this: signed-out visitors
-- (the anon role) held Supabase's default full privileges on the core tables and could call 83 privileged
-- (SECURITY DEFINER) functions, including admin ones. Nothing was exploitable — row-level security refused every
-- table and each function refused internally — but each protection was a single layer. Now:
--   * anon holds NO privilege on any public table (members' and the server's privileges are unchanged);
--   * anon can call NO privileged function except the three public live-link functions (each guarded by its
--     secret token): get_live_scorecard, get_live_competition, get_live_lineup. Where members or the server
--     could call a function only through the PUBLIC grant, that right is granted back to them explicitly first,
--     so nothing changes for them;
--   * new tables and functions are no longer opened to anon by default.
-- The public pages (live, line-up, join) need nothing else: the join page reads nothing until the visitor signs in.
--
-- AUTHORIZATION: revokes only — from anon and PUBLIC — with explicit re-grants to authenticated / service_role
-- wherever they held the right before. The security contract snapshot (ci/security_contract.json) records every
-- change.
-- TESTS: ci/assert-anon-boundary.sql
--
-- Idempotent; safe to re-run.

begin;

-- 1. tables: signed-out visitors hold nothing
do $$
declare t record;
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') loop
    execute format('revoke all on public.%I from anon', t.relname);
  end loop;
end $$;

-- 2. privileged functions: only the three live-link functions stay public
do $$
declare f record; auth_ok boolean; svc_ok boolean;
begin
  for f in select p.oid, p.oid::regprocedure::text as sig, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
              and p.proname not in ('get_live_scorecard', 'get_live_competition', 'get_live_lineup')
              and has_function_privilege('anon', p.oid, 'execute') loop
    auth_ok := has_function_privilege('authenticated', f.oid, 'execute');
    svc_ok := has_function_privilege('service_role', f.oid, 'execute');
    if auth_ok then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if svc_ok then execute format('grant execute on function %s to service_role', f.sig); end if;
    execute format('revoke all on function %s from public, anon', f.sig);   -- (all = execute, for a function)
  end loop;
end $$;

-- 3. nothing new is opened to signed-out visitors by default
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon;

select public.record_migration('0205_anon_boundary');

commit;
