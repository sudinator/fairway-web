-- READ ONLY. Returns the latest ended game containing a player whose saved name includes Rajat.
-- Confirm the returned game code/date before treating this as the reported incident.
-- Run in the SQL Editor of the environment containing the actual game.
with target as (
  select g.* from public.games g
  where g.status='ended' and exists (
    select 1 from public.game_players p
    where p.game_id=g.id and p.display_name ilike '%Rajat%'
  )
  order by g.played_at desc nulls last, g.id desc limit 1
)
select jsonb_pretty(jsonb_build_object(
 'game',jsonb_build_object(
   'id',g.id,'code',g.code,'name',g.name,'played_at',g.played_at,
   'game_type',g.game_type,'course',g.course,'course_par',g.course_par,
   'holes_meta',g.holes_meta,'allowance_pct',g.allowance_pct,
   'team_score_mode',g.team_score_mode,'stroke_basis',g.stroke_basis,
   'teams',g.teams,'pairings',g.pairings,'foursomes',g.foursomes),
 'players',(select coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'user_id',p.user_id,'display_name',p.display_name,
   'team',p.team,'tee_group',p.tee_group,'no_show',p.no_show,
   'handicap_index',p.handicap_index,'course_handicap',p.course_handicap,
   'course_handicap_source',p.course_handicap_source,
   'tee_name',p.tee_name,'rating',p.rating,'slope',p.slope,'scores',p.scores
 ) order by p.display_name,p.id),'[]'::jsonb)
 from public.game_players p where p.game_id=g.id)
)) as game_comparison_data
from target g;
