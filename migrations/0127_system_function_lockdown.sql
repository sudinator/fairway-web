-- 0127_system_function_lockdown.sql
-- Follow-up security review (Aug 2026), findings #4/#5: system-maintenance SECURITY DEFINER functions
-- were reachable by ordinary authenticated identities (and some by PUBLIC via the default grant), and
-- expire_support_sessions had no input validation. Locks each to the minimum caller and validates input.
-- Per-function rationale (verified callers before changing, so nothing legitimate breaks):
--   expire_support_sessions  — admin ops tool (called from the is_admin manage screen). Now requires
--                              is_admin() AND validates p_max_hours (a negative value inverted the
--                              interval and deleted ACTIVE support sessions). Kept for authenticated;
--                              the gate is inside.
--   purge_old_notifications  — pg_cron only (04:23 UTC); no app caller. Revoked from all app roles;
--   send_tee_reminders       — pg_cron only (*/15); no app caller. Revoked from all app roles.
--                              (cron runs as the function owner, so revoking EXECUTE from app roles
--                               does not affect the scheduled job.)
--   finish_stale_rounds      — deliberately called by every client on load as a self-healing sweep
--                              (time-bounded, idempotent). Kept for authenticated; revoked PUBLIC/anon.
--   sweep_friction           — already gated on is_admin() internally; PUBLIC/anon revoked for hygiene.
-- Run after 0126.
--
-- AUTHORIZATION: expire_support_sessions(int) — is_admin() only, p_max_hours in [1,8760]. sweep_friction
-- — is_admin() (unchanged, internal). finish_stale_rounds() — any authenticated client (self-healing,
-- no user input, time-bounded). purge_old_notifications()/send_tee_reminders() — no app role; pg_cron/owner
-- only.

-- expire_support_sessions: admin-gate + input validation (fixes the negative-interval deletion of live sessions)
create or replace function public.expire_support_sessions(p_max_hours int default 12)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_max_hours is null or p_max_hours < 1 or p_max_hours > 8760 then
    raise exception 'p_max_hours must be between 1 and 8760' using errcode = '22023';
  end if;
  with del as (
    delete from group_members
     where is_support = true
       and support_started_at is not null
       and support_started_at < now() - make_interval(hours => p_max_hours)
    returning 1
  )
  select count(*) into n from del;
  return n;
end; $$;
revoke all on function public.expire_support_sessions(int) from public;
revoke all on function public.expire_support_sessions(int) from anon;
grant execute on function public.expire_support_sessions(int) to authenticated;

-- cron-only reapers: remove the default/explicit app-role EXECUTE (pg_cron runs as owner, unaffected)
revoke all on function public.purge_old_notifications() from public;
revoke all on function public.purge_old_notifications() from anon;
revoke all on function public.purge_old_notifications() from authenticated;

revoke all on function public.send_tee_reminders() from public;
revoke all on function public.send_tee_reminders() from anon;
revoke all on function public.send_tee_reminders() from authenticated;

-- self-healing sweep: any signed-in client may trigger it (that's the design), but not PUBLIC/anon
revoke all on function public.finish_stale_rounds() from public;
revoke all on function public.finish_stale_rounds() from anon;
grant execute on function public.finish_stale_rounds() to authenticated;

-- friction sweep is already is_admin()-gated internally; tighten the grant surface for hygiene
revoke all on function public.sweep_friction(boolean) from public;
revoke all on function public.sweep_friction(boolean) from anon;
grant execute on function public.sweep_friction(boolean) to authenticated;

select public.record_migration('0127_system_function_lockdown');
