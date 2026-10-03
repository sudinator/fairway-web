-- 0167_course_review_queue.sql
--
-- Course updates need a queue an admin can actually work, not a section that depends on which
-- club happens to be selected.
--
-- WHAT WENT WRONG (2026-10-02): the scheduled freshness sync (0166) flagged three courses. The
-- Courses "Needs review" section (195.0) listed only one, because it queried course_freshness for
-- the ACTIVE club's courses; the other two belonged to other clubs the same admin runs. Reading the
-- code for the fix exposed two more defects:
--   * record_course_freshness kept status 'dismissed' or 'applied' forever (0124). A course the
--     provider changed a second time never returned to 'pending' and nobody was told.
--   * "Update stored course" was a client-side UPDATE of favorite_courses, which RLS allows only
--     to the app admin (course_admin_updates_global_courses). It worked for the app admin and failed
--     silently for any other club admin pressing the same button.
--
-- THIS MIGRATION:
--   1. Reopens a review when the diff CHANGES. Same diff as the one dismissed stays dismissed; a
--      new diff is 'pending' again and the admins are notified again. After an apply the stored
--      data equals the provider's, so the next check yields no changes and status 'none'.
--   2. pending_course_reviews(): the queue. App admin -> every pending course in every club; club
--      admin -> pending courses of the clubs they administer; anyone else -> nothing. Each row
--      carries the club name so the list reads correctly across clubs.
--   3. apply_course_freshness(course): the ONE implementation of "update the stored course from the
--      provider". SECURITY DEFINER with explicit authorisation (app admin OR admin of the owning
--      club); writes course_freshness.api_data into favorite_courses.data and marks the review
--      applied. Both the Courses queue and the New Round sheet call it.
--
-- AUTHORIZATION:
--   * pending_course_reviews: authenticated; filters to is_admin() or is_group_admin(group, uid).
--     Returns course data and diffs, which members of those clubs can already read.
--   * apply_course_freshness: authenticated; raises 42501 unless is_admin() or is_group_admin of
--     the course's group. This deliberately widens the apply right from app admin to club admins,
--     which is the product rule stated in the UI ("applies for everyone"); the diff shown is the
--     provider's data, not free-form input.
--   * record_course_freshness_internal: no grants (unchanged); only its decision table changes.
--
-- Idempotent; safe to re-run.

begin;

-- ── 1. Reopen on a new diff ──────────────────────────────────────────────────────────────────────
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
  select group_id, name into v_group, v_name
  from favorite_courses
  where id = p_course_id and coalesce(deleted, false) = false;
  if v_group is null then
    raise exception 'course not found' using errcode = 'P0002';
  end if;

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
    from group_members gm
    join profiles p on p.id = gm.user_id
    where gm.group_id = v_group and gm.role = 'admin' and gm.status = 'active'
      and gm.user_id is not null and not coalesce(p.banned, false);
  end if;
end $$;
revoke all on function public.record_course_freshness_internal(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;

-- ── 2. The queue ─────────────────────────────────────────────────────────────────────────────────
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
  select fc.id, fc.name, g.name, fc.group_id, fc.external_id, cf.checked_at, cf.diff, cf.api_data,
         coalesce((fc.data->>'corrected')::boolean, false)
    from course_freshness cf
    join favorite_courses fc on fc.id = cf.course_id and coalesce(fc.deleted, false) = false
    join groups g on g.id = fc.group_id
   where auth.uid() is not null
     and cf.status = 'pending' and cf.has_changes
     and cf.api_data is not null
     and (public.is_admin() or public.is_group_admin(fc.group_id, auth.uid()))
   order by cf.checked_at desc, fc.name;
$$;
revoke all on function public.pending_course_reviews() from public;
revoke all on function public.pending_course_reviews() from anon;
grant execute on function public.pending_course_reviews() to authenticated;

-- ── 3. One apply ─────────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_course_freshness(p_course_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_api jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select fc.group_id, cf.api_data into v_group, v_api
    from favorite_courses fc join course_freshness cf on cf.course_id = fc.id
   where fc.id = p_course_id and coalesce(fc.deleted, false) = false;
  if v_group is null then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or public.is_group_admin(v_group, auth.uid())) then
    raise exception 'club admin required' using errcode = '42501';
  end if;
  if v_api is null then
    raise exception 'no provider data recorded for this course' using errcode = 'P0002';
  end if;
  update favorite_courses set data = v_api where id = p_course_id;
  update course_freshness set status = 'applied', updated_at = now() where course_id = p_course_id;
end $$;
revoke all on function public.apply_course_freshness(uuid) from public;
revoke all on function public.apply_course_freshness(uuid) from anon;
grant execute on function public.apply_course_freshness(uuid) to authenticated;

select public.record_migration('0167_course_review_queue');

commit;
