-- READ ONLY. Run in STAGING, export the single result row as CSV.
-- Does NOT call either maintenance sweep or end/post/delete any game/round.
-- Mirrors the committed 0106 member-score eligibility, exposing exclusions.
with old_games as (
  select g.*, gr.name as club_name, public.is_test_group(g.group_id) as test_club,
    case when jsonb_typeof(g.holes_meta)='array' then jsonb_array_length(g.holes_meta) else 0 end as planned_holes
  from public.games g left join public.groups gr on gr.id=g.group_id
  where g.status is distinct from 'ended' and g.created_at < now()-interval '24 hours'
), cards as (
  select g.id as gid,p.id,p.user_id,p.no_show,
    count(*) filter(where case when btrim(p.scores->>i) ~ '^[0-9]+$' then (p.scores->>i)::numeric>0 else false end)::int as entered,
    count(*) filter(where p.scores->>i is not null and p.scores->>i <> '' and btrim(p.scores->>i) !~ '^-?[0-9]+$')::int as invalid_entries
  from old_games g join public.game_players p on p.game_id=g.id
  left join lateral generate_series(0,g.planned_holes-1) i on true
  group by g.id,p.id,p.user_id,p.no_show
), counts as (
  select g.id,
    count(c.id) filter(where c.user_id is not null) as member_cards,
    count(c.id) filter(where c.user_id is null) as guest_cards,
    count(c.id) filter(where c.user_id is not null and c.entered=g.planned_holes and g.planned_holes>0) as complete_members,
    count(c.id) filter(where c.user_id is not null and c.entered>0 and c.entered<g.planned_holes) as partial_members,
    count(c.id) filter(where c.user_id is not null and c.entered=0) as unstarted_members,
    coalesce(sum(c.invalid_entries),0) as invalid_entries
  from old_games g left join cards c on c.gid=g.id group by g.id
), classified as (
  select g.id,g.code,g.name,g.game_type,g.status as saved_status,g.club_name,g.test_club,
    g.created_at,g.played_at,g.planned_holes,
    round(extract(epoch from(now()-g.created_at))/3600,1) as age_hours,
    (to_jsonb(g)->>'players_notified_at') is null as unannounced_draft,
    (to_jsonb(g)->>'scored_at')::timestamptz as first_observed_complete_at,
    (to_jsonb(g)->>'end_nudge_at')::timestamptz as organizer_nudged_at,
    c.member_cards,c.guest_cards,c.complete_members,c.partial_members,c.unstarted_members,c.invalid_entries,
    case
      when g.test_club then 'Skipped: test club (explicit 0106 exclusion)'
      when g.created_at <= now()-interval '30 days' then 'Skipped: outside sweep 30-day creation window'
      when g.planned_holes=0 then 'Skipped: no planned holes'
      when c.invalid_entries>0 then 'Investigate: non-integer score text can fail the legacy sweep'
      when c.partial_members>0 then 'Skipped: at least one member has a partial scorecard'
      when c.complete_members=0 and g.game_type in ('alt_shot','scramble') then 'Skipped by legacy member-array check: inspect shared-ball scorecards below'
      when c.complete_members=0 then 'Skipped: no fully scored member card'
      when (to_jsonb(g)->>'scored_at') is null then 'Complete but not yet timestamped by a sweep; countdown starts on first observation'
      when now() < ((date_trunc('day',(to_jsonb(g)->>'scored_at')::timestamptz at time zone 'America/New_York')+interval '1 day') at time zone 'America/New_York') then 'Waiting: next Eastern midnight after first observed completion'
      else 'Eligible under committed rules: should end on a successful unthrottled sweep'
    end as committed_rule_verdict,
    (select coalesce(jsonb_agg(jsonb_build_object('name',p.display_name,'member',p.user_id is not null,'no_show',p.no_show,'holes_scored',c2.entered,'invalid_entries',c2.invalid_entries) order by p.display_name),'[]'::jsonb)
      from cards c2 join public.game_players p on p.id=c2.id where c2.gid=g.id) as player_cards,
    (select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from (
      select a.foursome_id,a.side,count(*) filter(where a.strokes>0 and a.hole_index>=0 and a.hole_index<g.planned_holes) as scored_holes,max(a.updated_at) as last_shared_score_at
      from public.game_alt_shot_scores a where a.game_id=g.id group by a.foursome_id,a.side
    ) s) as shared_scorecards
  from old_games g join counts c on c.id=g.id
)
select jsonb_pretty(jsonb_build_object(
  'checked_at',statement_timestamp(),
  'games',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from classified c),'[]'::jsonb),
  'last_sweep_attempts',coalesce((select jsonb_agg(to_jsonb(j)) from public.system_jobs j where j.job in ('sweep_stale_games','finish_stale_rounds')),'[]'::jsonb),
  'live_function_definitions',coalesce((select jsonb_object_agg(p.proname,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('sweep_stale_games','finish_stale_rounds') and p.pronargs=0),'{}'::jsonb),
  'matching_cron_jobs_xml',case when to_regclass('cron.job') is not null then query_to_xml('select jobname,schedule,active from cron.job where command ilike ''%sweep_stale_games%'' or command ilike ''%finish_stale_rounds%''',true,false,'')::text else null end,
  'scope_note','Verdicts mirror committed 0106 rules; compare live definitions before concluding deployed behavior. A last_run timestamp records an attempted call, not proof that every eligible game finished.'
)) as stale_games_audit;
