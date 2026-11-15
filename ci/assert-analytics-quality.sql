-- Disposable full-chain assertions; all fixtures, events and ledger writes roll back.
begin;
create temp table analytics_before as select public.get_admin_analytics() metrics where false;
insert into auth.users(id) values('23500000-0000-0000-0000-000000000001'),('23500000-0000-0000-0000-000000000002'),('23500000-0000-0000-0000-000000000003');
insert into profiles(id,display_name,account_status,is_admin,is_test,created_at) values
 ('23500000-0000-0000-0000-000000000001','Analytics admin','active',true,false,now()-interval '45 days'),
 ('23500000-0000-0000-0000-000000000002','Analytics member','active',false,false,now()-interval '45 days'),
 ('23500000-0000-0000-0000-000000000003','Analytics test','active',false,true,now()-interval '45 days') on conflict(id) do nothing;
insert into groups(id,name,is_test) values('23500000-0000-0000-0000-000000000010','Analytics club',false),('23500000-0000-0000-0000-000000000011','Analytics test club',true);
insert into group_members(group_id,user_id,email,role,status) select '23500000-0000-0000-0000-000000000010',id,id||'@example.invalid','member','active' from profiles where id in('23500000-0000-0000-0000-000000000001','23500000-0000-0000-0000-000000000002');
create function pg_temp.analytics_game(gid uuid,status_name text default 'active',kind text default 'stroke',club uuid default '23500000-0000-0000-0000-000000000010') returns void language plpgsql as $$begin
 insert into games(id,code,name,course,group_id,created_by,played_at,status,game_type,course_par,holes_meta)
 select gid,substring(replace(gid::text,'-',''),1,6),'Analytics fixture','Course',club,'23500000-0000-0000-0000-000000000001',current_date-1,status_name,kind,72,jsonb_agg(jsonb_build_object('n',n,'par',4,'si',n)) from generate_series(1,18)n;
end $$;
create function pg_temp.analytics_player(gid uuid,uid uuid) returns void language plpgsql as $$begin
 insert into game_players(game_id,user_id,display_name,scores) values(gid,uid,'Analytics player','[4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4]');
end $$;
select pg_temp.analytics_game('23500000-0000-0000-0000-000000000020');
select pg_temp.analytics_game('23500000-0000-0000-0000-000000000021','ended');
select pg_temp.analytics_player('23500000-0000-0000-0000-000000000021','23500000-0000-0000-0000-000000000001');
select pg_temp.analytics_player('23500000-0000-0000-0000-000000000021','23500000-0000-0000-0000-000000000002');
select pg_temp.analytics_player('23500000-0000-0000-0000-000000000021','23500000-0000-0000-0000-000000000003');
select pg_temp.analytics_game('23500000-0000-0000-0000-000000000022','ended','stroke','23500000-0000-0000-0000-000000000011');
select pg_temp.analytics_player('23500000-0000-0000-0000-000000000022','23500000-0000-0000-0000-000000000001');
select pg_temp.analytics_game('23500000-0000-0000-0000-000000000023','ended','scramble');
select pg_temp.analytics_player('23500000-0000-0000-0000-000000000023','23500000-0000-0000-0000-000000000001');
select pg_temp.analytics_player('23500000-0000-0000-0000-000000000023','23500000-0000-0000-0000-000000000002');
update games set foursomes='[{"id":"side","a":["23500000-0000-0000-0000-000000000001","23500000-0000-0000-0000-000000000002"],"b":[]}]' where id='23500000-0000-0000-0000-000000000023';
update game_players set scores='[]' where game_id='23500000-0000-0000-0000-000000000023';
insert into game_alt_shot_scores(game_id,foursome_id,side,hole_index,strokes) select '23500000-0000-0000-0000-000000000023','side','a',i,4 from generate_series(0,17)i;
select pg_temp.analytics_game('23500000-0000-0000-0000-000000000024','ended');
update games set played_at=current_date+1 where id='23500000-0000-0000-0000-000000000024';
select pg_temp.analytics_player('23500000-0000-0000-0000-000000000024','23500000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','23500000-0000-0000-0000-000000000001',true);
do $$declare m jsonb; n integer; before_count integer; begin
 select count(*) into n from public.analytics_participation() where user_id='23500000-0000-0000-0000-000000000001';
 if n<>2 then raise exception 'FAIL: normal/team participation or Test/future exclusion: %',n; end if;
 if exists(select 1 from public.analytics_participation() where user_id='23500000-0000-0000-0000-000000000003') then raise exception 'FAIL: test account in golf cadence'; end if;
 m:=public.get_admin_analytics(); before_count:=(m#>>'{totals,games}')::int;
 delete from games where id='23500000-0000-0000-0000-000000000020';
 m:=public.get_admin_analytics();
 if (m#>>'{totals,games}')::int is distinct from before_count then raise exception 'FAIL: empty cleanup changed historical game denominator'; end if;
 if not exists(select 1 from analytics_game_lifecycle where game_id='23500000-0000-0000-0000-000000000020' and deleted_at is not null) then raise exception 'FAIL: lifecycle evidence missing'; end if;
 if public.get_admin_engagement() is null or public.get_admin_extra_stats() is null then raise exception 'FAIL: admin aggregate absent'; end if;
 if not exists(select 1 from public.get_power_users(null) where user_id='23500000-0000-0000-0000-000000000001' and games_played=2) then raise exception 'FAIL: power users counts roster rows rather than qualifying games'; end if;
 if not exists(select 1 from public.admin_stat_users('rounds_done') where name='Analytics admin' and detail='2 qualifying rounds') then raise exception 'FAIL: summary/drill participation mismatch'; end if;
end $$;
-- Real member privileges: the event API works; private helpers stay private by catalogue.
select set_config('request.jwt.claim.sub','23500000-0000-0000-0000-000000000002',true);
set local role authenticated;
select public.record_feature_use('insights_open','23500000-0000-0000-0000-000000000090');
select public.record_feature_use('insights_open','23500000-0000-0000-0000-000000000090');
do $$declare denied boolean:=false; begin
 if has_function_privilege(current_user,'public.analytics_participation()','execute') then raise exception 'FAIL: member sees private global participation'; end if;
 if exists(select 1 from analytics_game_lifecycle) then raise exception 'FAIL: member sees lifecycle ledger'; end if;
 begin perform public.get_admin_analytics(); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: nonadmin sees aggregate'; end if;
 begin insert into activity_log(actor_id,action,summary,details) values(auth.uid(),'analytics_ai_round','spoof','{}'); raise exception 'FAIL: direct event forgery accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','23500000-0000-0000-0000-000000000001',true);
do $$declare m jsonb; n int; begin
 select count(*) into n from activity_log where actor_id='23500000-0000-0000-0000-000000000002' and action='analytics_insights_open';
 if n<>1 then raise exception 'FAIL: feature retry counted twice'; end if;
 m:=public.get_admin_analytics();
 if not exists(select 1 from jsonb_array_elements(m#>'{funnels,feature_use}') f where f->>'action'='analytics_insights_open' and (f->>'uses')::int=1 and (f->>'users')::int=1) then raise exception 'FAIL: feature use missing'; end if;
 -- Real reminder transitions; saved scores and posting are untouched by analytics.
 update games set stale_review_notified_at=now() where id='23500000-0000-0000-0000-000000000021';
 update games set last_score_change_at=now()+interval '1 second',stale_review_notified_at=null where id='23500000-0000-0000-0000-000000000021';
 if not exists(select 1 from activity_log where action='analytics_reminder_resumed' and details->>'game_id'='23500000-0000-0000-0000-000000000021') then raise exception 'FAIL: reminder outcome missing'; end if;
 insert into activity_log(actor_id,action,summary,details,created_at) values('23500000-0000-0000-0000-000000000001','analytics_insights_open','Archive fixture','{"request_id":"archive"}',now()-interval '400 days');
 perform public.run_log_retention();
 if not exists(select 1 from archive.activity_log where summary='Archive fixture' and details->>'request_id'='archive') then raise exception 'FAIL: analytics metadata lost during retention'; end if;
 raise notice 'ANALYTICS_QUALITY_PASS populations, shared participation, cleanup-stable totals, real RLS/ACL, event retry/spoof guards, reminder outcomes, retention';
end $$;
-- Cohorts: a signup with only six days of opportunity cannot enter the seven-day denominator.
do $$declare before_m jsonb; after_m jsonb; uid uuid:='23500000-0000-0000-0000-000000000004'; begin
 before_m:=public.get_admin_analytics();
 insert into auth.users(id) values(uid);
 insert into profiles(id,display_name,account_status,created_at) values(uid,'Young cohort','active',now()-interval '6 days');
 after_m:=public.get_admin_analytics();
 if after_m#>'{health,activation_cohort}' is distinct from before_m#>'{health,activation_cohort}' then raise exception 'FAIL: immature signup dilutes seven-day activation'; end if;
 update profiles set created_at=now()-interval '8 days' where id=uid;
 after_m:=public.get_admin_analytics();
 if (after_m#>>'{health,activation_cohort,d}')::int<>(before_m#>>'{health,activation_cohort,d}')::int+1 then raise exception 'FAIL: mature signup absent from activation denominator'; end if;
 if after_m#>'{health,second_round_cohort}' is distinct from before_m#>'{health,second_round_cohort}' then raise exception 'FAIL: immature signup dilutes second-round cohort'; end if;
 insert into daily_active(user_id,day,opens) values(uid,current_date-8,1),(uid,current_date-1,1);
 after_m:=public.get_admin_analytics();
 if (after_m#>>'{health,retention_w1,n}')::int<>(before_m#>>'{health,retention_w1,n}')::int+1 or (after_m#>>'{health,retention_w1,d}')::int<>(before_m#>>'{health,retention_w1,d}')::int+1 then raise exception 'FAIL: week-one return numerator/denominator'; end if;
 update profiles set deactivated=true where id=uid;
 if public.analytics_member_eligible(uid) then raise exception 'FAIL: deactivated account eligible'; end if;
 after_m:=public.get_admin_analytics();
 if after_m#>'{health,retention_w1}' is distinct from before_m#>'{health,retention_w1}' then raise exception 'FAIL: inactive account remains in retention'; end if;
 if public.analytics_player_holes('23500000-0000-0000-0000-000000000021','missing','{}')<>0 then raise exception 'FAIL: malformed card treated as scores'; end if;
 if public.analytics_ratio(0,0)->>'pct' is not null then raise exception 'FAIL: no cohort represented as zero percent'; end if;
end $$;
-- Roster membership alone is not play; no-shows and empty cards never enter cadence.
select set_config('request.jwt.claim.sub','',true);
select pg_temp.analytics_game('23500000-0000-0000-0000-000000000025','ended');
select pg_temp.analytics_player('23500000-0000-0000-0000-000000000025','23500000-0000-0000-0000-000000000002');
update game_players set no_show=true where game_id='23500000-0000-0000-0000-000000000025';
do $$begin
 if exists(select 1 from public.analytics_participation() where game_id='23500000-0000-0000-0000-000000000025') then raise exception 'FAIL: no-show counts as participation'; end if;
end $$;
update game_players set no_show=false,scores='[]' where game_id='23500000-0000-0000-0000-000000000025';
do $$begin
 if exists(select 1 from public.analytics_participation() where game_id='23500000-0000-0000-0000-000000000025') then raise exception 'FAIL: empty roster counts as participation'; end if;
 if has_function_privilege('anon','public.record_feature_use(text,uuid,uuid)','execute') or has_function_privilege('authenticated','public.analytics_member_eligible(uuid)','execute') then raise exception 'FAIL: telemetry or helper ACL widened'; end if;
end $$;
-- A reminder followed by actual completion is a distinct linked outcome.
select pg_temp.analytics_game('23500000-0000-0000-0000-000000000026');
select pg_temp.analytics_player('23500000-0000-0000-0000-000000000026','23500000-0000-0000-0000-000000000001');
update games set stale_review_notified_at=now() where id='23500000-0000-0000-0000-000000000026';
update games set status='ended',ended_at=now() where id='23500000-0000-0000-0000-000000000026';
insert into push_subscriptions(user_id,endpoint,p256dh,auth,disabled,fail_count,last_seen) values
 ('23500000-0000-0000-0000-000000000002','https://example.invalid/eligible','fixture','fixture',true,5,now()),
 ('23500000-0000-0000-0000-000000000003','https://example.invalid/test','fixture','fixture',true,5,now());
-- Game-specific event evidence requires a live link owned by the actor; repeated uses count separately.
select set_config('request.jwt.claim.sub','23500000-0000-0000-0000-000000000001',true);
update games set share_token='analytics-live-fixture' where id='23500000-0000-0000-0000-000000000021';
select set_config('request.jwt.claim.sub','23500000-0000-0000-0000-000000000002',true);
set local role authenticated;
select public.record_feature_use('live_share',gen_random_uuid(),'23500000-0000-0000-0000-000000000021');
select public.record_feature_use('insights_open','23500000-0000-0000-0000-000000000091');
reset role;
select set_config('request.jwt.claim.sub','23500000-0000-0000-0000-000000000001',true);
do $$declare m jsonb; begin
 if not exists(select 1 from activity_log where action='analytics_reminder_completed' and details->>'game_id'='23500000-0000-0000-0000-000000000026') then raise exception 'FAIL: reminder completion outcome absent'; end if;
 if (public.admin_push_device_stats()->>'failing_endpoints')::int<>1 or (select count(*) from public.admin_push_devices('push_failing'))<>1 then raise exception 'FAIL: push summary/drill populations differ'; end if;
 if exists(select 1 from activity_log where actor_id='23500000-0000-0000-0000-000000000002' and action='analytics_live_share') then raise exception 'FAIL: outsider forged live-share evidence'; end if;
 m:=public.get_admin_analytics();
 if not exists(select 1 from jsonb_array_elements(m#>'{funnels,feature_use}') f where f->>'action'='analytics_insights_open' and (f->>'uses')::int=2 and (f->>'repeat_users')::int=1) then raise exception 'FAIL: repeated feature use miscounted'; end if;
 -- FK-safe ledger during parent-group cascade, including removed Test clubs.
 delete from groups where id='23500000-0000-0000-0000-000000000011';
 if exists(select 1 from analytics_game_lifecycle where game_id='23500000-0000-0000-0000-000000000022' and not excluded_test) then raise exception 'FAIL: Test club deletion contaminated lifecycle counts'; end if;
 raise notice 'ANALYTICS_COHORTS_PASS mature denominators, genuine returns, deactivation, no-shows, empty rosters, repeat events, event ownership, cascade safety';
end $$;
rollback;
