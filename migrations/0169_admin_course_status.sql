-- 0169_admin_course_status.sql
--
-- One Admin view answering "what is the state of every course?" — until now the answer was spread
-- over three screens: the course editor (last API verification, one course at a time), the queue
-- at the top of Courses (pending provider updates, only when non-empty), and Pending edits (member
-- corrections awaiting global approval).
--
-- admin_course_status() returns one row per library course: which clubs link it, when the provider
-- last answered for it and what it said (course_api_checks, 0164), when its data was last compared
-- with the provider and whether that review is pending/dismissed/applied (course_freshness,
-- 0124/0167), and how many member corrections await global approval (course_change_requests).
--
-- AUTHORIZATION: SECURITY DEFINER, is_admin() only — it reads course_api_checks, which is denied to
-- app roles, and aggregates across every club. Returns nothing to anyone else.
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.admin_course_status()
returns table (
  course_id           uuid,
  course_name         text,
  clubs               text,
  provider_id         text,
  corrected           boolean,
  last_verified_at    timestamptz,   -- provider last answered (ok or drift)
  last_check_at       timestamptz,   -- last attempt of any outcome
  last_check_status   text,          -- ok | drift | error | claimed | null (never attempted)
  last_check_note     text,
  freshness_checked_at timestamptz,  -- last diff against the stored data
  freshness_status    text,          -- none | pending | dismissed | applied | null (never compared)
  freshness_changes   integer,       -- rating/slope/yardage differences in the last diff
  pending_requests    integer,       -- member corrections awaiting global approval
  oldest_request_at   timestamptz
)
language sql stable security definer set search_path = public as $$
  select fc.id, fc.name,
         coalesce((select string_agg(g.name, ', ' order by g.name) from public.course_owner_groups(fc.id) og join groups g on g.id = og), 'No club'),
         fc.external_id,
         coalesce((fc.data->>'corrected')::boolean, false),
         c.last_success_at, c.last_checked_at, c.last_status, c.note,
         cf.checked_at, cf.status,
         (select coalesce(sum(case when (t->>'ratingChanged')::boolean then 1 else 0 end
                             + case when (t->>'slopeChanged')::boolean then 1 else 0 end
                             + jsonb_array_length(coalesce(t->'yardageChanges', '[]'::jsonb))), 0)::integer
            from jsonb_array_elements(coalesce(cf.diff->'tees', '[]'::jsonb)) t),
         (select count(*)::integer from course_change_requests r where r.course_id = fc.id and r.status = 'pending'),
         (select min(r.created_at) from course_change_requests r where r.course_id = fc.id and r.status = 'pending')
    from favorite_courses fc
    left join course_api_checks c on c.provider_id = fc.external_id
    left join course_freshness cf on cf.course_id = fc.id
   where public.is_admin()
     and coalesce(fc.deleted, false) = false
   order by fc.name;
$$;
revoke all on function public.admin_course_status() from public;
revoke all on function public.admin_course_status() from anon;
grant execute on function public.admin_course_status() to authenticated;

select public.record_migration('0169_admin_course_status');

commit;
