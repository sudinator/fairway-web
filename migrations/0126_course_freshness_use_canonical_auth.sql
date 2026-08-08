-- 0126_course_freshness_use_canonical_auth.sql
-- Follow-up security review (Aug 2026): 0125 hand-rolled its membership/admin checks with inline
-- group_members queries that filtered user_id + role but NOT status. Because removed members keep a
-- group_members row with status='removed' (the app updates status, it does not delete the row), a
-- removed member could still call record_course_freshness, and a removed admin could still call
-- set_course_freshness_status and receive change notifications. FIX: delegate to the canonical
-- helpers is_group_member() / is_group_admin() (0034), which enforce status='active' AND not-banned,
-- and add the same filter (+ banned exclusion) to the admin-notification recipient query. This also
-- inherits ban protection automatically. Supersedes 0125's function bodies; run after 0125.
--
-- AUTHORIZATION: record_course_freshness(course_id, api_data, diff, has_changes) — callable only by
-- is_group_member(owning_group, auth.uid()) (active, non-banned member; group derived server-side from
-- favorite_courses). set_course_freshness_status(course_id, status) — callable only by
-- is_group_admin(owning_group, auth.uid()) (active, non-banned admin); status restricted to
-- pending|dismissed|applied. Notifications go only to active, non-banned admins of the owning group.

create or replace function public.record_course_freshness(
  p_course_id uuid, p_api_data jsonb, p_diff jsonb, p_has_changes boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  was_changed boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select group_id into v_group
  from favorite_courses
  where id = p_course_id and coalesce(deleted, false) = false;
  if v_group is null then
    raise exception 'course not found' using errcode = 'P0002';
  end if;

  -- Canonical membership check: active, non-banned member of the owning group.
  if not public.is_group_member(v_group, auth.uid()) then
    raise exception 'not an active member of this course''s group' using errcode = '42501';
  end if;

  select has_changes into was_changed from course_freshness where course_id = p_course_id;

  insert into course_freshness (course_id, group_id, checked_at, api_data, diff, has_changes, status, updated_at)
    values (p_course_id, v_group, now(), p_api_data, p_diff, p_has_changes,
            case when p_has_changes then 'pending' else 'none' end, now())
  on conflict (course_id) do update set
    checked_at  = now(),
    group_id    = v_group,
    api_data    = excluded.api_data,
    diff        = excluded.diff,
    has_changes = excluded.has_changes,
    status      = case when excluded.has_changes
                       then (case when course_freshness.status in ('dismissed', 'applied')
                                  then course_freshness.status else 'pending' end)
                       else 'none' end,
    updated_at  = now();

  -- Notify only ACTIVE, non-banned admins of the owning group.
  if p_has_changes and coalesce(was_changed, false) = false then
    insert into notifications (user_id, message, group_id, type, link)
    select gm.user_id, 'A course in your library has upstream data changes to review.',
           v_group, 'course_change', '/?tab=courses'
    from group_members gm
    join profiles p on p.id = gm.user_id
    where gm.group_id = v_group and gm.role = 'admin' and gm.status = 'active'
      and gm.user_id is not null and not coalesce(p.banned, false);
  end if;
end $$;
revoke all on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) from public;
revoke all on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) from anon;
grant execute on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) to authenticated;

create or replace function public.set_course_freshness_status(p_course_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'dismissed', 'applied') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;

  select group_id into v_group from favorite_courses where id = p_course_id;
  if v_group is null then
    raise exception 'course not found' using errcode = 'P0002';
  end if;

  -- Canonical admin check: active, non-banned admin of the owning group.
  if not public.is_group_admin(v_group, auth.uid()) then
    raise exception 'active admin of the owning group required' using errcode = '42501';
  end if;

  update course_freshness set status = p_status, updated_at = now() where course_id = p_course_id;
end $$;
revoke all on function public.set_course_freshness_status(uuid, text) from public;
revoke all on function public.set_course_freshness_status(uuid, text) from anon;
grant execute on function public.set_course_freshness_status(uuid, text) to authenticated;
