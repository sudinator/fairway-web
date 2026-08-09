-- 0131_workflow_retry_and_review_atomicity.sql
-- Follow-up to 0130 after fault-injection review:
--   * repeated/retried course-correction submissions update the existing pending request instead of
--     creating duplicate pending approvals;
--   * admin review of a correction (approve globally / keep group-only / reject+remove override)
--     is one transaction instead of 2-3 independent browser writes.
--
-- AUTHORIZATION:
--   submit_course_correction(...) — active member of the target group.
--   review_course_correction(...) — application admin only (public.is_admin()).

create or replace function public.submit_course_correction(
  p_group uuid,
  p_course uuid,
  p_name text,
  p_location text,
  p_data jsonb,
  p_reason text,
  p_change_summary text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_request uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.is_group_member(p_group, auth.uid()) then raise exception 'active group member required' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_reason,'')), '') is null then raise exception 'reason required' using errcode='22023'; end if;
  if not exists(select 1 from favorite_courses where id=p_course and coalesce(deleted,false)=false) then
    raise exception 'course not found' using errcode='P0002';
  end if;

  -- Serialize retries/near-simultaneous submissions for this course+group without requiring a new
  -- unique index on a table that may already contain historical duplicate rows.
  perform pg_advisory_xact_lock(hashtext(p_group::text || ':' || p_course::text));

  insert into group_courses(group_id,course_id,added_by)
    values(p_group,p_course,auth.uid())
    on conflict(group_id,course_id) do nothing;

  insert into group_course_overrides(group_id,course_id,name,location,data,updated_by,updated_at)
    values(p_group,p_course,p_name,coalesce(p_location,''),p_data,auth.uid(),now())
    on conflict(group_id,course_id) do update set
      name=excluded.name,
      location=excluded.location,
      data=excluded.data,
      updated_by=excluded.updated_by,
      updated_at=now();

  select id into v_request
    from course_change_requests
   where course_id=p_course and group_id=p_group and status='pending'
   order by created_at desc
   limit 1
   for update;

  if v_request is null then
    insert into course_change_requests(
      course_id,group_id,submitted_by,proposed_name,proposed_location,proposed_data,
      reason,change_summary,status
    ) values(
      p_course,p_group,auth.uid(),p_name,coalesce(p_location,''),p_data,
      btrim(p_reason),p_change_summary,'pending'
    ) returning id into v_request;
  else
    update course_change_requests set
      submitted_by=auth.uid(),
      proposed_name=p_name,
      proposed_location=coalesce(p_location,''),
      proposed_data=p_data,
      reason=btrim(p_reason),
      change_summary=p_change_summary
    where id=v_request;
  end if;

  return v_request;
end $$;
revoke all on function public.submit_course_correction(uuid,uuid,text,text,jsonb,text,text) from public;
revoke all on function public.submit_course_correction(uuid,uuid,text,text,jsonb,text,text) from anon;
grant execute on function public.submit_course_correction(uuid,uuid,text,text,jsonb,text,text) to authenticated;

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

select record_migration('0131_workflow_retry_and_review_atomicity');
