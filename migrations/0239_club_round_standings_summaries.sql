-- 0239_club_round_standings_summaries.sql
-- 212.131: the Rounds standings receive ONE SUMMARY ROW PER ROUND — never holes.
-- WHY. The owner's contract for the Rounds tab (212.117) is "aggregates and ranking only, no hole-by-hole". 0237/0238
-- returned every sharing member's hole rows (strokes and putts per hole) to any club member, and the app aggregated
-- them on the phone; the card showed aggregates, the response did not. The database now computes the per-round summary
-- the engine needs and returns only that: par, gross, putts (null unless every hole has them), net birdies, net eagles,
-- longest run at gross par or better — plus the round's identity (member, date, course, course handicap). Only complete
-- 18-hole rounds are returned (the engine ignored the rest anyway). The per-member aggregation (averages, bests, the
-- 5-round floor, same-day duplicates) stays in lib/season-rounds, which now takes these summaries.
-- ONE RULE, TWO LANGUAGES. Net birdies need the stroke allocation (lib/golf allocateStrokes: strokes handed out in
-- stroke-index order, wrapping; the handicap rounded once, half up; a plus handicap taken from the easiest holes).
-- club_round_strokes_on_hole() is that rule in SQL. It is held to the TypeScript by ci/assert-club-round-standings.sql
-- (an allocation table generated from allocateStrokes, and fixture rounds whose summaries lib/season-rounds.test.ts
-- also checks against summarizeRound) and by ci/test-rounds-summary-parity.cjs, which regenerates the table from the
-- TypeScript and fails when the two drift.
-- AUTHORIZATION: unchanged from 0237/0238 — SECURITY DEFINER, a member of the club only, sharing members' final rounds
-- of the (UTC calendar) year, nothing for a test club; the same grants. The new helper is a pure function.
-- Additive (replaces the function body; adds one helper). No history rewrite.
-- TESTS: ci/assert-club-round-standings.sql
begin;

-- Strokes received on the hole ranked p_rank (1 = the hardest: lowest stroke index, ties by hole number) of p_n holes,
-- for course handicap p_ch. Mirrors lib/golf allocateStrokes after summarizeRound's Math.round(course_handicap):
-- JavaScript rounds half toward +infinity (-10.5 → -10), hence floor(x + 0.5), not round().
create or replace function public.club_round_strokes_on_hole(p_rank integer, p_n integer, p_ch numeric)
returns integer language sql immutable as $$
  select case
    when p_ch is null or p_n <= 0 then 0
    when floor(p_ch + 0.5) >= 0 then
      case when p_rank <= floor(p_ch + 0.5)::integer then (floor(p_ch + 0.5)::integer - p_rank) / p_n + 1 else 0 end
    else
      -(case when (p_n + 1 - p_rank) <= (-floor(p_ch + 0.5))::integer then ((-floor(p_ch + 0.5))::integer - (p_n + 1 - p_rank)) / p_n + 1 else 0 end)
  end;
$$;
revoke all on function public.club_round_strokes_on_hole(integer, integer, numeric) from public;
grant execute on function public.club_round_strokes_on_hole(integer, integer, numeric) to authenticated;

create or replace function public.club_round_standings_data(p_group uuid, p_year integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_group_member(p_group, auth.uid()) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;
  if exists (select 1 from groups g where g.id = p_group and coalesce(g.is_test, false)) then
    return jsonb_build_object('rounds', '[]'::jsonb);
  end if;
  with members as (
    select gm.user_id from group_members gm
     where gm.group_id = p_group and gm.status <> 'removed'
  ),
  r as (
    select r.id, r.user_id, p.display_name, p.avatar_url, r.played_at, r.course, r.course_handicap
      from rounds r
      join profiles p on p.id = r.user_id
     where r.user_id in (select user_id from members)
       and coalesce(p.share_rounds_with_club, true)
       and r.deleted_at is null and r.status = 'final'
       and (r.played_at at time zone 'UTC')::date >= make_date(p_year, 1, 1)
       and (r.played_at at time zone 'UTC')::date <  make_date(p_year + 1, 1, 1)
  ),
  -- each hole with its net result (allocation by stroke-index rank) and its position in the par-or-better run
  h as (
    select h.round_id, h.hole_number, h.par, h.strokes, h.putts,
           h.strokes - h.par - public.club_round_strokes_on_hole(
             (row_number() over (partition by h.round_id order by h.stroke_index nulls last, h.hole_number))::integer, 18, r.course_handicap) as net_diff,
           case when h.strokes <= h.par then 1 else 0 end as par_or_better
      from holes h join r on r.id = h.round_id
  ),
  -- the longest run: holes at par or better grouped by the count of worse holes before them
  runs as (
    select round_id, max(len) as par_streak from (
      select round_id, grp, count(*) as len from (
        select round_id, par_or_better,
               sum(case when par_or_better = 0 then 1 else 0 end) over (partition by round_id order by hole_number) as grp
          from h
      ) g where par_or_better = 1 group by round_id, grp
    ) x group by round_id
  ),
  s as (
    select h.round_id,
           count(*) as holes,
           count(*) filter (where h.strokes is null or h.strokes <= 0 or h.par is null) as unscored,
           sum(h.par) as par, sum(h.strokes) as gross,
           case when bool_and(h.putts is not null) then sum(h.putts) else null end as putts,
           count(*) filter (where h.net_diff = -1) as net_birdies,
           count(*) filter (where h.net_diff <= -2) as net_eagles
      from h group by h.round_id
  ),
  summary as (
    select r.id, r.user_id, r.display_name, r.avatar_url, r.played_at, r.course, r.course_handicap,
           s.par, s.gross, s.putts, s.net_birdies, s.net_eagles, coalesce(runs.par_streak, 0) as par_streak
      from r join s on s.round_id = r.id left join runs on runs.round_id = r.id
     where s.holes = 18 and s.unscored = 0
  )
  select jsonb_build_object('rounds', coalesce((select jsonb_agg(to_jsonb(summary)) from summary), '[]'::jsonb)) into v;
  return v;
end $$;

revoke all on function public.club_round_standings_data(uuid, integer) from public;
grant execute on function public.club_round_standings_data(uuid, integer) to authenticated;

select public.record_migration('0239_club_round_standings_summaries');

commit;
