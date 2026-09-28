-- 0157_course_api_check_service_role.sql
--
-- The contract monitor could not record its own results.
--
-- 0156 gave record_course_api_check a `if auth.uid() is null then raise` check. That was written for
-- the APP, which calls it as a signed-in user. The MONITOR authenticates with a SERVICE-ROLE key and
-- has no auth.uid() at all, so every result it tried to record failed with "sign in required": the
-- ledger filled with claim placeholders and NO findings. Drift would have been detected by the
-- monitor and then thrown away. Measured end to end against a real Postgres — "18 rows, 0 ok".
--
-- The first attempt at a fix tested `current_user <> 'service_role'` and still failed, because
-- inside a SECURITY DEFINER function current_user is the function's OWNER, not the caller. Measured:
-- called as service_role it reads "postgres". The caller's role is visible only through
-- current_setting('role'), which is what PostgREST sets from the key's JWT.
--
-- This migration exists rather than an edit to 0156 because a released migration is immutable:
-- 0156 has been applied, and anyone rebuilding from history must arrive at the same database that
-- the people who applied it already have.
--
-- AUTHORIZATION: unchanged in character. Two callers are legitimate and no others:
--   * the app, as a signed-in user (auth.uid() present), writing a verification for a course it
--     just looked up successfully;
--   * the contract monitor, as service_role, writing the result of a check it just performed.
-- Anything that is neither is still rejected. The function writes only to course_api_checks, keyed
-- by the provider id it is given, and returns nothing.
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.record_course_api_check(
  p_provider_id text,
  p_status      text default 'ok',
  p_club_name   text default null,
  p_course_name text default null,
  p_location    text default null,
  p_note        text default null
) returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- SECURITY DEFINER runs with the owner's rights, so it must confirm who is calling. current_user
  -- is the OWNER here, never the caller, so it cannot be used for that: the caller's role arrives in
  -- current_setting('role'), set by PostgREST from the key's JWT.
  if auth.uid() is null and coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_provider_id is null or length(trim(p_provider_id)) = 0 then
    return;
  end if;
  if p_status is null or p_status not in ('ok', 'drift', 'error') then
    raise exception 'status must be ok, drift or error' using errcode = '22023';
  end if;

  insert into public.course_api_checks as c
    (provider_id, last_checked_at, last_status, club_name, course_name, location, note, updated_at)
  values
    (trim(p_provider_id), now(), p_status, p_club_name, p_course_name, p_location, p_note, now())
  on conflict (provider_id) do update
     set last_checked_at = now(),
         last_status     = excluded.last_status,
         -- Keep the last KNOWN values when a caller does not supply them: a failed lookup should not
         -- erase what the course looked like the last time it resolved.
         club_name       = coalesce(excluded.club_name, c.club_name),
         course_name     = coalesce(excluded.course_name, c.course_name),
         location        = coalesce(excluded.location, c.location),
         note            = excluded.note,
         updated_at      = now();
end;
$function$;

revoke all on function public.record_course_api_check(text, text, text, text, text, text) from public;
grant execute on function public.record_course_api_check(text, text, text, text, text, text) to authenticated, service_role;

select public.record_migration('0157_course_api_check_service_role');

commit;
