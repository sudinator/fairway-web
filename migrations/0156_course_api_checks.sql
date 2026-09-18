-- 0156_course_api_checks.sql
--
-- Ration the GolfCourseAPI to ten checks a day.
--
-- THE CONSTRAINT: the free tier allows 35 requests per DAY. The contract monitor made 31 in one run
-- — 89% of the budget — leaving four for the entire app. On 2026-09-17 four manual runs plus a
-- 19-request yardage backfill exhausted the quota; the provider returned
-- 429 {"error":"daily usage limit exceeded"} with retry-after 67453, and the monitor reported it as
-- CONTRACT DRIFT. Six releases were spent hunting a provider change that had never happened.
--
-- THE DESIGN: ten checks a day, oldest first, skipping anything verified within seven days. A full
-- pass over the golden set takes about a week and then idles. Twenty-five requests remain for the
-- app and for ad-hoc debugging.
--
-- Crucially the APP writes here too: a successful /api/courses lookup IS a verification of that
-- course, so ordinary app traffic REDUCES what the monitor has to do rather than competing with it
-- for the same scarce budget.
--
-- AUTHORIZATION:
--   * The table is service-role only. RLS is enabled with NO permissive policy, so anon and
--     authenticated cannot read or write it directly. It holds no user data — provider ids and
--     timestamps — but it is operational state and nothing in the client needs it.
--   * record_course_api_check(...) is SECURITY DEFINER and granted to authenticated, because the
--     app's /api/courses route records verifications while acting as the signed-in user. It writes
--     ONLY to this table, keyed by the provider id it was given, and returns nothing. There is no
--     auth.uid() check because there is nothing user-scoped to check: any signed-in caller may
--     report that a public course id resolved, and the worst a malicious caller achieves is marking
--     a course fresh that is not, which delays a contract check by a week. Weighed against giving
--     the app a service-role key, that is the smaller risk.
--   * claim_course_api_checks(...) is SECURITY DEFINER and granted to SERVICE_ROLE ONLY. It hands
--     out the day's batch and marks it claimed in one statement so two concurrent runs cannot take
--     the same ten. It is never called from the client.
--
-- Idempotent; safe to re-run.

begin;

create table if not exists public.course_api_checks (
  provider_id      text primary key,
  last_checked_at  timestamptz not null default now(),
  last_status      text not null default 'ok',
  club_name        text,
  course_name      text,
  location         text,
  note             text,
  updated_at       timestamptz not null default now()
);

alter table public.course_api_checks drop constraint if exists course_api_checks_status_chk;
alter table public.course_api_checks
  add constraint course_api_checks_status_chk
  check (last_status in ('ok', 'drift', 'error'));

-- Oldest-first is the whole scheduling rule, so it gets an index.
create index if not exists course_api_checks_stale_idx
  on public.course_api_checks (last_checked_at asc);

-- Deny by default: no policy is created, so RLS blocks anon and authenticated outright. Only the
-- service role (which bypasses RLS) and the two SECURITY DEFINER functions below can touch it.
alter table public.course_api_checks enable row level security;
revoke all on table public.course_api_checks from anon, authenticated;

comment on table public.course_api_checks is
  'When each GolfCourseAPI course was last verified. Written by the contract monitor and by '
  'successful /api/courses lookups. Exists to keep total provider traffic under the free tier''s '
  '35 requests per day (0156).';

-- ── The app records a verification ───────────────────────────────────────────────────────────────
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
  -- SECURITY DEFINER runs with the owner's rights, so it must confirm it has a caller of its own.
  -- EXECUTE is granted to authenticated only, but a definer function should not rely solely on the
  -- grant: verify the session identity here too.
  if auth.uid() is null then
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
grant execute on function public.record_course_api_check(text, text, text, text, text, text) to authenticated;

-- ── The monitor claims its daily batch ───────────────────────────────────────────────────────────
create or replace function public.claim_course_api_checks(
  p_ids       text[],
  p_limit     integer default 10,
  p_max_age   interval default interval '7 days'
) returns table (out_provider_id text, out_last_checked_at timestamptz, out_last_status text)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 35));
begin
  -- OUT parameters are in scope as PL/pgSQL variables inside the body, so naming them after the
  -- table's columns makes `on conflict (provider_id)` ambiguous and the function fails at RUNTIME —
  -- it creates fine. Hence the out_ prefix. Caught by executing it against a real Postgres; no
  -- amount of reading would have shown it.

  -- Serialise claims. `on conflict do update` orders the WRITES but not the SELECT: under READ
  -- COMMITTED two runs starting together both take their snapshot before either commits, both see
  -- the same stale rows, and both claim the SAME ten — measured, two runs, overlap 10 of 10. The
  -- advisory lock is transaction-scoped, so the second run waits and then re-reads with a snapshot
  -- that includes the first run's commit.
  perform pg_advisory_xact_lock(hashtext('course_api_checks.claim'));
  -- Ids never seen before sort first (null last_checked_at), then genuinely stale ones, oldest
  -- first. Anything verified inside the window is skipped entirely — that is what makes a full pass
  -- take a week and then idle.
  return query
  with candidate as (
    select
      id                                        as pid,
      c.last_checked_at                         as checked,
      c.last_status                             as status
    from unnest(coalesce(p_ids, array[]::text[])) as id
    left join public.course_api_checks c on c.provider_id = id
    where c.provider_id is null
       or c.last_checked_at < now() - coalesce(p_max_age, interval '7 days')
    order by c.last_checked_at asc nulls first, id
    limit v_limit
  ),
  claimed as (
    -- Mark them claimed in the SAME statement, so two runs starting together cannot both take the
    -- same ten. A claim is recorded as a check with status 'error' and a note; the monitor
    -- overwrites it with the real result moments later, and a crashed run therefore leaves a claim
    -- that ages out rather than a course that looks permanently fresh.
    insert into public.course_api_checks as t
      (provider_id, last_checked_at, last_status, note, updated_at)
    select pid, now(), 'error', 'claimed, awaiting result', now() from candidate
    on conflict (provider_id) do update
       set last_checked_at = now(),
           last_status     = 'error',
           note            = 'claimed, awaiting result',
           updated_at      = now()
    returning t.provider_id as claimed_id
  )
  select c.pid, c.checked, c.status from candidate c
  where c.pid in (select claimed.claimed_id from claimed);
end;
$function$;

revoke all on function public.claim_course_api_checks(text[], integer, interval) from public;
revoke all on function public.claim_course_api_checks(text[], integer, interval) from anon, authenticated;
grant execute on function public.claim_course_api_checks(text[], integer, interval) to service_role;

select public.record_migration('0156_course_api_checks');

commit;
