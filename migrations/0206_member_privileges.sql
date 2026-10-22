-- 0206_member_privileges.sql
--
-- 211.4 — members' table privileges match their row rules, and every member-writable table carries the
-- approved-accounts rule. Found by the security contract (211.2) on GitHub's real Supabase image: Supabase gives
-- members (authenticated) EVERY privilege on every public table by default, so 27 tables were member-writable
-- by grant without the approved-accounts rule (0197 covered the 14 that the local test database — which didn't
-- mirror Supabase's defaults — showed as writable). On most, row rules still refused members; but on the money
-- tables, tee times, RSVPs and guests, row rules DO let club members write — so a pending or suspended account
-- still in a club could have written there directly. Now:
--   1. outside the 12 core tables (whose privileges 0137 sets and ci/assert-core-rls-live.sql checks), members
--      keep a table privilege only where a row rule can use it: SELECT where a read rule exists (or any write rule,
--      which reads the row it changes), INSERT / UPDATE / DELETE where a rule for that command exists. Every
--      other privilege (and TRUNCATE, REFERENCES, TRIGGER) is removed. Row-level security refused those anyway,
--      so nothing a member can do changes;
--   2. every table members can still write carries guard_active_account (0197) — except push_subscriptions (a
--      pending member must be able to receive "you're approved"), daily_active (the activity ping) and feedback
--      (anyone signed in can write to the owner, even while waiting). profiles and notifications stay exceptions.
--   3. new public tables are no longer opened to members by default — each grants what it needs;
--   4. can_decide_signup — an internal helper — is no longer callable by members (0189's intent).
--
-- AUTHORIZATION: revokes only (from authenticated, on non-core tables without a matching rule) and triggers that
-- refuse unapproved accounts. Server functions are unaffected. Recorded in ci/security_contract.json.
-- TESTS: ci/assert-member-privileges.sql
--
-- Idempotent; safe to re-run.

begin;

do $$
declare t record; cmd text; has_rule boolean; has_any_write boolean;
  core text[] := array['activity_log','favorite_courses','game_players','games','group_courses','group_invites','group_members','groups','holes','notifications','profiles','rounds'];
begin
  for t in select c.oid, c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not (c.relname = any(core)) loop
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t.relname);
    select exists (select 1 from pg_policy p where p.polrelid = t.oid and p.polpermissive and p.polcmd in ('a','w','d','*')
                    and (0 = any(p.polroles) or 'authenticated'::regrole = any(p.polroles))) into has_any_write;
    foreach cmd in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      select exists (select 1 from pg_policy p where p.polrelid = t.oid and p.polpermissive
                      and p.polcmd in (case cmd when 'SELECT' then 'r' when 'INSERT' then 'a' when 'UPDATE' then 'w' else 'd' end, '*')
                      and (0 = any(p.polroles) or 'authenticated'::regrole = any(p.polroles))) into has_rule;
      if cmd = 'SELECT' and has_any_write then has_rule := true; end if;   -- a write reads the row it changes
      if not has_rule then execute format('revoke %s on public.%I from authenticated', cmd, t.relname); end if;
    end loop;
  end loop;
end $$;

do $$
declare t record;
begin
  for t in select distinct g.table_name from information_schema.role_table_grants g
            where g.table_schema = 'public' and g.grantee = 'authenticated' and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
              and g.table_name not in ('profiles', 'notifications', 'push_subscriptions', 'daily_active', 'feedback') loop
    execute format('drop trigger if exists guard_active_account on public.%I', t.table_name);
    execute format('create trigger guard_active_account before insert or update or delete on public.%I for each row execute function public.guard_active_account()', t.table_name);
  end loop;
end $$;

alter default privileges in schema public revoke all on tables from authenticated;

-- can_decide_signup (0189) is an internal helper for admit / reject; 0189 never granted it to members, but
-- Supabase's default privileges did. Restore the intent (the functions that use it run with their own rights).
revoke all on function public.can_decide_signup(uuid, uuid) from public, anon, authenticated;

select public.record_migration('0206_member_privileges');

commit;
