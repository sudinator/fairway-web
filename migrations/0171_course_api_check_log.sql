-- 0171_course_api_check_log.sql
--
-- A history of provider attempts per course, so "did it fail, when, and why" has an answer.
--
-- course_api_checks (0156/0164) keeps ONE row per provider id: the last attempt and the last
-- success. That is enough for the monitor's scheduling and for "last verified" on the course view,
-- but an admin asking why a course has not verified for a week needs the attempts in between.
-- course_api_check_log keeps every recorded outcome (ok, drift, error, released claim) with its
-- HTTP status and note, 90 days back, written by the same two functions that write the ledger.
--
-- AUTHORIZATION: the log is denied to app roles like the ledger; admin_course_check_log(provider)
-- is the is_admin()-gated reader. record_course_api_check and release_course_api_claims keep
-- their 0164 gates and simply append.
--
-- Idempotent; safe to re-run.

begin;

create table if not exists public.course_api_check_log (
  id           bigserial primary key,
  provider_id  text not null,
  at           timestamptz not null default now(),
  status       text not null check (status in ('ok', 'drift', 'error')),
  http_status  integer,
  note         text,
  source       text not null default 'monitor'  -- monitor | app
);
create index if not exists course_api_check_log_provider_at on public.course_api_check_log (provider_id, at desc);
alter table public.course_api_check_log enable row level security;
revoke all on table public.course_api_check_log from public, anon, authenticated;
grant select, insert, delete on table public.course_api_check_log to service_role;

create or replace function public.record_course_api_check(
  p_provider_id text,
  p_status      text default 'ok',
  p_club_name   text default null,
  p_course_name text default null,
  p_location    text default null,
  p_note        text default null,
  p_http_status integer default null
) returns void
language plpgsql security definer set search_path = public as $function$
declare v_source text;
begin
  if auth.uid() is null and coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_provider_id is null or length(trim(p_provider_id)) = 0 then
    return;
  end if;
  if p_status is null or p_status not in ('ok', 'drift', 'error') then
    raise exception 'status must be ok, drift or error' using errcode = '22023';
  end if;
  v_source := case when auth.uid() is null then 'monitor' else 'app' end;

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
         last_success_at  = case when excluded.last_status in ('ok', 'drift') then now() else c.last_success_at end,
         last_http_status = excluded.last_http_status,
         club_name        = coalesce(excluded.club_name, c.club_name),
         course_name      = coalesce(excluded.course_name, c.course_name),
         location         = coalesce(excluded.location, c.location),
         note             = excluded.note,
         updated_at       = now();

  insert into public.course_api_check_log (provider_id, status, http_status, note, source)
  values (trim(p_provider_id), p_status, p_http_status, left(p_note, 500), v_source);
  -- 90-day retention, kept per provider so the table never needs a separate sweep.
  delete from public.course_api_check_log where provider_id = trim(p_provider_id) and at < now() - interval '90 days';
end;
$function$;
revoke all on function public.record_course_api_check(text, text, text, text, text, text, integer) from public, anon;
grant execute on function public.record_course_api_check(text, text, text, text, text, text, integer) to authenticated, service_role;

create or replace function public.release_course_api_claims(
  p_ids    text[],
  p_reason text default null
) returns integer
language plpgsql security definer set search_path = public as $function$
declare v_n integer;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  with released as (
    update public.course_api_checks c
       set last_status     = 'error',
           note            = left('not checked: ' || coalesce(nullif(trim(p_reason), ''), 'run aborted'), 500),
           last_checked_at = coalesce(c.last_success_at, c.last_checked_at),
           updated_at      = now()
     where c.provider_id = any(coalesce(p_ids, array[]::text[]))
       and c.last_status = 'claimed'
    returning c.provider_id, c.note
  )
  insert into public.course_api_check_log (provider_id, status, http_status, note, source)
  select provider_id, 'error', null, note, 'monitor' from released;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.release_course_api_claims(text[], text) from public, anon, authenticated;
grant execute on function public.release_course_api_claims(text[], text) to service_role;

create or replace function public.admin_course_check_log(p_provider_id text, p_limit integer default 20)
returns table (at timestamptz, status text, http_status integer, note text, source text)
language sql stable security definer set search_path = public as $$
  select l.at, l.status, l.http_status, l.note, l.source
    from public.course_api_check_log l
   where public.is_admin() and l.provider_id = trim(p_provider_id)
   order by l.at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;
revoke all on function public.admin_course_check_log(text, integer) from public, anon;
grant execute on function public.admin_course_check_log(text, integer) to authenticated;

select public.record_migration('0171_course_api_check_log');

commit;
