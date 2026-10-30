-- repair_derived_course_handicaps.sql — 212.75 (owner, Oct 30; production game 947286)
--
-- Clearing a manual course-handicap override put the row's source back to "derived" but left the manual
-- number in course_handicap. The group card recomputes from the index and tee (right); the leaderboard
-- prints the stored number (stale). 212.75 fixes the clear. This repairs rows already in that state on
-- games that have not ended, for players with no scores yet: the stored figure becomes the derived one, the app's formula
-- (round(index × slope/113 + rating − par) — half up, as Math.round does for positive numbers).
--
-- Run on production in the SQL editor ("Run without RLS"). Step 1 shows what would change; step 2 changes it.

-- 1. What would change (expect Ankur Tiku on 947286: 13 → 18).
select g.code, gp.display_name, gp.handicap_index, gp.rating, gp.slope, g.course_par,
       gp.course_handicap as stored,
       round(gp.handicap_index * (gp.slope / 113.0) + (gp.rating - g.course_par)) as derived,
       gp.course_handicap_source, g.status
  from game_players gp
  join games g on g.id = gp.game_id
 where coalesce(gp.course_handicap_source, 'derived') = 'derived'
   and coalesce(g.status, 'active') <> 'ended'
   and not exists (select 1 from jsonb_array_elements(coalesce(gp.scores, '[]'::jsonb)) x where x is not null and x::text <> 'null')
   and gp.handicap_index is not null and gp.rating is not null and gp.slope is not null and g.course_par is not null
   and gp.course_handicap is distinct from round(gp.handicap_index * (gp.slope / 113.0) + (gp.rating - g.course_par))::int
 order by g.code, gp.display_name;

-- 2. Apply (same rows).
update game_players gp
   set course_handicap = round(gp.handicap_index * (gp.slope / 113.0) + (gp.rating - g.course_par))::int
  from games g
 where g.id = gp.game_id
   and coalesce(gp.course_handicap_source, 'derived') = 'derived'
   and coalesce(g.status, 'active') <> 'ended'
   and not exists (select 1 from jsonb_array_elements(coalesce(gp.scores, '[]'::jsonb)) x where x is not null and x::text <> 'null')
   and gp.handicap_index is not null and gp.rating is not null and gp.slope is not null and g.course_par is not null
   and gp.course_handicap is distinct from round(gp.handicap_index * (gp.slope / 113.0) + (gp.rating - g.course_par))::int;
