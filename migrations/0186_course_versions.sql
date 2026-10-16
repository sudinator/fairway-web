-- 0186_course_versions.sql
--
-- Course history and restore (207.0). Every change to a shared course's CONTENT — data, name,
-- facility, location, provider link — is recorded as a version, in the same transaction as the
-- change, by a trigger on favorite_courses. A trigger, not per-path calls, because eight paths write
-- course data today (three directly from the browser) and any future path must be covered without
-- anyone remembering to.
--
--   * Source and reason: functions that know WHY set the transaction-local setting bnn.course_change
--     (member_correction, provider_update, restore); otherwise a new course is 'created' and an
--     update is a 'manual_edit' by the signed-in person. Flag-only updates (vetted, deleted) and
--     club-specific overrides (group_course_overrides) are not course versions.
--   * Starting snapshot: every existing course gets version 1 'initial' — earlier history is
--     labelled unavailable, not invented.
--   * restore_course_version(course, version, reason): SITE ADMINS ONLY (a shared course affects
--     every club using it); a reason is required; the restore is a NEW version (history is never
--     erased). Restoring changes the course, so any pending provider approval made against the old
--     data is refused by the 0183 fingerprint check ("re-check it before applying").
--   * Rounds and games keep their own snapshots of the course; nothing here recalculates history.
--
-- AUTHORIZATION:
--   * course_versions: RLS on; readable where the course itself is readable; no app-role writes
--     (the trigger is SECURITY DEFINER).
--   * restore_course_version: SECURITY DEFINER; authenticated; is_admin() only.
--   * review_course_correction / apply_course_freshness: unchanged gates; each now tags its change.
--
-- Idempotent; safe to re-run.

begin;

create table if not exists public.course_versions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.favorite_courses(id) on delete cascade,
  version integer not null,
  data jsonb,
  name text,
  facility text,
  location text,
  external_id text,
  source text not null check (source in ('initial','created','manual_edit','member_correction','provider_update','restore')),
  actor uuid references auth.users(id) on delete set null,
  reason text,
  ref text,
  created_at timestamptz not null default now(),
  unique (course_id, version)
);
create index if not exists course_versions_course_idx on public.course_versions(course_id, version desc);
alter table public.course_versions enable row level security;
drop policy if exists course_versions_read on public.course_versions;
create policy course_versions_read on public.course_versions for select
  using (exists (select 1 from public.favorite_courses fc where fc.id = course_versions.course_id));
revoke all on public.course_versions from anon, authenticated;
grant select on public.course_versions to authenticated;

create or replace function public.record_course_version()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ctx jsonb; v_next integer;
begin
  if tg_op = 'UPDATE'
     and new.data is not distinct from old.data and new.name is not distinct from old.name
     and new.facility is not distinct from old.facility and new.location is not distinct from old.location
     and new.external_id is not distinct from old.external_id then
    return new;   -- flag-only change (vetted, deleted, group): not a course version
  end if;
  begin v_ctx := nullif(current_setting('bnn.course_change', true), '')::jsonb; exception when others then v_ctx := null; end;
  -- The tag labels THIS change only — consumed here so a later write in the same transaction is not
  -- mislabelled (found by the assertion: a manual edit after a restore inherited 'restore').
  perform set_config('bnn.course_change', '', true);
  select coalesce(max(version), 0) + 1 into v_next from course_versions where course_id = new.id;
  insert into course_versions(course_id, version, data, name, facility, location, external_id, source, actor, reason, ref)
  values (new.id, v_next, new.data, new.name, new.facility, new.location, new.external_id,
          coalesce(v_ctx->>'source', case when tg_op = 'INSERT' then 'created' else 'manual_edit' end),
          auth.uid(), v_ctx->>'reason', v_ctx->>'ref');
  return new;
end $$;
revoke all on function public.record_course_version() from public, anon, authenticated;
drop trigger if exists record_course_version on public.favorite_courses;
create trigger record_course_version after insert or update on public.favorite_courses
  for each row execute function public.record_course_version();

-- Starting snapshot for courses that have no history yet.
insert into course_versions(course_id, version, data, name, facility, location, external_id, source, reason)
select fc.id, 1, fc.data, fc.name, fc.facility, fc.location, fc.external_id, 'initial', 'Starting snapshot — earlier history unavailable'
  from favorite_courses fc
 where not exists (select 1 from course_versions v where v.course_id = fc.id);

create or replace function public.restore_course_version(p_course_id uuid, p_version integer, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare v record; c record; v_new integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'only a site admin can restore a shared course' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required to restore a course' using errcode = '22023'; end if;
  select * into c from favorite_courses where id = p_course_id for update;
  if not found then raise exception 'course not found' using errcode = 'P0002'; end if;
  select * into v from course_versions where course_id = p_course_id and version = p_version;
  if not found then raise exception 'no such version of this course' using errcode = 'P0002'; end if;
  if c.data is not distinct from v.data and c.name is not distinct from v.name and c.facility is not distinct from v.facility
     and c.location is not distinct from v.location and c.external_id is not distinct from v.external_id then
    raise exception 'that version is already the current course' using errcode = '55000';
  end if;
  perform set_config('bnn.course_change', jsonb_build_object('source','restore','ref','version '||p_version,'reason',trim(p_reason))::text, true);
  update favorite_courses set data = v.data, name = v.name, facility = v.facility, location = v.location, external_id = v.external_id
   where id = p_course_id;
  select max(version) into v_new from course_versions where course_id = p_course_id;
  return v_new;
end $$;
revoke all on function public.restore_course_version(uuid, integer, text) from public, anon;
grant execute on function public.restore_course_version(uuid, integer, text) to authenticated;

create or replace function public.review_course_correction(
  p_request uuid,
  p_action text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_req course_change_requests%rowtype;
  v_proposed jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.is_admin() then raise exception 'admins only' using errcode='42501'; end if;
  if p_action not in ('approved','group_only','rejected_removed') then
    raise exception 'invalid review action' using errcode='22023';
  end if;

  select * into v_req from course_change_requests where id=p_request for update;
  if not found then raise exception 'course change request not found' using errcode='P0002'; end if;
  if v_req.status <> 'pending' then raise exception 'course change request already reviewed' using errcode='23514'; end if;

  if p_action='approved' then
    -- 0186: tag the course change so its history entry names the source and the request.
    perform set_config('bnn.course_change', jsonb_build_object('source','member_correction','ref',p_request::text,
      'reason', 'Member correction approved')::text, true);
    v_proposed := coalesce(v_req.proposed_data,'{}'::jsonb) || jsonb_build_object(
      'name', v_req.proposed_name,
      'location', coalesce(v_req.proposed_location,''),
      'corrected', true
    );
    update favorite_courses set
      name=v_req.proposed_name,
      location=coalesce(v_req.proposed_location,''),
      data=v_proposed,
      vetted=true
    where id=v_req.course_id;
    if not found then raise exception 'course not found' using errcode='P0002'; end if;

    delete from group_course_overrides
     where group_id=v_req.group_id and course_id=v_req.course_id;
  elsif p_action='rejected_removed' then
    delete from group_course_overrides
     where group_id=v_req.group_id and course_id=v_req.course_id;
  end if;

  update course_change_requests set
    status=p_action,
    reviewed_by=auth.uid(),
    reviewed_at=now()
  where id=v_req.id;
end $$;
revoke all on function public.review_course_correction(uuid,text) from public;
revoke all on function public.review_course_correction(uuid,text) from anon;
grant execute on function public.review_course_correction(uuid,text) to authenticated;

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
  -- 0186: tag the change for its history entry.
  perform set_config('bnn.course_change', jsonb_build_object('source','provider_update','ref','revision '||f.revision,
    'reason', 'Provider update approved')::text, true);
  update favorite_courses set data = f.api_data where id = p_course_id;
  update course_freshness set status = 'applied', updated_at = now() where course_id = p_course_id;
  return jsonb_build_object('applied', true, 'revision', f.revision);
end $$;
revoke all on function public.apply_course_freshness(uuid, bigint) from public, anon;
grant execute on function public.apply_course_freshness(uuid, bigint) to authenticated;

select public.record_migration('0186_course_versions');

commit;
