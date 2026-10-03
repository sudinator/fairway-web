-- 0168_course_owner_groups.sql
--
-- A course belongs to the clubs LINKED to it, not to a legacy column.
--
-- WHAT WENT WRONG (production, 2026-10-03): the scheduled freshness sync raised
--   fjk8jxy3 (Banks, Forsgate): record_course_freshness_system -> P0002 "course not found"
-- The row exists. favorite_courses.group_id is a legacy column that the group-delete and
-- group-merge paths set to NULL; courses are shared records attached to clubs through the
-- group_courses link table. Every freshness function since 0124 derived the owning club, the
-- admins to notify, the member check, the queue's visibility and the apply right from that legacy
-- column, so a course with a null group_id could not be recorded, reviewed or applied, and its
-- error text said something false.
--
-- THIS MIGRATION introduces course_owner_groups(course) — the linked clubs, plus the legacy
-- group_id while it is still set — and rebuilds every freshness function on it:
--   * record_course_freshness (member path): caller must be an active member of ANY owning club,
--     or the app admin.
--   * record_course_freshness_internal: no longer fails on a null group_id; notifies the admins of
--     every owning club once each; a course with no owning club notifies the app admins.
--   * pending_course_reviews: visible to the app admin, and to admins of any owning club; the club
--     column lists every owning club ("Club A, Club B"), or "No club" for an unlinked course.
--   * apply_course_freshness and set_course_freshness_status (dismiss): app admin, or admin of any
--     owning club. The dismiss path had the same null-group failure.
--
-- AUTHORIZATION: as 0167, with "the owning club" meaning "any club linked to the course". The app
-- admin keeps the global rights they already have on favorite_courses. course_owner_groups is a
-- helper granted to authenticated; it reveals only which clubs a course is linked to, which the
-- Courses screen already shows to members.
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.course_owner_groups(p_course_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select gc.group_id from group_courses gc where gc.course_id = p_course_id
  union
  select fc.group_id from favorite_courses fc where fc.id = p_course_id and fc.group_id is not null;
$$;
revoke all on function public.course_owner_groups(uuid) from public, anon;
grant execute on function public.course_owner_groups(uuid) to authenticated;

create or replace function public.record_course_freshness_internal(
  p_course_id uuid, p_api_data jsonb, p_diff jsonb, p_has_changes boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_name text;
  was_changed boolean;
  v_old_diff jsonb;
  v_tees integer;
  v_yards integer;
  v_first text;
  v_detail text;
begin
  -- No caller check here: the public entry points authorise (member, or service_role).
  -- group_id is a LEGACY column (null once a club is deleted or merged); the clubs that actually own
  -- a course are those linked through group_courses. course_freshness.group_id keeps the first link
  -- for the old readers of that column.
  if not exists (select 1 from favorite_courses where id = p_course_id and coalesce(deleted, false) = false) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  select name into v_name from favorite_courses where id = p_course_id;
  select g into v_group from public.course_owner_groups(p_course_id) g limit 1;

  select has_changes, diff into was_changed, v_old_diff from course_freshness where course_id = p_course_id;

  insert into course_freshness (course_id, group_id, checked_at, api_data, diff, has_changes, status, updated_at)
    values (p_course_id, v_group, now(), p_api_data, p_diff, p_has_changes,
            case when p_has_changes then 'pending' else 'none' end, now())
  on conflict (course_id) do update set
    checked_at  = now(),
    group_id    = v_group,
    api_data    = excluded.api_data,
    diff        = excluded.diff,
    has_changes = excluded.has_changes,
    -- A decision applies to the diff it was made on. The same diff keeps the decision; a different
    -- one is a new question and goes back to pending.
    status      = case when excluded.has_changes
                       then (case when course_freshness.status in ('dismissed', 'applied')
                                   and course_freshness.diff is not distinct from excluded.diff
                                  then course_freshness.status else 'pending' end)
                       else 'none' end,
    updated_at  = now();

  -- Tell the club's admins on first detection, and again whenever the diff itself changes.
  if p_has_changes and (coalesce(was_changed, false) = false or v_old_diff is distinct from p_diff) then
    select count(*),
           coalesce(sum(jsonb_array_length(coalesce(t->'yardageChanges', '[]'::jsonb))), 0)
      into v_tees, v_yards
      from jsonb_array_elements(coalesce(p_diff->'tees', '[]'::jsonb)) t;
    select string_agg(x, ', ') into v_first from (
      select (t->>'name') ||
             case when (t->>'ratingChanged')::boolean then ' rating ' || (t->>'ratingFrom') || '→' || (t->>'ratingTo') else '' end ||
             case when (t->>'slopeChanged')::boolean then
                  case when (t->>'ratingChanged')::boolean then ',' else '' end || ' slope ' || (t->>'slopeFrom') || '→' || (t->>'slopeTo') else '' end as x
        from jsonb_array_elements(coalesce(p_diff->'tees', '[]'::jsonb)) t
       where (t->>'ratingChanged')::boolean or (t->>'slopeChanged')::boolean
       limit 2) s;
    select string_agg(x, E'\n') into v_detail from (
      select (t->>'name') || ': ' || concat_ws('; ',
               case when (t->>'ratingChanged')::boolean then 'rating ' || (t->>'ratingFrom') || ' → ' || (t->>'ratingTo') end,
               case when (t->>'slopeChanged')::boolean then 'slope ' || (t->>'slopeFrom') || ' → ' || (t->>'slopeTo') end,
               nullif((select string_agg('hole ' || (y->>'hole') || ' ' || coalesce(y->>'from', '—') || '→' || coalesce(y->>'to', '—'), ', ' order by (y->>'hole')::int)
                         from jsonb_array_elements(coalesce(t->'yardageChanges', '[]'::jsonb)) y), '')) as x
        from jsonb_array_elements(coalesce(p_diff->'tees', '[]'::jsonb)) t) d;

    insert into notifications (user_id, message, group_id, type, link, detail)
    select gm.user_id,
           coalesce(v_name, 'A course') || ': GolfCourseAPI now lists different data' ||
           case when v_first is not null then ' — ' || v_first else '' end ||
           case when v_yards > 0 then '; ' || v_yards || ' yardage change' || case when v_yards = 1 then '' else 's' end ||
                                       ' across ' || v_tees || ' tee' || case when v_tees = 1 then '' else 's' end else '' end ||
           '. Review in Courses.',
           v_group, 'course_change', '/?tab=courses', left(v_detail, 2000)
    from (
      -- Admins of every linked club, once each; app admins when no club is linked (a global course).
      select distinct gm.user_id
        from group_members gm
       where gm.group_id in (select g from public.course_owner_groups(p_course_id) g)
         and gm.role = 'admin' and gm.status = 'active' and gm.user_id is not null
      union
      select p2.id from profiles p2
       where coalesce(p2.is_admin, false) and not exists (select 1 from public.course_owner_groups(p_course_id))
    ) gm
    join profiles p on p.id = gm.user_id
    where not coalesce(p.banned, false);
  end if;
end $$;
revoke all on function public.record_course_freshness_internal(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;

create or replace function public.record_course_freshness(
  p_course_id uuid, p_api_data jsonb, p_diff jsonb, p_has_changes boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (select 1 from favorite_courses where id = p_course_id and coalesce(deleted, false) = false) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or exists (
        select 1 from public.course_owner_groups(p_course_id) g where public.is_group_member(g, auth.uid()))) then
    raise exception 'not an active member of a club that uses this course' using errcode = '42501';
  end if;
  perform public.record_course_freshness_internal(p_course_id, p_api_data, p_diff, p_has_changes);
end $$;
revoke all on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) from public;
revoke all on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) from anon;
grant execute on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) to authenticated;

drop function if exists public.pending_course_reviews();
create or replace function public.pending_course_reviews()
returns table (
  course_id   uuid,
  course_name text,
  club_name   text,
  group_id    uuid,
  provider_id text,
  checked_at  timestamptz,
  diff        jsonb,
  api_data    jsonb,
  corrected   boolean
)
language sql stable security definer set search_path = public as $$
  select fc.id, fc.name,
         coalesce((select string_agg(g.name, ', ' order by g.name) from public.course_owner_groups(fc.id) og join groups g on g.id = og), 'No club'),
         (select og from public.course_owner_groups(fc.id) og limit 1),
         fc.external_id, cf.checked_at, cf.diff, cf.api_data,
         coalesce((fc.data->>'corrected')::boolean, false)
    from course_freshness cf
    join favorite_courses fc on fc.id = cf.course_id and coalesce(fc.deleted, false) = false
   where auth.uid() is not null
     and cf.status = 'pending' and cf.has_changes
     and cf.api_data is not null
     and (public.is_admin()
          or exists (select 1 from public.course_owner_groups(fc.id) g where public.is_group_admin(g, auth.uid())))
   order by cf.checked_at desc, fc.name;
$$;
revoke all on function public.pending_course_reviews() from public;
revoke all on function public.pending_course_reviews() from anon;
grant execute on function public.pending_course_reviews() to authenticated;

create or replace function public.apply_course_freshness(p_course_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_api jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (select 1 from favorite_courses where id = p_course_id and coalesce(deleted, false) = false) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or exists (
        select 1 from public.course_owner_groups(p_course_id) g where public.is_group_admin(g, auth.uid()))) then
    raise exception 'club admin required' using errcode = '42501';
  end if;
  select api_data into v_api from course_freshness where course_id = p_course_id;
  if v_api is null then
    raise exception 'no provider data recorded for this course' using errcode = 'P0002';
  end if;
  update favorite_courses set data = v_api where id = p_course_id;
  update course_freshness set status = 'applied', updated_at = now() where course_id = p_course_id;
end $$;
revoke all on function public.apply_course_freshness(uuid) from public;
revoke all on function public.apply_course_freshness(uuid) from anon;
grant execute on function public.apply_course_freshness(uuid) to authenticated;

create or replace function public.set_course_freshness_status(p_course_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'dismissed', 'applied') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;
  if not exists (select 1 from favorite_courses where id = p_course_id and coalesce(deleted, false) = false) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  -- Active, non-banned admin of ANY owning club, or the app admin.
  if not (public.is_admin() or exists (
        select 1 from public.course_owner_groups(p_course_id) g where public.is_group_admin(g, auth.uid()))) then
    raise exception 'club admin required' using errcode = '42501';
  end if;
  update course_freshness set status = p_status, updated_at = now() where course_id = p_course_id;
end $$;
revoke all on function public.set_course_freshness_status(uuid, text) from public;
revoke all on function public.set_course_freshness_status(uuid, text) from anon;
grant execute on function public.set_course_freshness_status(uuid, text) to authenticated;

select public.record_migration('0168_course_owner_groups');

commit;
