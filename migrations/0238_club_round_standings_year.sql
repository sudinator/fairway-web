-- 0238_club_round_standings_year.sql
-- 212.130: the Rounds standings' year is a calendar year, on the date the app shows.
-- WHY. rounds.played_at is a timestamptz (0001). The app writes it as a plain date ("2026-12-31", midnight in the
-- database's zone) and the game stamp (0045) writes the game's DATE — both land on midnight, so 0237's range
--   played_at >= make_date(y,1,1) and played_at <= make_date(y,12,31)
-- held them. A round whose played_at carries a TIME (an older row stamped by `default now()`, or the Home fallback that
-- stamps `new Date().toISOString()` on a round that had no date) falls outside it on December 31: 2026-12-31 15:00 is
-- greater than 2026-12-31 00:00. That round left the year's standings — and, had the comparison run in another session
-- zone, could have joined the next year's. Season Wrapped and the year-end standings run on December 31.
-- RULE. The year is decided by the UTC calendar date of played_at — the same date the app reads from the value
-- (`String(played_at).slice(0, 10)` in the round editor, the dedupe key in lib/season-rounds) — and the range is
-- half-open, [Jan 1, Jan 1 next year), evaluated independently of the session's time zone. A date-only value is
-- unchanged by this (midnight UTC is the same calendar day); a timestamped December 31 round is now in its year.
-- Everything else in club_round_standings_data is exactly as 0237 left it (SECURITY DEFINER, member-only, sharing
-- members' final rounds, nothing for a test club, holes included).
-- AUTHORIZATION: unchanged from 0237 — the function remains SECURITY DEFINER with the same checks and grants.
-- Additive (replaces the function body). No history rewrite.
-- TESTS: ci/assert-club-round-standings.sql (the December 31 and January 1 boundary cases added in 212.130)
begin;

create or replace function public.club_round_standings_data(p_group uuid, p_year integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_group_member(p_group, auth.uid()) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;
  if exists (select 1 from groups g where g.id = p_group and coalesce(g.is_test, false)) then
    return jsonb_build_object('rounds', '[]'::jsonb, 'holes', '[]'::jsonb);
  end if;
  with members as (
    select gm.user_id from group_members gm
     where gm.group_id = p_group and gm.status <> 'removed'
  ),
  r as (
    select r.id, r.user_id, p.display_name, p.avatar_url, r.played_at, r.course, r.course_par, r.course_handicap
      from rounds r
      join profiles p on p.id = r.user_id
     where r.user_id in (select user_id from members)
       and coalesce(p.share_rounds_with_club, true)
       and r.deleted_at is null and r.status = 'final'
       -- 0238: the UTC calendar date of played_at, a half-open year — a timestamped December 31 round stays in its year
       and (r.played_at at time zone 'UTC')::date >= make_date(p_year, 1, 1)
       and (r.played_at at time zone 'UTC')::date <  make_date(p_year + 1, 1, 1)
  ),
  h as (
    select h.round_id, h.hole_number, h.par, h.stroke_index, h.strokes, h.putts
      from holes h where h.round_id in (select id from r)
  )
  select jsonb_build_object(
    'rounds', coalesce((select jsonb_agg(to_jsonb(r)) from r), '[]'::jsonb),
    'holes',  coalesce((select jsonb_agg(to_jsonb(h)) from h), '[]'::jsonb)
  ) into v;
  return v;
end $$;

revoke all on function public.club_round_standings_data(uuid, integer) from public;
grant execute on function public.club_round_standings_data(uuid, integer) to authenticated;

select public.record_migration('0238_club_round_standings_year');

commit;
