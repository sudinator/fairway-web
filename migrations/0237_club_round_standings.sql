-- 0237_club_round_standings.sql
-- 212.117: the Rounds tab of Season standings (owner, Nov 17–18, 2026).
--  1. profiles.share_rounds_with_club — the member's switch (Profile), ON by default: "Include my rounds in the club
--     standings". Club games always count on the Club games tab; this covers rounds the member logs themselves.
--  2. club_round_standings_data(group, year) — SECURITY DEFINER: the rounds (with holes) of the club's members who share
--     them, for the year, to a caller who is a member of that club. Holes are otherwise readable only by their owner
--     ("own holes", 0137), so the tab needs this door; it opens only for members, only for sharing members' rounds,
--     only final rounds, and never for a test club. Returns a JSON object {rounds:[...], holes:[...]} — one call.
-- AUTHORIZATION: club_round_standings_data is SECURITY DEFINER so a member can read fellow members' holes (otherwise
--   owner-only); it refuses non-members (42501), returns only sharing members' final rounds of the year, and nothing for
--   a test club. profiles.share_rounds_with_club is the member's own column under the existing profile policies.
-- Additive. No history rewrite.
-- TESTS: ci/assert-club-round-standings.sql
begin;

alter table public.profiles add column if not exists share_rounds_with_club boolean not null default true;

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
       and r.played_at >= make_date(p_year, 1, 1) and r.played_at <= make_date(p_year, 12, 31)
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

select public.record_migration('0237_club_round_standings');

commit;
