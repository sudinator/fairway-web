-- 0187_course_status_view.sql
--
-- Admin → Courses redesign (207.1): each course row says what data is in use, whether anything is
-- wrong, and what to do next — with failures and pending reviews shown side by side.
--
--   * course_freshness.last_compared_at: when a COMPLETE provider response was last compared with the
--     stored data. checked_at is the last check of any outcome; an incomplete or failed check no longer
--     hides when the course was last genuinely verified. Maintained by trigger for every recorder.
--   * Attempt log: a new outcome 'incomplete' (provider answered, data unusable). The in-app freshness
--     route records an attempt again — since 206.0 it fetched the provider directly and left no attempt
--     record, so "last check" only reflected the monthly monitor (a 206.0 regression, fixed here).
--   * dismiss_course_freshness(course, revision, reason?): "Keep current data" for the revision the
--     admin reviewed, with an optional reason, recorded with who and when. Replaces
--     set_course_freshness_status, which also accepted 'applied' — marking a course updated without
--     applying anything (nothing called it that way; the option is gone).
--   * admin_course_status: adds the current version (when, by whom, from where — 0186), the last
--     complete comparison, the check state, the revision under review, the keep decision, and the FULL
--     change count (added/removed tees and hole par/stroke-index changes were counted as 0).
--
-- AUTHORIZATION: admin_course_status unchanged (is_admin()). dismiss_course_freshness: SECURITY
-- DEFINER, authenticated, site admin or an admin of an owning club (the rule set_course_freshness_status
-- had). record_course_api_check unchanged gate.
--
-- Idempotent; safe to re-run.

begin;

alter table public.course_freshness add column if not exists last_compared_at timestamptz;
alter table public.course_freshness add column if not exists decision_reason text;
alter table public.course_freshness add column if not exists decided_by uuid references auth.users(id) on delete set null;
alter table public.course_freshness add column if not exists decided_at timestamptz;
update public.course_freshness set last_compared_at = checked_at where last_compared_at is null and check_state = 'ok' and api_data is not null;

create or replace function public.course_freshness_compared()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A new revision recorded as a complete comparison: this is the latest genuine verification.
  if new.check_state = 'ok' and (tg_op = 'INSERT' or new.revision is distinct from old.revision) then
    new.last_compared_at := now();
  end if;
  return new;
end $$;
revoke all on function public.course_freshness_compared() from public, anon, authenticated;
drop trigger if exists course_freshness_compared on public.course_freshness;
create trigger course_freshness_compared before insert or update on public.course_freshness
  for each row execute function public.course_freshness_compared();

alter table public.course_api_check_log drop constraint if exists course_api_check_log_status_check;
alter table public.course_api_check_log add constraint course_api_check_log_status_check check (status in ('ok', 'drift', 'error', 'incomplete'));
alter table public.course_api_checks drop constraint if exists course_api_checks_status_chk;
alter table public.course_api_checks add constraint course_api_checks_status_chk check (last_status in ('ok', 'drift', 'error', 'claimed', 'incomplete'));

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
  if p_status is null or p_status not in ('ok', 'drift', 'error', 'incomplete') then
    raise exception 'status must be ok, drift, error or incomplete' using errcode = '22023';
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

drop function if exists public.set_course_freshness_status(uuid, text);
create or replace function public.dismiss_course_freshness(p_course_id uuid, p_revision bigint, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from favorite_courses where id = p_course_id and coalesce(deleted, false) = false) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or exists (
        select 1 from public.course_owner_groups(p_course_id) g where public.is_group_admin(g, auth.uid()))) then
    raise exception 'club admin required' using errcode = '42501';
  end if;
  select * into f from course_freshness where course_id = p_course_id for update;
  if not found or f.status <> 'pending' then raise exception 'there is no update awaiting review' using errcode = '55000'; end if;
  if f.revision is distinct from p_revision then
    raise exception 'the course was re-checked since you reviewed it — review the latest changes' using errcode = '40001';
  end if;
  update course_freshness
     set status = 'dismissed', decision_reason = nullif(trim(coalesce(p_reason, '')), ''), decided_by = auth.uid(), decided_at = now(), updated_at = now()
   where course_id = p_course_id;
end $$;
revoke all on function public.dismiss_course_freshness(uuid, bigint, text) from public, anon;
grant execute on function public.dismiss_course_freshness(uuid, bigint, text) to authenticated;

drop function if exists public.admin_course_status();
create or replace function public.admin_course_status()
returns table (
  course_id uuid, course_name text, clubs text, provider_id text, corrected boolean,
  last_verified_at timestamptz, last_check_at timestamptz, last_check_status text, last_check_note text,
  freshness_checked_at timestamptz, freshness_status text, freshness_changes integer,
  pending_requests integer, oldest_request_at timestamptz,
  -- 207.1
  last_compared_at timestamptz, freshness_check_state text, freshness_revision bigint,
  decision_reason text, decided_at timestamptz,
  current_version integer, current_version_at timestamptz, current_version_source text, current_version_by text
)
language sql stable security definer set search_path = public as $$
  select fc.id, fc.name,
         coalesce((select string_agg(g.name, ', ' order by g.name) from public.course_owner_groups(fc.id) og join groups g on g.id = og), 'No club'),
         fc.external_id,
         coalesce((fc.data->>'corrected')::boolean, false),
         c.last_success_at, c.last_checked_at, c.last_status, c.note,
         cf.checked_at, cf.status,
         -- Every kind of change the comparison detects (206.0): tee values, tees added/removed, holes.
         ((select coalesce(sum(case when (t->>'ratingChanged')::boolean then 1 else 0 end
                              + case when (t->>'slopeChanged')::boolean then 1 else 0 end
                              + jsonb_array_length(coalesce(t->'yardageChanges', '[]'::jsonb))), 0)
             from jsonb_array_elements(coalesce(cf.diff->'tees', '[]'::jsonb)) t)
          + jsonb_array_length(coalesce(cf.diff->'teesAdded', '[]'::jsonb))
          + jsonb_array_length(coalesce(cf.diff->'teesRemoved', '[]'::jsonb))
          + jsonb_array_length(coalesce(cf.diff->'holeChanges', '[]'::jsonb)))::integer,
         (select count(*)::integer from course_change_requests r where r.course_id = fc.id and r.status = 'pending'),
         (select min(r.created_at) from course_change_requests r where r.course_id = fc.id and r.status = 'pending'),
         cf.last_compared_at, cf.check_state, cf.revision, cf.decision_reason, cf.decided_at,
         v.version, v.created_at, v.source, p.display_name
    from favorite_courses fc
    left join course_api_checks c on c.provider_id = fc.external_id
    left join course_freshness cf on cf.course_id = fc.id
    left join lateral (select version, created_at, source, actor from course_versions cv where cv.course_id = fc.id order by version desc limit 1) v on true
    left join profiles p on p.id = v.actor
   where public.is_admin()
     and coalesce(fc.deleted, false) = false
   order by fc.name;
$$;
revoke all on function public.admin_course_status() from public, anon;
grant execute on function public.admin_course_status() to authenticated;

select public.record_migration('0187_course_status_view');

commit;
