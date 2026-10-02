-- 0164_course_api_check_outcomes.sql
--
-- A claim is not a check. A failed check is not a verification.
--
-- WHAT WENT WRONG (production, 2026-09-28 to 2026-10-01): four monitor runs claimed their batch and
-- then died before recording a result — the claim placeholder ('error', 'claimed, awaiting result')
-- was left in place for 17 of the 18 golden courses. claim_course_api_checks (0156) decided what was
-- due from last_checked_at ALONE and never looked at last_status, so every one of those placeholders
-- counted as "verified within the last 7 days". The next scheduled run printed
--   "Nothing due: all 18 fixtures were verified within the last 7 days."
-- and went green. Reproduced against a real Postgres: claim three ids, record nothing, claim again
-- -> 0 due. The ledger was reporting an error state as a refresh.
--
-- THE FIX, in three parts:
--   1. 'claimed' is its own status. A placeholder can never be mistaken for a result.
--   2. last_success_at records when the provider last ANSWERED for the course (status ok or drift —
--      drift is a successful fetch whose content disagrees with the fixture). Freshness is decided
--      from last_success_at. A row whose last attempt failed is due again at the next run, queued
--      BEHIND courses that have not been attempted recently, so one permanently broken id cannot
--      starve the rest. last_http_status keeps the provider's actual answer.
--   3. release_course_api_claims hands back courses a run claimed but never reached, so an aborted
--      run (daily quota, rejected key, outage) does not park five courses for a week.
--
-- The app's /api/courses route and the monitor both call record_course_api_check; the function
-- gains an optional p_http_status and sets last_success_at itself, so neither caller computes
-- freshness. The 6-argument overload is DROPPED rather than left beside the new one: PostgREST
-- rejects a call that matches two overloads (PGRST203), and both callers pass named arguments that
-- would match both.
--
-- course_api_status is the one READ path for clients. The table stays service-role only (0156); the
-- function returns operational timestamps and statuses for the provider ids it is given, which is
-- what the course view needs to say "last verified against the API on <date>". It holds no user
-- data, but it is still gated on a signed-in caller because the table it reads is otherwise denied.
--
-- AUTHORIZATION:
--   * record_course_api_check: unchanged in character from 0157. Callers are the app as a signed-in
--     user (auth.uid() present) or the monitor as service_role (current_setting('role')). It may
--     not write status 'claimed' — only the claim path does that.
--   * claim_course_api_checks and release_course_api_claims: SECURITY DEFINER, service_role ONLY.
--     Never called from the client.
--   * course_api_status: SECURITY DEFINER, read-only, granted to authenticated, requires auth.uid().
--     It reads only course_api_checks, for the ids supplied (capped at 200), and returns nothing
--     user-scoped. Table privileges for anon/authenticated remain revoked.
--
-- Idempotent; safe to re-run.

begin;

alter table public.course_api_checks add column if not exists last_success_at  timestamptz;
alter table public.course_api_checks add column if not exists last_http_status integer;

alter table public.course_api_checks drop constraint if exists course_api_checks_status_chk;
alter table public.course_api_checks
  add constraint course_api_checks_status_chk
  check (last_status in ('ok', 'drift', 'error', 'claimed'));

-- Backfill. Anything that resolved before this migration has a success time; a stranded placeholder
-- becomes a visible 'claimed' and will be re-queued by the next run. Idempotent: both predicates are
-- false after the first application.
update public.course_api_checks
   set last_success_at = last_checked_at
 where last_success_at is null and last_status in ('ok', 'drift');
update public.course_api_checks
   set last_status = 'claimed'
 where last_status = 'error' and note = 'claimed, awaiting result';

create index if not exists course_api_checks_success_idx
  on public.course_api_checks (last_success_at asc nulls first);

comment on column public.course_api_checks.last_success_at is
  'When the provider last answered for this course (status ok or drift). Freshness and the course '
  'view''s "last verified" date come from here, never from last_checked_at (0164).';
comment on column public.course_api_checks.last_http_status is
  'HTTP status of the last attempt as the provider returned it; null for a claim or a non-HTTP '
  'failure such as a timeout (0164).';

-- ── Record a result ──────────────────────────────────────────────────────────────────────────────
drop function if exists public.record_course_api_check(text, text, text, text, text, text);

create or replace function public.record_course_api_check(
  p_provider_id text,
  p_status      text default 'ok',
  p_club_name   text default null,
  p_course_name text default null,
  p_location    text default null,
  p_note        text default null,
  p_http_status integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- current_user is the OWNER inside a definer function, never the caller; the caller's role arrives
  -- in current_setting('role'), set by PostgREST from the key's JWT (0157).
  if auth.uid() is null and coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_provider_id is null or length(trim(p_provider_id)) = 0 then
    return;
  end if;
  -- 'claimed' is written by the claim path only. A caller that could record a claim could park a
  -- course without ever checking it.
  if p_status is null or p_status not in ('ok', 'drift', 'error') then
    raise exception 'status must be ok, drift or error' using errcode = '22023';
  end if;

  insert into public.course_api_checks as c
    (provider_id, last_checked_at, last_status, last_success_at, last_http_status,
     club_name, course_name, location, note, updated_at)
  values
    (trim(p_provider_id), now(), p_status,
     case when p_status in ('ok', 'drift') then now() end,
     p_http_status, p_club_name, p_course_name, p_location, p_note, now())
  on conflict (provider_id) do update
     set last_checked_at  = now(),
         last_status      = excluded.last_status,
         -- A failure never moves the success time; only an answer from the provider does.
         last_success_at  = case when excluded.last_status in ('ok', 'drift') then now()
                                 else c.last_success_at end,
         last_http_status = excluded.last_http_status,
         -- Keep the last KNOWN values when a caller does not supply them: a failed lookup should not
         -- erase what the course looked like the last time it resolved.
         club_name        = coalesce(excluded.club_name, c.club_name),
         course_name      = coalesce(excluded.course_name, c.course_name),
         location         = coalesce(excluded.location, c.location),
         note             = excluded.note,
         updated_at       = now();
end;
$function$;

revoke all on function public.record_course_api_check(text, text, text, text, text, text, integer) from public;
revoke all on function public.record_course_api_check(text, text, text, text, text, text, integer) from anon;
grant execute on function public.record_course_api_check(text, text, text, text, text, text, integer) to authenticated, service_role;

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
  v_age   interval := coalesce(p_max_age, interval '7 days');
begin
  -- Transaction-scoped advisory lock: two runs starting together must not take the same batch
  -- (measured overlap without it was 10 of 10, 0156).
  perform pg_advisory_xact_lock(hashtext('course_api_checks.claim'));

  return query
  with candidate as (
    select
      id                as pid,
      c.last_checked_at as checked,
      c.last_status     as status
    from unnest(coalesce(p_ids, array[]::text[])) as id
    left join public.course_api_checks c on c.provider_id = id
    where
      -- Due: never answered, or the last ANSWER is older than the window. A failed attempt inside
      -- the window does not count — that is the whole bug this migration fixes.
      (c.provider_id is null or c.last_success_at is null or c.last_success_at < now() - v_age)
      -- Not due: a claim that is plausibly still in flight. A second run started within half an
      -- hour of the first (a manual dispatch beside the schedule) must not double the day's spend
      -- on the same courses. A claim older than that belongs to a run that is dead.
      -- Written with coalesce: for an id with NO row every column is null, and `not (null)` is null,
      -- which the WHERE clause treats as false — the never-seen course would silently never be due.
      -- Caught by the assertion file on first execution, not by reading.
      and not coalesce(c.last_status = 'claimed' and c.last_checked_at > now() - interval '30 minutes', false)
    -- Least recently ATTEMPTED first. Courses that failed today sit behind courses nobody has
    -- touched, so a persistently broken id is retried daily but never starves the rest.
    order by c.last_checked_at asc nulls first, id
    limit v_limit
  ),
  claimed as (
    insert into public.course_api_checks as t
      (provider_id, last_checked_at, last_status, last_http_status, note, updated_at)
    select pid, now(), 'claimed', null, 'claimed, awaiting result', now() from candidate
    on conflict (provider_id) do update
       set last_checked_at  = now(),
           last_status      = 'claimed',
           last_http_status = null,
           note             = 'claimed, awaiting result',
           updated_at       = now()
    returning t.provider_id as claimed_id
  )
  select c.pid, c.checked, c.status from candidate c
  where c.pid in (select claimed.claimed_id from claimed);
end;
$function$;

revoke all on function public.claim_course_api_checks(text[], integer, interval) from public;
revoke all on function public.claim_course_api_checks(text[], integer, interval) from anon, authenticated;
grant execute on function public.claim_course_api_checks(text[], integer, interval) to service_role;

-- ── An aborted run hands back what it never reached ──────────────────────────────────────────────
-- Only rows still marked 'claimed' are touched: a course that was checked and recorded before the
-- run died keeps its real result. Released rows read as 'error' with the reason, and last_checked_at
-- is wound back to the last success so the course keeps its place in the queue rather than being
-- pushed behind courses that were never attempted. A course that has never succeeded keeps the
-- claim time: it has nothing to wind back to, and the next run picks it up with the rest.
create or replace function public.release_course_api_claims(
  p_ids    text[],
  p_reason text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_n integer;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.course_api_checks c
     set last_status     = 'error',
         note            = left('not checked: ' || coalesce(nullif(trim(p_reason), ''), 'run aborted'), 500),
         last_checked_at = coalesce(c.last_success_at, c.last_checked_at),
         updated_at      = now()
   where c.provider_id = any(coalesce(p_ids, array[]::text[]))
     and c.last_status = 'claimed';
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.release_course_api_claims(text[], text) from public;
revoke all on function public.release_course_api_claims(text[], text) from anon, authenticated;
grant execute on function public.release_course_api_claims(text[], text) to service_role;

-- ── The one read path for clients ────────────────────────────────────────────────────────────────
create or replace function public.course_api_status(p_provider_ids text[])
returns table (
  provider_id      text,
  last_success_at  timestamptz,
  last_checked_at  timestamptz,
  last_status      text,
  last_http_status integer,
  note             text
)
language sql
security definer
stable
set search_path = public
as $function$
  select c.provider_id, c.last_success_at, c.last_checked_at, c.last_status, c.last_http_status, c.note
    from public.course_api_checks c
   where auth.uid() is not null
     and c.provider_id in (
           select u.x from unnest(coalesce(p_provider_ids, array[]::text[])) with ordinality as u(x, n) where u.n <= 200
         );
$function$;

revoke all on function public.course_api_status(text[]) from public;
revoke all on function public.course_api_status(text[]) from anon;
grant execute on function public.course_api_status(text[]) to authenticated;

select public.record_migration('0164_course_api_check_outcomes');

commit;
