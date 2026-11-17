-- rounds_data_2026.sql — read-only. Every 2026 round logged by members of ONE club, with its holes, as one JSON value
-- to copy from the result cell (or download) and paste / upload back. Names included — it's your club's own data.

with club as (select id from groups where name = 'Main' limit 1),
members as (select distinct user_id from group_members where group_id = (select id from club) and status <> 'removed'),
r as (
  select r.id, r.user_id, p.display_name, r.played_at, r.course, r.tee_name, r.course_par, r.course_handicap, r.handicap_index,
         r.rating, r.slope, r.group_id, r.game_id, r.status, r.deleted_at
    from rounds r join profiles p on p.id = r.user_id
   where r.user_id in (select user_id from members) and r.deleted_at is null
     and r.played_at >= '2026-01-01' and r.played_at <= '2026-12-31'
),
h as (
  select h.round_id, h.hole_number, h.par, h.stroke_index, h.strokes, h.putts
    from holes h where h.round_id in (select id from r)
)
select json_build_object(
  'club', (select name from groups where id = (select id from club)),
  'rounds', (select coalesce(json_agg(row_to_json(r) order by r.played_at), '[]'::json) from r),
  'holes',  (select coalesce(json_agg(row_to_json(h)), '[]'::json) from h)
) as rounds_data;
