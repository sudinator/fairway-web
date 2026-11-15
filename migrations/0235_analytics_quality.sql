-- 0235_analytics_quality.sql
-- AUTHORIZATION: analytical helpers/ledger are server-only; only existing admin
-- readers expose aggregates. record_feature_use derives the actor from auth.uid().
-- No scores, posting, handicap arithmetic or scheduler permissions are changed.
-- TESTS: ci/assert-analytics-quality.sql
begin;

create or replace function public.analytics_member_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles p where p.id=p_user and not coalesce(p.is_test,false)
   and not coalesce(p.deactivated,false) and not coalesce(p.banned,false) and coalesce(p.account_status,'active')='active');
$$;

-- Count actual entered holes, including canonical shared cards. This is eligibility,
-- never scoring/result arithmetic. Guests and explicit no-shows are excluded by callers.
create or replace function public.analytics_player_holes(p_game uuid,p_key text,p_scores jsonb) returns integer
language plpgsql stable security definer set search_path=public as $$
declare g games%rowtype; f jsonb; side_name text; n integer;
begin
 select * into g from games where id=p_game;
 if not found then return 0; end if;
 if jsonb_typeof(g.holes_meta) is distinct from 'array' then return 0; end if;
 n:=jsonb_array_length(g.holes_meta);
 if g.game_type in ('scramble','alt_shot') and exists(select 1 from game_alt_shot_scores where game_id=p_game) then
  select x into f from jsonb_array_elements(coalesce(g.foursomes,'[]')) x
    where (coalesce(x->'a','[]')||coalesce(x->'b','[]')) ? p_key limit 1;
  if f is null then return 0; end if;
  side_name:=case when coalesce(f->'a','[]') ? p_key then 'a' else 'b' end;
  return (select count(*)::int from game_alt_shot_scores s where s.game_id=p_game and s.foursome_id=f->>'id' and s.side=side_name and s.hole_index>=0 and s.hole_index<n and s.strokes>0);
 end if;
 if jsonb_typeof(p_scores) is distinct from 'array' then return 0; end if;
 return (select count(*)::int from jsonb_array_elements(p_scores) with ordinality x(v,i) where i<=n and jsonb_typeof(v)='number' and public._jint(v)>0);
end $$;

create or replace function public.analytics_participation()
returns table(card_key text,user_id uuid,group_id uuid,game_id uuid,played_at date,recorded_at timestamptz,holes integer,game_type text)
language sql stable security definer set search_path=public set timezone='America/New_York' as $$
 select 'game:'||g.id||':'||gp.user_id,gp.user_id,g.group_id,g.id,g.played_at,coalesce(g.ended_at,g.created_at),a.n,g.game_type
 from games g join game_players gp on gp.game_id=g.id
 cross join lateral(select public.analytics_player_holes(g.id,gp.user_id::text,gp.scores) n) a
 where g.status='ended' and g.played_at<=current_date and not public.is_test_group(g.group_id)
 and public.analytics_member_eligible(gp.user_id) and not coalesce(gp.no_show,false)
 and jsonb_array_length(coalesce(g.holes_meta,'[]'))>0 and a.n>=least(9,jsonb_array_length(g.holes_meta))
 union all
 select 'round:'||r.id,r.user_id,r.group_id,null,(r.played_at at time zone 'America/New_York')::date,
 coalesce(r.finished_at,r.created_at),h.n,null::text
 from rounds r cross join lateral(select count(*)::int n from holes h where h.round_id=r.id and h.strokes>0) h
 where r.game_id is null and r.deleted_at is null and coalesce(r.status,'final')='final'
 and (r.played_at at time zone 'America/New_York')::date<=current_date and not public.is_test_group(r.group_id)
 and public.analytics_member_eligible(r.user_id)
 and (h.n>=9 or (r.gross_score>0 and h.n=0));
$$;

-- Keep aggregate lifecycle facts when an empty game is deleted. No score arrays,
-- names, course data or money are copied. Earlier deleted games cannot be backfilled.
create table public.analytics_game_lifecycle(
 game_id uuid primary key, group_id uuid references public.groups(id) on delete set null,
 organizer_id uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null, played_at date, game_type text, status text,
 ever_scored boolean not null default false, ended_at timestamptz, deleted_at timestamptz,
 excluded_test boolean not null default false, tracked_at timestamptz not null default now()
);
alter table public.analytics_game_lifecycle enable row level security;
revoke all on public.analytics_game_lifecycle from public,anon,authenticated;
grant select on public.analytics_game_lifecycle to authenticated;
create policy analytics_lifecycle_admin_read on public.analytics_game_lifecycle for select to authenticated using(public.is_admin());
insert into account_reference_columns(table_name,column_name,rule,activity,note) values
 ('analytics_game_lifecycle','organizer_id','move',false,'Aggregate game provenance; does not prevent removing an otherwise empty account') on conflict do nothing;

alter table public.activity_log add column details jsonb;
alter table archive.activity_log add column details jsonb;
create unique index analytics_event_retry_idx on public.activity_log(actor_id,action,(details->>'request_id'))
 where action in ('analytics_insights_open','analytics_ai_dashboard','analytics_ai_round','analytics_live_share');

create or replace function public.record_feature_use(p_feature text,p_event uuid default gen_random_uuid(),p_game uuid default null) returns void
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); gid uuid;
begin
 if not public.analytics_member_eligible(uid) then return; end if;
 if p_feature not in ('insights_open','ai_dashboard','ai_round','live_share') or p_event is null then raise exception 'Unknown analytics event' using errcode='22023'; end if;
 if p_feature='live_share' then
  select group_id into gid from games where id=p_game and (created_by=uid or public.is_admin()) and share_token is not null;
  if not found or public.is_test_group(gid) then return; end if;
 end if;
 insert into activity_log(actor_id,action,summary,group_id,details)
 values(uid,'analytics_'||p_feature,case p_feature when 'insights_open' then 'Opened scoring insights' when 'ai_dashboard' then 'Generated dashboard coaching' when 'ai_round' then 'Generated round coaching' else 'Enabled a live game link' end,gid,jsonb_build_object('request_id',p_event,'game_id',p_game)) on conflict do nothing;
end $$;
create or replace function public.guard_analytics_events() returns trigger
language plpgsql set search_path=public as $$
begin
 if current_user in ('anon','authenticated') and (new.action like 'analytics_%' or (tg_op='UPDATE' and old.action like 'analytics_%')) then raise exception 'Use the analytics event function' using errcode='42501'; end if;
 return new;
end $$;
create trigger guard_analytics_events before insert or update on public.activity_log for each row execute function public.guard_analytics_events();

create or replace function public.track_analytics_game() returns trigger
language plpgsql security definer set search_path=public as $$
declare g games%rowtype; occupied boolean;
begin
 g:=case when tg_op='DELETE' then old else new end;
 occupied:=case when tg_op='DELETE' then false else coalesce((public.stale_game_card_state(g.id)->>'occupied')::boolean,false) end;
 insert into analytics_game_lifecycle(game_id,group_id,organizer_id,created_at,played_at,game_type,status,ever_scored,ended_at,deleted_at,excluded_test)
 values(g.id,(select id from groups where id=g.group_id),(select id from profiles where id=g.created_by),g.created_at,g.played_at,g.game_type,g.status,occupied,g.ended_at,case when tg_op='DELETE' then now() end,
 public.is_test_group(g.group_id) or coalesce((select is_test from profiles where id=g.created_by),false))
 on conflict(game_id) do update set group_id=excluded.group_id,organizer_id=excluded.organizer_id,played_at=excluded.played_at,game_type=excluded.game_type,status=excluded.status,
 ever_scored=analytics_game_lifecycle.ever_scored or excluded.ever_scored,ended_at=coalesce(analytics_game_lifecycle.ended_at,excluded.ended_at),deleted_at=coalesce(analytics_game_lifecycle.deleted_at,excluded.deleted_at),excluded_test=analytics_game_lifecycle.excluded_test or excluded.excluded_test;
 if tg_op='UPDATE' and public.analytics_member_eligible(g.created_by) and not public.is_test_group(g.group_id) then
  if new.stale_review_notified_at is not null and new.stale_review_notified_at is distinct from old.stale_review_notified_at then
   insert into activity_log(actor_id,group_id,action,summary,details) values(g.created_by,g.group_id,'analytics_reminder_sent','Sent unfinished-game reminder',jsonb_build_object('game_id',g.id));
  elsif old.stale_review_notified_at is not null and new.last_score_change_at>old.last_score_change_at then
   insert into activity_log(actor_id,group_id,action,summary,details) values(g.created_by,g.group_id,'analytics_reminder_resumed','Scoring resumed after a reminder',jsonb_build_object('game_id',g.id));
  end if;
  if new.status='ended' and old.status is distinct from 'ended' and exists(select 1 from activity_log a where a.action='analytics_reminder_sent' and a.details->>'game_id'=g.id::text) then
   insert into activity_log(actor_id,group_id,action,summary,details) values(g.created_by,g.group_id,'analytics_reminder_completed','Completed game after a reminder',jsonb_build_object('game_id',g.id));
  end if;
 end if;
 return coalesce(new,old);
end $$;
create trigger track_analytics_game after insert or update or delete on public.games for each row execute function public.track_analytics_game();
insert into analytics_game_lifecycle(game_id,group_id,organizer_id,created_at,played_at,game_type,status,ever_scored,ended_at,excluded_test)
 select g.id,g.group_id,g.created_by,g.created_at,g.played_at,g.game_type,g.status,coalesce((public.stale_game_card_state(g.id)->>'occupied')::boolean,false),g.ended_at,
 public.is_test_group(g.group_id) or coalesce((select is_test from profiles where id=g.created_by),false) from games g;

create or replace function public.analytics_ratio(n bigint,d bigint) returns jsonb
language sql immutable set search_path=public as $$ select jsonb_build_object('n',n,'d',d,'pct',round(100.0*n/nullif(d,0))); $$;

create or replace function public.get_admin_analytics() returns jsonb
language plpgsql security definer set search_path=public set timezone='America/New_York' as $$
declare j jsonb;
begin
 if not public.is_admin() then raise exception 'admins only' using errcode='42501'; end if;
 with p as materialized(select * from profiles where public.analytics_member_eligible(id)),
 c as materialized(select * from public.analytics_participation()),
 l as materialized(select * from analytics_game_lifecycle where not excluded_test and not public.is_test_group(group_id) and (organizer_id is null or public.analytics_member_eligible(organizer_id))),
 da as materialized(select d.* from daily_active d join p on p.id=d.user_id where d.day<=current_date),
 q as(select
  count(distinct user_id) filter(where day=current_date) dau,
  count(distinct user_id) filter(where day>current_date-7) wau,
  count(distinct user_id) filter(where day>current_date-30) mau,
  coalesce(sum(opens) filter(where day=current_date),0) v1,
  coalesce(sum(opens) filter(where day>current_date-7),0) v7,
  coalesce(sum(opens) filter(where day>current_date-30),0) v30 from da),
 signup as(select p.id,p.created_at,
  (select count(*) from c where c.user_id=p.id and c.recorded_at>=p.created_at and c.recorded_at<=p.created_at+interval '7 days') first7,
  (select count(*) from c where c.user_id=p.id and c.recorded_at>=p.created_at and c.recorded_at<=p.created_at+interval '28 days') first28
  from p where p.created_at>=now()-interval '90 days'),
 cohort as(select public.analytics_ratio(count(*) filter(where first7>0 and created_at<=now()-interval '7 days'),count(*) filter(where created_at<=now()-interval '7 days')) activation,
  public.analytics_ratio(count(*) filter(where first28>=2 and created_at<=now()-interval '28 days'),count(*) filter(where created_at<=now()-interval '28 days')) second_round from signup),
 first_open as(select user_id,min(day) first_day from da group by user_id),
 retention as(select
  public.analytics_ratio(count(*) filter(where first_day between current_date-97 and current_date-7 and exists(select 1 from da x where x.user_id=f.user_id and x.day between f.first_day+1 and f.first_day+7)),count(*) filter(where first_day between current_date-97 and current_date-7)) w1,
  public.analytics_ratio(count(*) filter(where first_day between current_date-118 and current_date-28 and exists(select 1 from da x where x.user_id=f.user_id and x.day between f.first_day+22 and f.first_day+28)),count(*) filter(where first_day between current_date-118 and current_date-28)) w4 from first_open f),
 game_counts as(select count(*) created,count(*) filter(where status='ended') ended,
  count(*) filter(where status is distinct from 'ended' and (deleted_at is not null or exists(select 1 from games g where g.id=l.game_id and coalesce(g.played_at,current_date)<=current_date and
   ((coalesce((public.stale_game_card_state(g.id)->>'occupied')::boolean,false) and g.last_score_change_at<=now()-interval '48 hours') or
    (not coalesce((public.stale_game_card_state(g.id)->>'occupied')::boolean,false) and current_date>=greatest((g.created_at at time zone 'America/New_York')::date,coalesce(g.played_at,(g.created_at at time zone 'America/New_York')::date))+7))))) abandoned from l),
 round_counts as(select count(*) done from c),
 unfinished as(select count(*) n from rounds r join p on p.id=r.user_id where r.game_id is null and r.deleted_at is null and r.status='in_progress' and not public.is_test_group(r.group_id)),
 clubs as(select group_id,count(distinct game_id) n from c where game_id is not null and group_id is not null and played_at>current_date-90 group by group_id),
 features as(select a.* from activity_log a join p on p.id=a.actor_id where a.action like 'analytics_%' and a.created_at>now()-interval '90 days' and not public.is_test_group(a.group_id)),
 feature_users as(select action,actor_id,min(created_at) first_at,count(*) filter(where created_at>now()-interval '30 days') uses from features group by action,actor_id),
 feature_stats as(select action,sum(uses) uses,count(*) filter(where uses>0) users,count(*) filter(where uses>=2) repeat_users,
  public.analytics_ratio(count(*) filter(where first_at<=now()-interval '28 days' and exists(select 1 from da where da.user_id=f.actor_id and da.day>(f.first_at at time zone 'America/New_York')::date and da.day<=(f.first_at at time zone 'America/New_York')::date+28)),count(*) filter(where first_at<=now()-interval '28 days')) returned
  from feature_users f group by action),
 reminders as(select distinct details->>'game_id' game from features where action='analytics_reminder_sent')
 select jsonb_build_object(
 'generated_at',now(),
 'totals',jsonb_build_object('users',(select count(*) from p),'users_new_30d',(select count(*) from p where created_at>now()-interval '30 days'),
 'active_groups',(select count(distinct group_id) from c where played_at>current_date-30),'games',gc.created,
 'games_30d',(select count(*) from l where created_at>now()-interval '30 days'),'rounds',rc.done,'rounds_started',u.n,
 'rounds_30d',(select count(*) from c where played_at>current_date-30),'rounds_per_active_user',round((select count(*)::numeric from c where played_at>current_date-30)/nullif(q.mau,0),1)),
 'active',jsonb_build_object('dau',q.dau,'wau',q.wau,'mau',q.mau,'views_today',q.v1,'views_7d',q.v7,'views_30d',q.v30,
 'avg7',(select round(count(*)::numeric/7,1) from da where day>current_date-7),'avg30',(select round(count(*)::numeric/30,1) from da where day>current_date-30),
 'stickiness_pct',round(100.0*q.dau/nullif(q.mau,0)),
 'churn_30d',(select count(*) from first_open f where not exists(select 1 from da where user_id=f.user_id and day>current_date-30) and exists(select 1 from da where user_id=f.user_id and day between current_date-60 and current_date-31)),
 'series',(select jsonb_agg(jsonb_build_object('day',d::date,'n',(select count(distinct user_id) from da where day=d::date)) order by d) from generate_series(current_date-29,current_date,interval '1 day')d)),
 'formats',coalesce((select jsonb_object_agg(game_type,n) from(select game_type,count(distinct game_id) n from c where game_id is not null group by game_type)s),'{}'),
 'features',jsonb_build_object('avatars_set',(select count(*) from p where coalesce(avatar_url,'')<>''),'ai_summaries',(select count(*) from p where dashboard_ai is not null),
 'live_shared',(select count(*) from games where share_token is not null and not public.is_test_group(group_id) and public.analytics_member_eligible(created_by)),
 'courses_added_30d',(select count(*) from favorite_courses f where f.created_at>now()-interval '30 days' and not coalesce(f.deleted,false) and public.analytics_member_eligible(f.user_id))),
 'health',jsonb_build_object('completion_pct',round(100.0*gc.ended/nullif(gc.created,0)),'round_completion_pct',round(100.0*rc.done/nullif(rc.done+u.n,0)),
 'abandoned_pct',round(100.0*gc.abandoned/nullif(gc.created,0)),'avg_holes',(select round(avg(holes),1) from c where game_id is not null),
 'activated_7d_pct',cohort.activation->'pct','activation_cohort',cohort.activation,'second_round_cohort',cohort.second_round,
 'retention_w1_pct',retention.w1->'pct','retention_w4_pct',retention.w4->'pct','retention_w1',retention.w1,'retention_w4',retention.w4,
 'never_joined_group_pct',(select round(100.0*count(*) filter(where not exists(select 1 from group_members m where m.user_id=p.id and m.status='active' and not public.is_test_group(m.group_id)))/nullif(count(*),0)) from p)),
 'engagement',jsonb_build_object(
 'tee_times_30d',(select count(*) from tee_times t where t.created_at>now()-interval '30 days' and public.analytics_member_eligible(t.created_by) and not public.is_test_group(t.group_id)),
 'tee_rsvps_30d',(select count(*) from tee_time_rsvps v join tee_times t on t.id=v.tee_time_id where t.created_at>now()-interval '30 days' and public.analytics_member_eligible(v.user_id) and not public.is_test_group(t.group_id)),
 'bets_posted',(select count(*) from expenses e where e.source_kind='tgc_bet' and not public.is_test_group(e.group_id) and public.analytics_member_eligible(e.created_by)),
 'bets_30d',(select count(*) from expenses e where e.source_kind='tgc_bet' and e.created_at>now()-interval '30 days' and not public.is_test_group(e.group_id) and public.analytics_member_eligible(e.created_by)),
 'settled_cents',(select coalesce(sum(amount_cents),0) from settlements s where s.status='confirmed' and not public.is_test_group(s.group_id) and public.analytics_member_eligible(s.from_user_id) and public.analytics_member_eligible(s.to_user_id)),
 'invites_created_30d',(select count(*) from group_invites i where i.created_at>now()-interval '30 days' and public.analytics_member_eligible(i.created_by) and not public.is_test_group(i.group_id)),
 'joins_via_invite',(select coalesce(sum(use_count),0) from group_invites i where public.analytics_member_eligible(i.created_by) and not public.is_test_group(i.group_id)),
 'group_scoring_pct',(select round(100.0*count(*) filter(where g.marker_user_id is not null or exists(select 1 from game_players gp where gp.game_id=g.id and gp.is_marker))/nullif(count(*),0)) from games g where not public.is_test_group(g.group_id) and public.analytics_member_eligible(g.created_by))),
 'funnels',jsonb_build_object('repeat_clubs',public.analytics_ratio((select count(*) from clubs where n>=2),(select count(*) from clubs)),
 'formats',coalesce((select jsonb_agg(to_jsonb(s)) from(select game_type,count(*) players,count(*) filter(where n>=2) repeat_players from(select game_type,user_id,count(distinct game_id)n from c where game_id is not null and played_at>current_date-90 group by game_type,user_id)x group by game_type)s),'[]'),
 'reminders',jsonb_build_object('sent',(select count(*) from reminders),'resumed',(select count(*) from reminders r where exists(select 1 from features f where f.action='analytics_reminder_resumed' and f.details->>'game_id'=r.game)),
 'completed',(select count(*) from reminders r where exists(select 1 from features f where f.action='analytics_reminder_completed' and f.details->>'game_id'=r.game))),
 'feature_use',coalesce((select jsonb_agg(to_jsonb(s)) from feature_stats s where action in('analytics_insights_open','analytics_ai_dashboard','analytics_ai_round','analytics_live_share')),'[]')),
 'quality',jsonb_build_object('tracking_since',(select min(tracked_at) from analytics_game_lifecycle),'lifecycle_note','Game counts include records present when tracking began and subsequent games, including deleted drafts. Earlier deleted games cannot be reconstructed.','feature_note','Feature observations start with this release. They measure observed actions; they are not inferred from saved settings. Return cohorts need 28 days.')) into j
 from q cross join cohort cross join retention cross join game_counts gc cross join round_counts rc cross join unfinished u;
 return j;
end $$;

create or replace function public.get_admin_engagement() returns jsonb
language plpgsql security definer set search_path=public set timezone='America/New_York' as $$
declare j jsonb;
begin
 if not public.is_admin() then raise exception 'admins only' using errcode='42501'; end if;
 with c as materialized(select * from public.analytics_participation()),
 first_week as(select user_id,date_trunc('week',min(played_at))::date wk from c group by user_id),
 weeks as(select generate_series(date_trunc('week',current_date)-interval '11 weeks',date_trunc('week',current_date),interval '1 week')::date wk),
 counts as(select count(distinct user_id) filter(where played_at>current_date-7) w,count(distinct user_id) filter(where played_at>current_date-30)m,
 count(distinct user_id) filter(where played_at>current_date-28)a,count(*) filter(where played_at>current_date-28)r from c)
 select jsonb_build_object('generated_at',now(),'wau',w,'mau',m,'wau_mau_pct',round(100.0*w/nullif(m,0)),
 'active_28d',a,'rounds_28d',r,'rounds_per_active_mo',round(r::numeric/nullif(a,0),1),
 'weekend_share_pct',(select round(100.0*count(*) filter(where extract(dow from played_at) in(5,6,0))/nullif(count(*),0)) from c where played_at>current_date-90),
 'weekend_series',(select jsonb_agg(jsonb_build_object('week',wk::text,'golfers',(select count(distinct user_id) from c where played_at between wk and wk+6 and extract(dow from played_at)in(5,6,0)),
 'rounds',(select count(*) from c where played_at between wk and wk+6 and extract(dow from played_at)in(5,6,0))) order by wk) from weeks),
 'weekly_new_returning',(select jsonb_agg(jsonb_build_object('week',wk::text,
 'new',(select count(distinct c.user_id) from c join first_week f using(user_id) where c.played_at between weeks.wk and weeks.wk+6 and f.wk=weeks.wk),
 'returning',(select count(distinct c.user_id) from c join first_week f using(user_id) where c.played_at between weeks.wk and weeks.wk+6 and f.wk<weeks.wk)) order by wk) from weeks),
 'feature',jsonb_build_object('in_game',(select count(*) from c where game_id is not null and played_at>current_date-90),'solo',(select count(*) from c where game_id is null and played_at>current_date-90))) into j from counts;
 return j;
end $$;

create or replace function public.get_power_users(p_days integer default null)
returns table(user_id uuid,display_name text,completed_rounds int,unfinished_rounds int,deleted_rounds int,games_played int,active_days int,total_opens int,completion_pct int,last_active date,days_since_active int,churned boolean,friction boolean,score numeric)
language sql security definer set search_path=public set timezone='America/New_York' as $$
 with p as(select * from profiles where public.is_admin() and public.analytics_member_eligible(id)),
 c as materialized(select * from public.analytics_participation() where p_days is null or played_at>current_date-greatest(p_days,1)),
 rc as(select user_id,count(*) done,count(distinct game_id) games from c group by user_id),
 unfinished as(select r.user_id,count(*) n from rounds r where r.game_id is null and r.deleted_at is null and r.status='in_progress' and not public.is_test_group(r.group_id)
 and (p_days is null or r.created_at>now()-make_interval(days=>greatest(p_days,1))) group by user_id),
 deleted as(select r.user_id,count(*) n from rounds r where r.deleted_at is not null and not public.is_test_group(r.group_id) and (p_days is null or r.created_at>now()-make_interval(days=>greatest(p_days,1))) group by user_id),
 da as(select user_id,count(*) n,sum(opens)o,max(day)last_day from daily_active where day<=current_date and (p_days is null or day>current_date-greatest(p_days,1)) group by user_id),
 last_seen as(select user_id,max(day)d from daily_active where day<=current_date group by user_id)
 select p.id,p.display_name,coalesce(rc.done,0)::int,coalesce(u.n,0)::int,coalesce(d.n,0)::int,coalesce(rc.games,0)::int,coalesce(da.n,0)::int,coalesce(da.o,0)::int,
 round(100.0*coalesce(rc.done,0)/nullif(coalesce(rc.done,0)+coalesce(u.n,0),0))::int,
 ls.d,current_date-ls.d,ls.d is null or current_date-ls.d>30,false,
 (coalesce(rc.done,0)*4+coalesce(rc.games,0)*2+coalesce(da.n,0)+coalesce(da.o,0)*0.1)::numeric as score
 from p left join rc on rc.user_id=p.id left join unfinished u on u.user_id=p.id left join deleted d on d.user_id=p.id left join da on da.user_id=p.id left join last_seen ls on ls.user_id=p.id
 order by score desc,p.id limit 25;
$$;

create or replace function public.admin_push_device_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then jsonb_build_object(
    'failing_endpoints', (select count(*) from push_subscriptions s where public.analytics_member_eligible(s.user_id) and (s.disabled or s.fail_count >= 3)),
    'failing_users',     (select count(distinct s.user_id) from push_subscriptions s where public.analytics_member_eligible(s.user_id) and (s.disabled or s.fail_count >= 3)),
    'dormant_endpoints', (select count(*) from push_subscriptions s where public.analytics_member_eligible(s.user_id) and not s.disabled and s.fail_count < 3 and s.last_seen < now() - interval '14 days'),
    'dormant_users',     (select count(distinct s.user_id) from push_subscriptions s where public.analytics_member_eligible(s.user_id) and not s.disabled and s.fail_count < 3 and s.last_seen < now() - interval '14 days'
                           and not exists (select 1 from push_subscriptions h where h.user_id = s.user_id and not h.disabled and h.fail_count < 3 and h.last_seen >= now() - interval '14 days')),
    'prune_after_days', 60
  ) else '{}'::jsonb end;
$$;
revoke all on function public.admin_push_device_stats() from public, anon;
grant execute on function public.admin_push_device_stats() to authenticated;

-- Same row shape as admin_stat_users so the existing drawer renders it.
create or replace function public.admin_push_devices(p_kind text)
returns table (name text, detail text, tag text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select coalesce(p.display_name, '(no name)'),
         coalesce(s.platform, '?') || ' · ' ||
         case when s.user_agent ~ 'iPhone' then 'iPhone' || coalesce(' iOS ' || replace((regexp_match(s.user_agent, 'OS (\d+_\d+)'))[1], '_', '.'), '')
              when s.user_agent ~ 'Android' then 'Android'
              when s.user_agent ~ 'Macintosh' then 'Mac'
              when s.user_agent ~ 'Windows' then 'Windows'
              else coalesce(left(s.user_agent, 24), 'unknown device') end ||
         ' · enrolled ' || to_char(s.created_at at time zone 'America/New_York', 'Mon DD') || ' · last seen ' || to_char(s.last_seen at time zone 'America/New_York', 'Mon DD') ||
         case when s.fail_count > 0 then ' · fails ' || s.fail_count else '' end ||
         case when s.disabled then ' · disabled' else '' end ||
         case when exists (select 1 from push_subscriptions h where h.user_id = s.user_id and h.id <> s.id and not h.disabled and h.last_seen >= now() - interval '14 days')
              then ' · has a current device' else '' end,
         case when p_kind = 'push_failing' then 'failing' else 'dormant' end,
         p.avatar_url
    from push_subscriptions s
    join profiles p on p.id = s.user_id
   where public.is_admin() and public.analytics_member_eligible(p.id)
     and case when p_kind = 'push_failing' then (s.disabled or s.fail_count >= 3)
              else (not s.disabled and s.fail_count < 3 and s.last_seen < now() - interval '14 days') end
   order by s.last_seen asc;
$$;
revoke all on function public.admin_push_devices(text) from public, anon;
grant execute on function public.admin_push_devices(text) to authenticated;

create or replace function public.get_admin_extra_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare j jsonb;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select jsonb_build_object(
    'installed', (select count(*) from profiles p where public.analytics_member_eligible(p.id) and p.last_standalone is true),
    'browser',   (select count(*) from profiles p where public.analytics_member_eligible(p.id) and p.last_standalone is false),
    'platform_unknown', (select count(*) from profiles p where public.analytics_member_eligible(p.id) and p.last_standalone is null),
    'notif_on',  (select count(*) from profiles p where public.analytics_member_eligible(p.id) and exists (select 1 from push_subscriptions s where s.user_id=p.id and s.disabled=false)),
    'notif_off', (select count(*) from profiles p where public.analytics_member_eligible(p.id) and not exists (select 1 from push_subscriptions s where s.user_id=p.id and s.disabled=false)),
    'failing_subs', (select count(distinct s.user_id) from push_subscriptions s where public.analytics_member_eligible(s.user_id) and (s.disabled=true or s.fail_count >= 3 or s.last_seen < now() - interval '14 days')),
    'share_on',  (select count(*) from profiles p where public.analytics_member_eligible(p.id) and coalesce(p.show_card,true)=true),
    'share_off', (select count(*) from profiles p where public.analytics_member_eligible(p.id) and coalesce(p.show_card,true)=false),
    'guests', (select count(*) from game_players gp join games g on g.id=gp.game_id where gp.guest_of is not null and not coalesce(gp.no_show,false) and g.status='ended' and g.played_at<=current_date and not public.is_test_group(g.group_id) and public.analytics_member_eligible(gp.guest_of) and jsonb_array_length(g.holes_meta)>0 and public.analytics_player_holes(g.id,gp.id::text,gp.scores)>=least(9,jsonb_array_length(g.holes_meta))),
    'guest_hosts', (select count(distinct guest_of) from game_players gp join games g on g.id=gp.game_id where gp.guest_of is not null and not coalesce(gp.no_show,false) and g.status='ended' and g.played_at<=current_date and not public.is_test_group(g.group_id) and public.analytics_member_eligible(gp.guest_of) and jsonb_array_length(g.holes_meta)>0 and public.analytics_player_holes(g.id,gp.id::text,gp.scores)>=least(9,jsonb_array_length(g.holes_meta))),
    'mutes', (
      select coalesce(jsonb_object_agg(k, c), '{}'::jsonb)
      from (
        select kv.key as k, count(*) c
        from profiles p
        cross join lateral jsonb_each_text(coalesce(p.push_prefs, '{}'::jsonb)) kv
        where public.analytics_member_eligible(p.id) and kv.value = 'off'
        group by kv.key
      ) m
    )
  ) into j;
  return j || jsonb_build_object('generated_at',now(),'push',public.admin_push_device_stats());
end;
$function$;
grant execute on function public.get_admin_extra_stats() to authenticated;

create or replace function public.admin_stat_users(
  p_stat text,
  p_arg text default null,
  p_date date default null
)
returns table(name text, detail text, tag text, avatar_url text)
language plpgsql
security definer
set search_path = public
as $function$
declare
  d date := coalesce(p_date, current_date);
begin
  if not public.is_admin() then raise exception 'admins only'; end if;

  if p_stat = 'users_total' then
    return query select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), null::text
     , p.avatar_url from profiles p where public.analytics_member_eligible(p.id)
      order by p.display_name nulls last;

  elsif p_stat = 'users_new_30d' then
    return query select coalesce(p.display_name,'(no name)'),'Joined '||to_char(p.created_at at time zone 'America/New_York','Mon DD'),'new'::text,p.avatar_url
    from profiles p where public.analytics_member_eligible(p.id) and p.created_at>now()-interval '30 days' order by p.created_at desc;

  elsif p_stat = 'active_dau' then
    return query select coalesce(p.display_name,'(no name)'), da.opens||' opens today', null::text
     , p.avatar_url from profiles p join daily_active da on da.user_id=p.id and da.day=current_date
      where public.analytics_member_eligible(p.id) order by da.opens desc;

  elsif p_stat in ('active_wau','active_mau') then
    return query select coalesce(p.display_name,'(no name)'), sum(da.opens)::text||' opens', null::text
     , p.avatar_url from profiles p join daily_active da on da.user_id=p.id
      where public.analytics_member_eligible(p.id)
        and da.day<=current_date and da.day > current_date - (case p_stat when 'active_wau' then 7 else 30 end)
      group by p.id, p.display_name order by sum(da.opens) desc;

  elsif p_stat = 'lapsed' then
    return query select coalesce(p.display_name,'(no name)'), 'last seen '||to_char(mx.last_day,'Mon DD'), 'lapsed'::text
     , p.avatar_url from profiles p join (select user_id, max(day) last_day from daily_active where day<=current_date group by user_id) mx on mx.user_id=p.id
      where public.analytics_member_eligible(p.id)
        and mx.last_day between current_date - 60 and current_date - 31 order by mx.last_day desc;

  elsif p_stat = 'never_joined_group' then
    return query select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), 'no club'::text
     , p.avatar_url from profiles p where public.analytics_member_eligible(p.id)
        and not exists (select 1 from group_members gm where gm.user_id=p.id and gm.status='active' and not public.is_test_group(gm.group_id))
      order by p.display_name nulls last;

  elsif p_stat = 'rounds_done' then
    return query select coalesce(p.display_name,'(no name)'),count(*)::text||' qualifying rounds',null::text,p.avatar_url
    from public.analytics_participation() c join profiles p on p.id=c.user_id group by p.id,p.display_name,p.avatar_url order by count(*) desc;

  elsif p_stat = 'rounds_started' then
    return query select coalesce(p.display_name,'(no name)'), count(*)::text||' in progress', 'open'::text
     , p.avatar_url from profiles p join rounds r on r.user_id=p.id
      where public.analytics_member_eligible(p.id)
        and r.game_id is null and not public.is_test_group(r.group_id) and r.deleted_at is null and coalesce(r.status,'final')='in_progress'
      group by p.id, p.display_name order by count(*) desc;

  elsif p_stat = 'unfinished' then
    return query select coalesce(p.display_name,'(no name)'),count(*)::text||' unfinished personal rounds','open'::text,p.avatar_url
    from profiles p join rounds r on r.user_id=p.id where public.analytics_member_eligible(p.id)
      and r.game_id is null and r.deleted_at is null and r.status='in_progress' and not public.is_test_group(r.group_id)
    group by p.id,p.display_name,p.avatar_url order by count(*) desc;

  elsif p_stat = 'rounds_day' then
    return query select coalesce(p.display_name,'(no name)')||' · '||coalesce(r.course,'course'),
        (select count(*) from holes h where h.round_id=r.id and h.strokes is not null)::text||' holes'
          || case when r.gross_score is not null then ' · gross '||r.gross_score::text else '' end,
        case when r.deleted_at is not null then 'deleted'
             when coalesce(r.status,'final')='in_progress' then 'in progress'
             when r.finished_by='system:auto' then 'auto-finished' else 'completed' end
     , p.avatar_url from rounds r join profiles p on p.id=r.user_id where public.analytics_member_eligible(p.id) and not public.is_test_group(r.group_id) and (r.played_at at time zone 'America/New_York')::date = d order by r.created_at;

  elsif p_stat = 'active_day' then
    return query select coalesce(p.display_name,'(no name)'), da.opens||' opens', null::text
     , p.avatar_url from daily_active da join profiles p on p.id=da.user_id
      where da.day = d and public.analytics_member_eligible(p.id) order by da.opens desc;

  elsif p_stat = 'installed' then
    return query select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), 'installed'::text
     , p.avatar_url from profiles p where public.analytics_member_eligible(p.id) and p.last_standalone is true
      order by p.display_name nulls last;

  elsif p_stat = 'browser' then
    return query select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), 'browser'::text
     , p.avatar_url from profiles p where public.analytics_member_eligible(p.id) and p.last_standalone is false
      order by p.display_name nulls last;

  elsif p_stat = 'notif_on' then
    return query select coalesce(p.display_name,'(no name)'), 'push enabled', 'on'::text
     , p.avatar_url from profiles p where public.analytics_member_eligible(p.id)
        and exists (select 1 from push_subscriptions s where s.user_id=p.id and s.disabled=false)
      order by p.display_name nulls last;

  elsif p_stat = 'notif_off' then
    return query select coalesce(p.display_name,'(no name)'), 'no active device', 'off'::text
     , p.avatar_url from profiles p where public.analytics_member_eligible(p.id)
        and not exists (select 1 from push_subscriptions s where s.user_id=p.id and s.disabled=false)
      order by p.display_name nulls last;

  elsif p_stat = 'failing_subs' then
    return query select coalesce(p.display_name,'(no name)'),
        'fails '||max(s.fail_count)::text||' · last seen '||to_char(max(s.last_seen),'Mon DD'), 'stale'::text
     , p.avatar_url from push_subscriptions s join profiles p on p.id=s.user_id
      where public.analytics_member_eligible(s.user_id) and (s.disabled=true or s.fail_count >= 3 or s.last_seen < now() - interval '14 days')
      group by p.id, p.display_name order by max(s.fail_count) desc nulls last;

  elsif p_stat = 'mute' and p_arg is not null then
    return query select coalesce(p.display_name,'(no name)'), 'set to Off', 'muted'::text
     , p.avatar_url from profiles p where public.analytics_member_eligible(p.id)
        and (p.push_prefs->>p_arg) = 'off'
      order by p.display_name nulls last;

  elsif p_stat = 'share_on' then
    return query select coalesce(p.display_name,'(no name)'), 'card visible', 'on'::text
     , p.avatar_url from profiles p where public.analytics_member_eligible(p.id) and coalesce(p.show_card,true)=true
      order by p.display_name nulls last;

  elsif p_stat = 'share_off' then
    return query select coalesce(p.display_name,'(no name)'), 'opted out', 'off'::text
     , p.avatar_url from profiles p where public.analytics_member_eligible(p.id) and coalesce(p.show_card,true)=false
      order by p.display_name nulls last;

  elsif p_stat = 'guests' then
    return query select coalesce(host.display_name,'(no name)'), count(*)::text||' guest rounds hosted', 'host'::text
     , host.avatar_url from game_players gp join profiles host on host.id = gp.guest_of
      where gp.guest_of is not null and public.analytics_member_eligible(host.id) and not coalesce(gp.no_show,false) and exists(select 1 from games g where g.id=gp.game_id and g.status='ended' and g.played_at<=current_date and not public.is_test_group(g.group_id) and jsonb_array_length(g.holes_meta)>0 and public.analytics_player_holes(g.id,gp.id::text,gp.scores)>=least(9,jsonb_array_length(g.holes_meta))) group by host.id, host.display_name order by count(*) desc;

  elsif p_stat = 'avatars_set' then
    return query select coalesce(p.display_name,'(no name)'), 'has avatar', null::text
     , p.avatar_url from profiles p where public.analytics_member_eligible(p.id)
        and p.avatar_url is not null and p.avatar_url <> '' order by p.display_name nulls last;

  elsif p_stat = 'ai_summaries' then
    return query select coalesce(p.display_name,'(no name)'), 'has AI summary', null::text
     , p.avatar_url from profiles p where public.analytics_member_eligible(p.id)
        and p.dashboard_ai is not null order by p.display_name nulls last;

  end if;
  return;
end;
$function$;
alter function public.admin_stat_users(text, text, date) set timezone = 'America/New_York';
grant execute on function public.admin_stat_users(text, text, date) to authenticated;

create or replace function public.run_log_retention()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_notif int; n_act int; n_round int; n_team int; n_club int;
begin
  with m as (delete from public.notifications where created_at < now() - interval '90 days' returning *)
    insert into archive.notifications select m.*, now() from m;
  get diagnostics n_notif = row_count;
  with m as (delete from public.activity_log where created_at < now() - interval '1 year' returning *)
    insert into archive.activity_log(id,actor_id,actor_name,action,summary,group_id,target_user_id,created_at,details,archived_at)
    select m.id,m.actor_id,m.actor_name,m.action,m.summary,m.group_id,m.target_user_id,m.created_at,m.details,now() from m;
  get diagnostics n_act = row_count;
  with m as (delete from public.round_email_log where at < now() - interval '1 year' returning *)
    insert into archive.round_email_log select m.*, now() from m;
  get diagnostics n_round = row_count;
  with m as (delete from public.team_round_email_log where at < now() - interval '1 year' returning *)
    insert into archive.team_round_email_log select m.*, now() from m;
  get diagnostics n_team = row_count;
  with m as (delete from public.club_report_email_log where at < now() - interval '1 year' returning *)
    insert into archive.club_report_email_log select m.*, now() from m;
  get diagnostics n_club = row_count;
  return jsonb_build_object('notifications', n_notif, 'activity_log', n_act, 'round_email_log', n_round, 'team_round_email_log', n_team, 'club_report_email_log', n_club);
end $$;

revoke all on function public.analytics_member_eligible(uuid),public.analytics_player_holes(uuid,text,jsonb),public.analytics_participation(),public.analytics_ratio(bigint,bigint),public.record_feature_use(text,uuid,uuid),public.guard_analytics_events(),public.track_analytics_game() from public,anon,authenticated;
grant execute on function public.record_feature_use(text,uuid,uuid) to authenticated;
alter function public.get_admin_extra_stats() set timezone='America/New_York';
select public.record_migration('0235_analytics_quality');
commit;
