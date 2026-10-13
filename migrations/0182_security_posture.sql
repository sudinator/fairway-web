-- 0182_security_posture.sql
--
-- Supabase flagged two production tables with Row-Level Security OFF (rls_disabled_in_public,
-- 2026-10-11): course_id_pre_reconciliation_snapshot and course_id_reconciliation_tmp. They were
-- created by the one-off course-id reconciliation run by hand on production before 177.20
-- (Aug 2026) and never dropped. They held course reference data only (ids, names, facilities,
-- provider ids, match notes) — no users, scores or emails — and nothing in the app uses them.
--
--   * Both are dropped here, through the audited path (staging too, if present).
--   * security_posture(): a read-only inventory of public tables and whether RLS is enabled, so the
--     live parity check (ci/check_live_migration_parity.mjs) can fail the deploy — and the nightly
--     production check can alert — when ANY public table has RLS off or exists without a migration.
--
-- AUTHORIZATION:
--   * security_posture: SECURITY DEFINER; callable by the service role only (the CI parity job's
--     credential). It returns table names and RLS flags, never data.
--
-- Idempotent; safe to re-run.

begin;

drop table if exists public.course_id_pre_reconciliation_snapshot;
drop table if exists public.course_id_reconciliation_tmp;

create or replace function public.security_posture()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' and session_user <> 'postgres' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'rls', c.relrowsecurity) order by c.relname), '[]'::jsonb)
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p'));
end $$;
revoke all on function public.security_posture() from public, anon, authenticated;
grant execute on function public.security_posture() to service_role;

select public.record_migration('0182_security_posture');

commit;
