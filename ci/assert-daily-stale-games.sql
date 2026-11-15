-- Actual migration-chain database only. All fixtures and scheduled job changes roll back.
begin;
select pg_advisory_xact_lock(hashtextextended('daily-stale-games',234));
delete from stale_game_job_runs;
insert into auth.users(id) values('23400000-0000-0000-0000-000000000001');
insert into profiles(id,display_name,account_status) values('23400000-0000-0000-0000-000000000001','Maintenance test','active') on conflict(id) do nothing;
insert into groups(id,name,is_test) values('23400000-0000-0000-0000-000000000010','Maintenance club',false),('23400000-0000-0000-0000-000000000011','Maintenance test club',true);

insert into group_members(group_id,user_id,email,role,status) values('23400000-0000-0000-0000-000000000010','23400000-0000-0000-0000-000000000001','stale-fixture@example.invalid','member','active');

create function pg_temp.make_stale_game(label text,n integer default 9,kind text default 'stroke',club uuid default '23400000-0000-0000-0000-000000000010') returns uuid language plpgsql as $$
declare g uuid:=gen_random_uuid(); meta jsonb;
begin
 select jsonb_agg(jsonb_build_object('n',i,'par',4,'si',i)) into meta from generate_series(1,n) i;
 insert into games(id,code,name,course,course_par,holes_meta,game_type,status,created_by,group_id,created_at,played_at)
 values(g,substring(replace(g::text,'-',''),1,6),label,'Test course',72,meta,kind,'active','23400000-0000-0000-0000-000000000001',club,now()-interval '10 days',(now() at time zone 'America/New_York')::date-10);
 return g;
end $$;
create function pg_temp.player(g uuid,score_count integer,n integer default 9,guest boolean default false) returns uuid language plpgsql as $$
declare p uuid:=gen_random_uuid(); scores jsonb;
begin
 select jsonb_agg(case when i<=score_count then to_jsonb(5) else 'null'::jsonb end order by i) into scores from generate_series(1,n)i;
 insert into game_players(id,game_id,user_id,is_guest,display_name,rating,slope,handicap_index,tee_name,course_handicap,scores,putts,fairways,penalties,sand)
 values(p,g,case when not guest then '23400000-0000-0000-0000-000000000001'::uuid end,guest,'Maintenance player',72,113,12,'Blue',12,scores,'[]','[]','[]','[]');
 return p;
end $$;
create temp table stale_cases(label text,id uuid);
do $$
declare g uuid; p uuid; meta jsonb; key text; i integer; r uuid; cp uuid; result jsonb;
begin
 g:=pg_temp.make_stale_game('empty-expired'); insert into stale_cases values('empty-expired',g); perform pg_temp.player(g,0);
 g:=pg_temp.make_stale_game('created-exact-seven');update games set created_at=(((now() at time zone 'America/New_York')::date-7)+time '23:59') at time zone 'America/New_York' where id=g;insert into stale_cases values('created-exact-seven',g);
 g:=pg_temp.make_stale_game('play-exact-seven');update games set played_at=(now() at time zone 'America/New_York')::date-7 where id=g;insert into stale_cases values('play-exact-seven',g);
 g:=pg_temp.make_stale_game('protected-bucket');insert into group_events(group_id,name,source_game_id,created_by) values('23400000-0000-0000-0000-000000000010','Preserved bucket',g,'23400000-0000-0000-0000-000000000001');insert into stale_cases values('protected-bucket',g);
 g:=pg_temp.make_stale_game('empty-cup',9,'match');
 update games set teams='[{"key":"A","name":"Red"},{"key":"B","name":"Blue"}]' where id=g;
 cp:=gen_random_uuid();
 insert into competitions(id,group_id,name,start_date,team_a_name,team_b_name,created_by) values(cp,'23400000-0000-0000-0000-000000000010','Maintenance Cup',current_date,'Red','Blue','23400000-0000-0000-0000-000000000001');
 insert into competition_sessions(competition_id,name,format,session_order,play_date,game_id) values(cp,'Preserved schedule','match',1,current_date-10,g);
 insert into stale_cases values('empty-cup',g);
 g:=pg_temp.make_stale_game('created-recent'); update games set created_at=now()-interval '2 days' where id=g;insert into stale_cases values('created-recent',g);
 g:=pg_temp.make_stale_game('scheduled-recent'); update games set played_at=(now() at time zone 'America/New_York')::date-2 where id=g;insert into stale_cases values('scheduled-recent',g);
 g:=pg_temp.make_stale_game('future'); update games set played_at=(now() at time zone 'America/New_York')::date+1 where id=g;insert into stale_cases values('future',g);
 g:=pg_temp.make_stale_game('empty-test',9,'stroke','23400000-0000-0000-0000-000000000011');insert into stale_cases values('empty-test',g);
 g:=pg_temp.make_stale_game('full-nine'); perform pg_temp.player(g,9);insert into stale_cases values('full-nine',g);
 g:=pg_temp.make_stale_game('full-eighteen',18); perform pg_temp.player(g,18,18);insert into stale_cases values('full-eighteen',g);
 g:=pg_temp.make_stale_game('recent-score'); perform pg_temp.player(g,9);insert into stale_cases values('recent-score',g);
 g:=pg_temp.make_stale_game('partial'); perform pg_temp.player(g,3);insert into stale_cases values('partial',g);
 g:=pg_temp.make_stale_game('missing-player'); perform pg_temp.player(g,9);perform pg_temp.player(g,0,9,true);insert into stale_cases values('missing-player',g);
 g:=pg_temp.make_stale_game('guest-partial'); perform pg_temp.player(g,9);perform pg_temp.player(g,4,9,true);insert into stale_cases values('guest-partial',g);
 g:=pg_temp.make_stale_game('guest-full'); perform pg_temp.player(g,9);perform pg_temp.player(g,9,9,true);insert into stale_cases values('guest-full',g);
 g:=pg_temp.make_stale_game('no-show'); perform pg_temp.player(g,9);p:=pg_temp.player(g,0,9,true);update game_players set no_show=true where id=p;insert into stale_cases values('no-show',g);
 g:=pg_temp.make_stale_game('stat-only');p:=pg_temp.player(g,0);update game_players set putts='[0]' where id=p;insert into stale_cases values('stat-only',g);
 g:=pg_temp.make_stale_game('shared-full',9,'scramble');p:=pg_temp.player(g,0);
 update games set foursomes=jsonb_build_array(jsonb_build_object('id','team','a',jsonb_build_array('23400000-0000-0000-0000-000000000001'),'b','[]'::jsonb)) where id=g;
 insert into game_alt_shot_scores(game_id,foursome_id,side,hole_index,strokes) select g,'team','a',h,5 from generate_series(0,8)h;
 insert into stale_cases values('shared-full',g);
 g:=pg_temp.make_stale_game('shared-partial',9,'scramble');p:=pg_temp.player(g,0);
 update games set foursomes=jsonb_build_array(jsonb_build_object('id','team','a',jsonb_build_array('23400000-0000-0000-0000-000000000001'),'b','[]'::jsonb)) where id=g;
 insert into game_alt_shot_scores(game_id,foursome_id,side,hole_index,strokes) select g,'team','a',h,5 from generate_series(0,7)h;
 insert into stale_cases values('shared-partial',g);
 g:=pg_temp.make_stale_game('alt-shared-full',9,'alt_shot');perform pg_temp.player(g,0);p:=pg_temp.player(g,0,9,true);
 update games set foursomes=jsonb_build_array(jsonb_build_object('id','alt','a',jsonb_build_array('23400000-0000-0000-0000-000000000001'),'b',jsonb_build_array(p::text))) where id=g;
 insert into game_alt_shot_scores(game_id,foursome_id,side,hole_index,strokes) select g,'alt',t.side,h,5 from generate_series(0,8)h cross join (values('a'),('b'))t(side);
 insert into stale_cases values('alt-shared-full',g);
 g:=pg_temp.make_stale_game('alt-missing-side',9,'alt_shot');perform pg_temp.player(g,0);p:=pg_temp.player(g,0,9,true);
 update games set foursomes=jsonb_build_array(jsonb_build_object('id','alt','a',jsonb_build_array('23400000-0000-0000-0000-000000000001'),'b',jsonb_build_array(p::text))) where id=g;
 insert into game_alt_shot_scores(game_id,foursome_id,side,hole_index,strokes) select g,'alt','a',h,5 from generate_series(0,8)h;
 insert into stale_cases values('alt-missing-side',g);
 g:=pg_temp.make_stale_game('posting-fails');perform pg_temp.player(g,9);insert into stale_cases values('posting-fails',g);
 -- Age actual-score timestamps only after fixture setup; tracker defaults must not be bypassed in app roles.
 update games set last_score_change_at=now()-interval '3 days' where id in(select id from stale_cases where label<>'recent-score');
 -- Personal rounds retain planned hole identities; optional stats are not prerequisites.
 foreach i in array array[9,18] loop
   r:=gen_random_uuid();insert into rounds(id,user_id,course,status,group_id,played_at,created_at,course_par) values(r,'23400000-0000-0000-0000-000000000001','Personal','in_progress','23400000-0000-0000-0000-000000000010',now()-interval '4 days',now()-interval '4 days',i*4);
   insert into holes(round_id,hole_number,par,stroke_index,strokes) select r,j,4,j,5 from generate_series(1,i)j;
   update rounds set last_score_change_at=now()-interval '3 days' where id=r;
 end loop;
 r:=gen_random_uuid();insert into rounds(id,user_id,course,status,group_id,played_at,course_par) values(r,'23400000-0000-0000-0000-000000000001','Legacy partial eighteen','in_progress','23400000-0000-0000-0000-000000000010',now()-interval '4 days',72);
 insert into holes(round_id,hole_number,par,stroke_index,strokes) select r,j,4,j,5 from generate_series(1,9)j;
 update rounds set last_score_change_at=now()-interval '3 days' where id=r;
end $$;
-- Fail the status transition AFTER posting; the posted round must roll back too.
create function pg_temp.fail_stale_end() returns trigger language plpgsql as $$begin
 if new.id=(select id from stale_cases where label='posting-fails') and new.status='ended' then raise exception 'Injected posting rollback'; end if; return new;
end $$;
create trigger test_stale_rollback before update on games for each row execute function pg_temp.fail_stale_end();
do $$
declare result jsonb; g uuid; first_reviews integer; before_time timestamptz; m jsonb; case_name text;
begin
 result:=public.run_daily_stale_games();
 if (result->>'failures')::int<>1 then raise exception 'FAIL: expected one isolated posting failure, got %',result; end if;
 if exists(select 1 from games where id in(select id from stale_cases where label in ('empty-expired','created-exact-seven','play-exact-seven','empty-cup'))) then raise exception 'FAIL: expired empty game / exact seven-day boundary retained'; end if;
 foreach case_name in array array['protected-bucket','created-recent','scheduled-recent','future','empty-test','recent-score','partial','missing-player','guest-partial','stat-only','alt-missing-side','shared-partial','posting-fails'] loop
  if not exists(select 1 from games where id=(select id from stale_cases c where c.label=case_name) and status<>'ended') then raise exception 'FAIL: protected/partial game % changed',case_name; end if;
 end loop;
 foreach case_name in array array['full-nine','full-eighteen','guest-full','no-show','shared-full','alt-shared-full'] loop
  if not exists(select 1 from games where id=(select id from stale_cases c where c.label=case_name) and status='ended') then raise exception 'FAIL: full game % not completed; %',case_name,result; end if;
 end loop;
 if exists(select 1 from rounds where game_id=(select id from stale_cases where label='posting-fails')) then raise exception 'FAIL: failed game left posted rounds'; end if;
 if exists(select 1 from rounds where game_id=(select id from stale_cases where label='shared-full')) then raise exception 'FAIL: shared ball posted personal handicap round'; end if;
 if not exists(select 1 from rounds where course='Legacy partial eighteen' and status='in_progress') then raise exception 'FAIL: nine stored holes misclassified as a complete eighteen'; end if;
 if (select count(*) from rounds where course='Personal' and status='final')<>2 then raise exception 'FAIL: personal 9/18 completion'; end if;
 if (select count(*) from holes where round_id in(select id from rounds where game_id=(select id from stale_cases where label='full-nine')))<>9 then raise exception 'FAIL: nine-hole posting changed'; end if;
 if not exists(select 1 from rounds where game_id=(select id from stale_cases where label='full-eighteen') and gross_score=90) then raise exception 'FAIL: eighteen-hole gross'; end if;
 if not exists(select 1 from competition_sessions where name='Preserved schedule' and game_id is null) then raise exception 'FAIL: empty game deletion removed Cup schedule'; end if;
 first_reviews:=(select count(*) from notifications where type='game_stale_review');
 if first_reviews<4 then raise exception 'FAIL: partial reviews missing'; end if;
 perform public.run_daily_stale_games(); -- partial failure is retryable, successful games are not reposted.
 if (select count(*) from notifications where type='game_stale_review')<>first_reviews then raise exception 'FAIL: repeated review notifications'; end if;
 -- Actual score change resets review deduplication and the inactivity clock; stats do not.
 select id into g from stale_cases where label='partial';
 select last_score_change_at into before_time from games where id=g;
 update game_players set putts='[2]' where game_id=g;
 if (select last_score_change_at from games where id=g)<>before_time then raise exception 'FAIL: optional stat reset score clock'; end if;
 update game_players set scores='[4,5,5]' where game_id=g;
 if (select stale_review_notified_at from games where id=g) is not null or (select last_score_change_at from games where id=g)<now()-interval '1 minute' then raise exception 'FAIL: score tracker failed'; end if;
 if (select active from cron.job where jobname='bnn-daily-stale-games') is distinct from true then raise exception 'FAIL: daily scheduler absent'; end if;
 if public.stale_job_next_schedule('2026-03-07 09:00Z')<>'0 8 * * *' or public.stale_job_next_schedule('2026-10-31 08:00Z')<>'0 9 * * *' then raise exception 'FAIL: DST transition schedule'; end if;
 if has_function_privilege('anon','public.run_daily_stale_games(timestamptz)','execute') or has_function_privilege('authenticated','public.run_daily_stale_games(timestamptz)','execute') or has_function_privilege('authenticated','public.finish_stale_rounds()','execute') or has_function_privilege('authenticated','public.sweep_stale_games()','execute') then raise exception 'FAIL: browser maintenance permissions'; end if;
 if not has_function_privilege('service_role','public.run_daily_stale_games(timestamptz)','execute') then raise exception 'FAIL: server cannot maintain'; end if;
 raise notice 'DAILY_STALE_GAMES_PASS real posting, rollback, dates, guests, no-shows, shared cards, personal 9/18, stats, review dedup, DST, ACL';
end $$;

drop trigger test_stale_rollback on public.games;
do $$declare result jsonb; n integer; begin
 result:=public.run_daily_stale_games();
 if (result->>'failures')::int<>0 then raise exception 'FAIL: recovery retry still failed: %',result; end if;
 select count(*) into n from rounds where game_id=(select id from stale_cases where label='posting-fails');
 if n<>1 then raise exception 'FAIL: retry did not post exactly once'; end if;
 result:=public.run_daily_stale_games();
 if result->>'skipped' is distinct from 'already complete' then raise exception 'FAIL: successful daily run not idempotent'; end if;
end $$;
grant select on stale_cases to authenticated;
select set_config('request.jwt.claim.sub','23400000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$declare stamp timestamptz; created_stamp timestamptz; gid uuid; begin
 select id into gid from stale_cases where label='partial';
 select last_score_change_at,created_at into stamp,created_stamp from games where id=gid;
 update games set created_at='2000-01-01',last_score_change_at='2000-01-01',stale_review_notified_at='2000-01-01' where id=gid;
 if (select created_at from games where id=gid) is distinct from created_stamp or (select last_score_change_at from games where id=gid) is distinct from stamp or (select stale_review_notified_at from games where id=gid) is not null then raise exception 'FAIL: member spoofed maintenance fields'; end if;
 -- 208.4 / 212.105: never CALL an EXECUTE-revoked function as an app role.
 -- The pinned Supabase image can crash in supautils before returning permission denied.
 -- Check the actual role's privilege instead; keep the real authorized writes/RLS reads above/below.
 if has_function_privilege(current_user,'public.run_daily_stale_games(timestamptz)','execute') then raise exception 'FAIL: member can execute destructive maintenance'; end if;
 if exists(select 1 from public.stale_game_job_runs) then raise exception 'FAIL: ordinary member sees maintenance history'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update profiles set is_admin=true where id='23400000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','23400000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$declare m jsonb:=public.get_ops_metrics(); begin
 if not exists(select 1 from public.admin_stale_games() where game_id=(select id from stale_cases where label='alt-missing-side') and complete=1 and not_started=1) then raise exception 'FAIL: Operations ignored canonical side-card counts'; end if;
 if m#>>'{stale_job,last_run,status}' is distinct from 'complete' then raise exception 'FAIL: Operations lacks actual job result'; end if;
 if not exists(select 1 from public.stale_game_job_runs) then raise exception 'FAIL: system admin cannot read job history'; end if;
end $$;
reset role;
rollback;
