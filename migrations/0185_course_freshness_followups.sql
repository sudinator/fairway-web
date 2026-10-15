-- 0185_course_freshness_followups.sql
--
-- Follow-ups to 0183 (external review, second pass, Oct 13):
--
--   1. The SCHEDULED monthly check (ci/external/course-freshness-sync.mjs → record_course_freshness_system)
--      did not apply the completeness validation the app's check uses, so an incomplete provider
--      response could become an approvable update. record_course_freshness_system now takes a check
--      state; 'incomplete' records the outcome with NO applicable payload (as the app's path does).
--   2. A hand correction made WHILE a check was running: the check compared against the course as
--      it was read, but was recorded (and fingerprinted) against the corrected course — so the review
--      could omit a field that approval would then overwrite. Both recorders now take the course data
--      the comparison was made against (p_base_data) and record only if the course still matches;
--      otherwise the server path refuses ("re-run the check") and the scheduled path skips that
--      course (counted) for the next run.
--      The same base match also fixes a scheduled-path flaw found alongside: with two library courses
--      sharing a provider id, one course's comparison was recorded against every course with that id.
--
-- AUTHORIZATION: unchanged — both recorders are SECURITY DEFINER, service_role only;
-- record_course_freshness_checked still verifies the member it acts for.
--
-- Idempotent; safe to re-run.

begin;

drop function if exists public.record_course_freshness_system(text, jsonb, jsonb, boolean);
create or replace function public.record_course_freshness_system(
  p_provider_id text, p_api_data jsonb, p_diff jsonb, p_has_changes boolean, p_base_data jsonb, p_check_state text
) returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_check_state not in ('ok', 'incomplete') then raise exception 'unknown check state' using errcode = '22023'; end if;
  -- Only courses that still hold exactly the data the comparison was made against.
  for r in select id from favorite_courses
            where external_id = trim(p_provider_id) and coalesce(deleted, false) = false
              and data is not distinct from p_base_data
            for update loop
    if p_check_state = 'incomplete' then
      perform public.record_course_freshness_internal(r.id, null, p_diff, false);
    else
      perform public.record_course_freshness_internal(r.id, p_api_data, p_diff, p_has_changes);
    end if;
    update course_freshness
       set check_state = p_check_state, revision = revision + 1,
           base_hash = (select md5(coalesce(data::text, '')) from favorite_courses where id = r.id)
     where course_id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.record_course_freshness_system(text, jsonb, jsonb, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_course_freshness_system(text, jsonb, jsonb, boolean, jsonb, text) to service_role;

drop function if exists public.record_course_freshness_checked(uuid, uuid, jsonb, jsonb, boolean, text);
create or replace function public.record_course_freshness_checked(
  p_course_id uuid, p_actor uuid, p_api_data jsonb, p_diff jsonb, p_has_changes boolean, p_check_state text, p_base_data jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_data jsonb;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_check_state not in ('ok', 'incomplete') then
    raise exception 'unknown check state' using errcode = '22023';
  end if;
  select data into v_data from favorite_courses where id = p_course_id and coalesce(deleted, false) = false for update;
  if not found then raise exception 'course not found' using errcode = 'P0002'; end if;
  if not (exists (select 1 from profiles where id = p_actor and is_admin)
          or exists (select 1 from public.course_owner_groups(p_course_id) g
                       join group_members gm on gm.group_id = g and gm.user_id = p_actor and gm.status = 'active')) then
    raise exception 'not an active member of this course''s club' using errcode = '42501';
  end if;
  -- The course must still be what the comparison was made against.
  if v_data is distinct from p_base_data then
    raise exception 'the course changed while it was being checked — run the check again' using errcode = '40001';
  end if;
  if p_check_state = 'incomplete' then
    perform public.record_course_freshness_internal(p_course_id, null, p_diff, false);
  else
    perform public.record_course_freshness_internal(p_course_id, p_api_data, p_diff, p_has_changes);
  end if;
  update course_freshness
     set check_state = p_check_state, revision = revision + 1, base_hash = md5(coalesce(v_data::text, ''))
   where course_id = p_course_id;
  select revision, status, has_changes, check_state, checked_at into r from course_freshness where course_id = p_course_id;
  return jsonb_build_object('saved', r.revision is not null, 'revision', r.revision, 'status', r.status,
                            'has_changes', r.has_changes, 'check_state', r.check_state, 'checked_at', r.checked_at);
end $$;
revoke all on function public.record_course_freshness_checked(uuid, uuid, jsonb, jsonb, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_course_freshness_checked(uuid, uuid, jsonb, jsonb, boolean, text, jsonb) to service_role;

select public.record_migration('0185_course_freshness_followups');

commit;
