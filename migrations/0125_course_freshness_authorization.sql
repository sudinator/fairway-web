-- 0125_course_freshness_authorization.sql
-- Corrects the authorization gaps in 0124 (external security review, Aug 2026):
--   1. record_course_freshness trusted a client-supplied p_group_id and only checked "is logged in".
--      Any authenticated user could overwrite any course's freshness cache and spray notifications
--      to admins of arbitrary groups. Now the owning group is derived SERVER-SIDE from
--      favorite_courses by primary key, and the caller must be an active member of that group.
--      p_group_id is dropped from the signature entirely.
--   2. set_course_freshness_status claimed "admin decision" but never checked admin. Now requires
--      the caller to be an admin of the course's owning group, and validates the status value.
--   3. course_freshness.status gets a DB CHECK constraint (defense in depth alongside RPC checks).
-- Idempotent; safe to run once 0124 exists.
--
-- AUTHORIZATION: record_course_freshness(course_id, api_data, diff, has_changes) — callable by
-- authenticated users who are members of the group that owns favorite_courses.course_id (membership
-- verified inside the function against auth.uid(); group derived server-side, never from the client).
-- set_course_freshness_status(course_id, status) — callable only by admins (group_members.role =
-- 'admin') of that same derived owning group; status restricted to pending|dismissed|applied.

-- 3) domain constraint on status
alter table public.course_freshness drop constraint if exists course_freshness_status_check;
alter table public.course_freshness
  add constraint course_freshness_status_check
  check (status in ('none', 'pending', 'dismissed', 'applied'));

-- 1) drop the old, over-trusting signatures
drop function if exists public.record_course_freshness(uuid, uuid, jsonb, jsonb, boolean);
drop function if exists public.set_course_freshness_status(uuid, text);

-- record: any ACTIVE MEMBER of the owning group may record the daily check (first person of the
-- day triggers it). Group is derived from the course row; client cannot direct notifications.
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

  if not exists (
    select 1 from group_members gm
    where gm.group_id = v_group and gm.user_id = auth.uid()
  ) then
    raise exception 'not a member of this course''s group' using errcode = '42501';
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

  if p_has_changes and coalesce(was_changed, false) = false then
    insert into notifications (user_id, message, group_id, type, link)
    select gm.user_id, 'A course in your library has upstream data changes to review.',
           v_group, 'course_change', '/?tab=courses'
    from group_members gm
    where gm.group_id = v_group and gm.role = 'admin' and gm.user_id is not null;
  end if;
end $$;
revoke all on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) from public;
grant execute on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) to authenticated;

-- status: ADMINS of the owning group only; value validated.
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

  if not exists (
    select 1 from group_members gm
    where gm.group_id = v_group and gm.user_id = auth.uid() and gm.role = 'admin'
  ) then
    raise exception 'admin of the owning group required' using errcode = '42501';
  end if;

  update course_freshness set status = p_status, updated_at = now() where course_id = p_course_id;
end $$;
revoke all on function public.set_course_freshness_status(uuid, text) from public;
grant execute on function public.set_course_freshness_status(uuid, text) to authenticated;

select public.record_migration('0125_course_freshness_authorization');
