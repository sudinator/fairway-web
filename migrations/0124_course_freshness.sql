-- 0124_course_freshness.sql
-- Caches the once-a-day upstream (golf API) freshness check per library course, so:
--   * we call the API at most ~once/day/course (the first person to open it triggers it),
--   * everyone else reads the cached result,
--   * and group admins get flagged when a course's rating/slope/yardages change at the source.
-- The stored library course itself only changes through the existing admin-approval flow; this
-- table just caches the detected diff + the fresh API payload to play a round with. Idempotent.

create table if not exists public.course_freshness (
  course_id  uuid primary key references public.favorite_courses(id) on delete cascade,
  group_id   uuid,
  checked_at timestamptz not null default now(),
  api_data   jsonb,                                  -- fresh API course (to diff / to play with)
  diff       jsonb,                                  -- FreshnessDiff summary; null when unchanged
  has_changes boolean not null default false,
  status     text not null default 'none',           -- none | pending | dismissed | applied
  updated_at timestamptz not null default now()
);
alter table public.course_freshness enable row level security;

-- Library courses are shared; any authenticated member may READ the cache (to throttle the daily
-- check and to fetch the cached fresh data). Writes go only through the SECURITY DEFINER RPC below.
drop policy if exists course_freshness_read on public.course_freshness;
create policy course_freshness_read on public.course_freshness for select to authenticated using (true);

-- Record a freshness check (upsert). Any member may write the cache; when a change is NEWLY
-- detected (wasn't flagged before), notify the group's admins. A prior 'dismissed'/'applied'
-- status is preserved so an admin's decision isn't reset by the next passer-by's check.
create or replace function public.record_course_freshness(
  p_course_id uuid, p_group_id uuid, p_api_data jsonb, p_diff jsonb, p_has_changes boolean
) returns void language plpgsql security definer set search_path = public as $$
declare was_changed boolean;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select has_changes into was_changed from course_freshness where course_id = p_course_id;

  insert into course_freshness (course_id, group_id, checked_at, api_data, diff, has_changes, status, updated_at)
    values (p_course_id, p_group_id, now(), p_api_data, p_diff, p_has_changes,
            case when p_has_changes then 'pending' else 'none' end, now())
  on conflict (course_id) do update set
    checked_at  = now(),
    api_data    = excluded.api_data,
    diff        = excluded.diff,
    has_changes = excluded.has_changes,
    status      = case when excluded.has_changes
                       then (case when course_freshness.status in ('dismissed', 'applied')
                                  then course_freshness.status else 'pending' end)
                       else 'none' end,
    updated_at  = now();

  if p_has_changes and coalesce(was_changed, false) = false and p_group_id is not null then
    insert into notifications (user_id, message, group_id, type, link)
    select gm.user_id, 'A course in your library has upstream data changes to review.',
           p_group_id, 'course_change', '/?tab=courses'
    from group_members gm
    where gm.group_id = p_group_id and gm.role = 'admin' and gm.user_id is not null;
  end if;
end $$;
revoke all on function public.record_course_freshness(uuid, uuid, jsonb, jsonb, boolean) from public;
grant execute on function public.record_course_freshness(uuid, uuid, jsonb, jsonb, boolean) to authenticated;

-- Admin decision on a flagged course: 'dismissed' (ignore for now) or 'applied' (updated the library).
create or replace function public.set_course_freshness_status(p_course_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  update course_freshness set status = p_status, updated_at = now() where course_id = p_course_id;
end $$;
revoke all on function public.set_course_freshness_status(uuid, text) from public;
grant execute on function public.set_course_freshness_status(uuid, text) to authenticated;
