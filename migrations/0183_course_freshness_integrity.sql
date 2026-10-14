-- 0183_course_freshness_integrity.sql
--
-- External review (Oct 13), findings 1, 2 and 6 — course freshness:
--
--   1. "API data" could be supplied by an ordinary member. record_course_freshness accepted the
--      provider payload and the comparison from the BROWSER; a club admin's approval then wrote that
--      payload into the shared course. The browser entry point is REMOVED. Checks are now recorded
--      only by the server (/api/courses/freshness), which fetches the provider itself with the
--      server's key, validates and compares, and records through record_course_freshness_checked —
--      service role only, with the signed-in member it acted for verified inside.
--   2. Approval was not tied to what was reviewed. apply_course_freshness took only a course id and
--      applied whatever was cached at that moment — including an already-applied snapshot over a
--      newer hand correction. Every recorded check now has a REVISION and a fingerprint of the course
--      as it stood (base_hash = md5 of the course data). Approval names the revision and applies only
--      if the review is still pending, the revision is the current one, the check was complete, and
--      the course is unchanged since — under a row lock, in one transaction. Otherwise it refuses and
--      asks for a re-check.
--   6. Distinguishable outcomes: course_freshness.check_state records 'ok' or 'incomplete' (the
--      provider answered but the course was missing tees, pars, stroke indexes, ratings or slopes —
--      such a check never carries an applicable payload).
--
-- A trigger keeps revision and base_hash correct for EVERY writer (the server route and the
-- scheduled monitor's record_course_freshness_system alike): a newly recorded check (insert, or
-- checked_at moving) bumps the revision and re-fingerprints the course; status-only updates
-- (dismiss, apply) leave both alone.
--
-- AUTHORIZATION:
--   * record_course_freshness_checked: SECURITY DEFINER; service_role only; p_actor must be an
--     active member of a club that owns the course (verified here, not trusted from the caller).
--   * apply_course_freshness(uuid, bigint): SECURITY DEFINER; authenticated; site admin or an admin
--     of an owning club (unchanged rule).
--   * pending_course_reviews: unchanged gate; now returns revision and check_state.
--
-- Idempotent; safe to re-run.

begin;

alter table public.course_freshness add column if not exists revision bigint not null default 0;
alter table public.course_freshness add column if not exists base_hash text;
alter table public.course_freshness add column if not exists check_state text not null default 'ok';

create or replace function public.course_freshness_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.checked_at is distinct from old.checked_at then
    new.revision := coalesce(case when tg_op = 'UPDATE' then old.revision end, 0) + 1;
    new.base_hash := (select md5(coalesce(data::text, '')) from favorite_courses where id = new.course_id);
  end if;
  return new;
end $$;
revoke all on function public.course_freshness_revision() from public, anon, authenticated;
drop trigger if exists course_freshness_revision on public.course_freshness;
create trigger course_freshness_revision before insert or update on public.course_freshness
  for each row execute function public.course_freshness_revision();

-- 1. The browser can no longer record provider data.
drop function if exists public.record_course_freshness(uuid, jsonb, jsonb, boolean);

create or replace function public.record_course_freshness_checked(
  p_course_id uuid, p_actor uuid, p_api_data jsonb, p_diff jsonb, p_has_changes boolean, p_check_state text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_check_state not in ('ok', 'incomplete') then
    raise exception 'unknown check state' using errcode = '22023';
  end if;
  if not exists (select 1 from favorite_courses where id = p_course_id and coalesce(deleted, false) = false) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if not (exists (select 1 from profiles where id = p_actor and is_admin)
          or exists (select 1 from public.course_owner_groups(p_course_id) g
                       join group_members gm on gm.group_id = g and gm.user_id = p_actor and gm.status = 'active')) then
    raise exception 'not an active member of this course''s club' using errcode = '42501';
  end if;
  if p_check_state = 'incomplete' then
    -- Record that the provider answered incompletely; never keep an applicable payload.
    perform public.record_course_freshness_internal(p_course_id, null, p_diff, false);
  else
    perform public.record_course_freshness_internal(p_course_id, p_api_data, p_diff, p_has_changes);
  end if;
  -- Every server-recorded check is a NEW revision fingerprinting the course as it stands now —
  -- explicitly, not via checked_at (which does not move within one transaction).
  update course_freshness
     set check_state = p_check_state,
         revision = revision + 1,
         base_hash = (select md5(coalesce(data::text, '')) from favorite_courses where id = p_course_id)
   where course_id = p_course_id;
  select revision, status, has_changes, check_state, checked_at into r from course_freshness where course_id = p_course_id;
  return jsonb_build_object('saved', r.revision is not null, 'revision', r.revision, 'status', r.status,
                            'has_changes', r.has_changes, 'check_state', r.check_state, 'checked_at', r.checked_at);
end $$;
revoke all on function public.record_course_freshness_checked(uuid, uuid, jsonb, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.record_course_freshness_checked(uuid, uuid, jsonb, jsonb, boolean, text) to service_role;

-- 2. Approve an exact revision of an unchanged course.
drop function if exists public.apply_course_freshness(uuid);
create or replace function public.apply_course_freshness(p_course_id uuid, p_revision bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f record; v_now text;
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
  if not found or f.api_data is null then
    raise exception 'no provider data recorded for this course' using errcode = 'P0002';
  end if;
  if f.status <> 'pending' then
    raise exception 'this update is not pending review (it is %) — re-check the course', f.status using errcode = '55000';
  end if;
  if f.revision is distinct from p_revision then
    raise exception 'the course was re-checked since you reviewed it — review the latest changes' using errcode = '40001';
  end if;
  if f.check_state <> 'ok' then
    raise exception 'the provider''s data was incomplete — nothing to apply' using errcode = '55000';
  end if;
  select md5(coalesce(data::text, '')) into v_now from favorite_courses where id = p_course_id for update;
  if v_now is distinct from f.base_hash then
    raise exception 'the course was edited after this check — re-check it before applying' using errcode = '40001';
  end if;
  update favorite_courses set data = f.api_data where id = p_course_id;
  update course_freshness set status = 'applied', updated_at = now() where course_id = p_course_id;
  return jsonb_build_object('applied', true, 'revision', f.revision);
end $$;
revoke all on function public.apply_course_freshness(uuid, bigint) from public, anon;
grant execute on function public.apply_course_freshness(uuid, bigint) to authenticated;

drop function if exists public.pending_course_reviews();
create or replace function public.pending_course_reviews()
returns table (course_id uuid, course_name text, club_name text, group_id uuid, provider_id text, checked_at timestamptz,
               diff jsonb, api_data jsonb, corrected boolean, revision bigint, check_state text)
language sql stable security definer set search_path = public as $$
  select fc.id, fc.name,
         coalesce((select string_agg(g.name, ', ' order by g.name) from public.course_owner_groups(fc.id) og join groups g on g.id = og), 'No club'),
         (select og from public.course_owner_groups(fc.id) og limit 1),
         fc.external_id, cf.checked_at, cf.diff, cf.api_data,
         coalesce((fc.data->>'corrected')::boolean, false),
         cf.revision, cf.check_state
    from course_freshness cf
    join favorite_courses fc on fc.id = cf.course_id and coalesce(fc.deleted, false) = false
   where auth.uid() is not null
     and cf.status = 'pending' and cf.has_changes and cf.check_state = 'ok'
     and cf.api_data is not null
     and (public.is_admin()
          or exists (select 1 from public.course_owner_groups(fc.id) g where public.is_group_admin(g, auth.uid())))
   order by cf.checked_at desc, fc.name;
$$;
revoke all on function public.pending_course_reviews() from public, anon;
grant execute on function public.pending_course_reviews() to authenticated;

select public.record_migration('0183_course_freshness_integrity');

commit;
