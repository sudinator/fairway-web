-- 0215_course_field_averages.sql
--
-- 212.18 — YOUR COURSES: the club's averages at a course, beside a member's own record (owner, Oct 22: compare with
-- the club's average only, never with named members). Members may see that a clubmate played a course (rounds) but not
-- their hole-by-hole scores (holes: own only), so the averages are computed here and ONLY averages leave:
--   * the club's final rounds at the course over the last two years (course matched case- and space-insensitively);
--   * nothing at all unless at least 5 rounds by at least 3 members — and a hole only with 3+ scores — so no one's
--     scores can be worked out from the averages;
--   * callable only by an active member of that club.
--
-- AUTHORIZATION: course_field_averages(uuid, text) — SECURITY DEFINER; EXECUTE for authenticated only (revoked from
-- public / anon); checks is_group_member(p_group, auth.uid()) and an active account. Reads rounds / holes; writes nothing.
-- TESTS: ci/assert-course-field.sql
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.course_field_averages(p_group uuid, p_course text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_key text := lower(regexp_replace(trim(coalesce(p_course, '')), '\s+', ' ', 'g')); v jsonb;
begin
  if auth.uid() is null or not public.is_group_member(p_group, auth.uid())
     or not exists (select 1 from profiles p where p.id = auth.uid() and p.account_status = 'active') then
    raise exception 'Only members of this club can see its course averages' using errcode = '42501';
  end if;
  with rs as (
    select r.id, r.user_id from rounds r
     where r.group_id = p_group and r.deleted_at is null and coalesce(r.status, 'final') = 'final'
       and r.played_at >= now() - interval '2 years'
       and lower(regexp_replace(trim(r.course), '\s+', ' ', 'g')) = v_key
       and (select count(*) from holes h where h.round_id = r.id and h.strokes > 0) >= 9
  ), totals as (select count(*) n_rounds, count(distinct user_id) n_players from rs),
  per_hole as (
    select h.hole_number, max(h.par) par, avg(h.strokes - h.par)::numeric avg_to_par, count(*) n
      from holes h join rs on rs.id = h.round_id
     where h.strokes > 0 and h.par > 0 group by h.hole_number having count(*) >= 3
  )
  select case when t.n_rounds < 5 or t.n_players < 3
              then jsonb_build_object('enough', false, 'rounds', t.n_rounds, 'holes', '[]'::jsonb)
              else jsonb_build_object('enough', true, 'rounds', t.n_rounds, 'players', t.n_players,
                     'holes', coalesce((select jsonb_agg(jsonb_build_object('hole', x.hole_number, 'par', x.par, 'avg_to_par', round(x.avg_to_par, 2), 'n', x.n) order by x.hole_number) from per_hole x), '[]'::jsonb))
         end into v
    from totals t;
  return v;
end $$;
revoke all on function public.course_field_averages(uuid, text) from public, anon;
grant execute on function public.course_field_averages(uuid, text) to authenticated;

select public.record_migration('0215_course_field_averages');

commit;
