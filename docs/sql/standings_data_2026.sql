-- standings_data_2026.sql — read-only. Everything lib/season-standings needs for ONE club's 2026 games, as one JSON
-- value to copy from the result cell and paste back (names included — it's your club's own data).
-- Run in the Supabase SQL editor ("Run without RLS" is fine; nothing is written).

-- 1. Your clubs, with ended 2026 games — pick the name for step 2.
select g.name as club, count(*) filter (where ga.status = 'ended') as ended_2026
  from groups g
  join games ga on ga.group_id = g.id and ga.played_at >= '2026-01-01' and ga.played_at <= '2026-12-31'
 where not coalesce(g.is_test, false)
 group by g.name order by ended_2026 desc;

-- 2. The data (edit the club name).
with club as (select id from groups where name = 'Main' limit 1),
g as (
  select id, code, name, game_type, status, played_at, course, course_par, holes_meta, allowance_pct, stroke_basis,
         team_score_mode, skins_mode, teams, foursomes, pairings, leg_config, flight_mode
    from games where group_id = (select id from club) and status = 'ended'
     and played_at >= '2026-01-01' and played_at <= '2026-12-31'
     and game_type in ('stableford','stroke','fourball','trifecta')
),
p as (
  select gp.game_id, gp.id, gp.user_id, gp.display_name, gp.is_guest, gp.no_show, gp.team, gp.tee_group, gp.tee_name,
         gp.handicap_index, gp.rating, gp.slope, gp.course_handicap, gp.course_handicap_source, gp.scores
    from game_players gp where gp.game_id in (select id from g)
),
c as (
  select gc.id, gc.game_id, gc.kind, gc.label, gc.unit, gc.holes, gc.better
    from game_contests gc where gc.game_id in (select id from g)
),
e as (
  select ce.contest_id, ce.hole, ce.player_id, ce.guest_id, ce.player_name, ce.value, ce.voided
    from game_contest_entries ce where ce.contest_id in (select id from c)
)
select json_build_object(
  'club', (select name from groups where id = (select id from club)),
  'games', (select coalesce(json_agg(row_to_json(g) order by g.played_at), '[]'::json) from g),
  'players', (select coalesce(json_agg(row_to_json(p)), '[]'::json) from p),
  'contests', (select coalesce(json_agg(row_to_json(c)), '[]'::json) from c),
  'entries', (select coalesce(json_agg(row_to_json(e)), '[]'::json) from e)
) as standings_data;
