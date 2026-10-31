-- 0233 behavioral regression: scoped settlements and ended-card lock, disposable databases only.
begin;
insert into auth.users(id,email) select ('23300000-0000-0000-0000-00000000000'||n)::uuid, 'audit233-'||n||'@w.test' from generate_series(1,5) n;
insert into profiles(id,display_name,email,account_status) select id,email,email,'active' from auth.users where email like 'audit233-%';
insert into groups(id,name,created_by) values
 ('23300000-0000-0000-0000-000000000011','Club A','23300000-0000-0000-0000-000000000001'),
 ('23300000-0000-0000-0000-000000000012','Club B','23300000-0000-0000-0000-000000000001');
insert into group_members(group_id,user_id,email,role,status)
select g.id,p.id,p.email,case when right(p.id::text,1)='1' then 'admin' else 'member' end,
 case when right(p.id::text,1)='3' then 'removed' else 'active' end
from groups g cross join profiles p where g.name in ('Club A','Club B') and p.email like 'audit233-%' and right(p.id::text,1) in ('1','2','3');
insert into group_events(id,group_id,name) values
 ('23300000-0000-0000-0000-000000000021','23300000-0000-0000-0000-000000000011','Bucket A'),
 ('23300000-0000-0000-0000-000000000022','23300000-0000-0000-0000-000000000012','Bucket B');
insert into scoring_devices(user_id,token) select id,id from profiles where email like 'audit233-%';
insert into games(id,code,name,course,course_par,holes_meta,created_by,group_id,status,game_type,share_token)
values ('23300000-0000-0000-0000-000000000031','233031','Audit233','Oak',36,
 (select jsonb_agg(jsonb_build_object('n',n,'par',4,'si',n)) from generate_series(1,9) n),
 '23300000-0000-0000-0000-000000000001','23300000-0000-0000-0000-000000000011','active','match','233-live-regression-token');
insert into game_players(id,game_id,user_id,display_name,scores,course_handicap,course_handicap_source)
values ('23300000-0000-0000-0000-000000000041','23300000-0000-0000-0000-000000000031','23300000-0000-0000-0000-000000000002','Old Name','[5,5,5,5,5,5,5,5,5]',12,'manual');
insert into game_players(id,game_id,user_id,display_name,scores) values ('23300000-0000-0000-0000-000000000042','23300000-0000-0000-0000-000000000031','23300000-0000-0000-0000-000000000001','Organizer','[]');
insert into competitions(id,group_id,name,start_date,created_by,team_a_name,team_b_name,share_token) values ('23300000-0000-0000-0000-000000000051','23300000-0000-0000-0000-000000000011','Audit Cup',current_date,'23300000-0000-0000-0000-000000000001','A','B','233-cup-regression-token');
update games set teams='[{"key":"A","name":"A"},{"key":"B","name":"B"}]' where id='23300000-0000-0000-0000-000000000031';
update game_players set team=case when user_id='23300000-0000-0000-0000-000000000001' then 'A' else 'B' end where game_id='23300000-0000-0000-0000-000000000031';
insert into competition_players(competition_id,user_id,team_key,display_name) select '23300000-0000-0000-0000-000000000051',user_id,team,display_name from game_players where game_id='23300000-0000-0000-0000-000000000031';
insert into competition_sessions(competition_id,name,format,session_order,play_date,game_id) values ('23300000-0000-0000-0000-000000000051','Match','match',1,current_date,'23300000-0000-0000-0000-000000000031');
update games set status='ended',ended_at=now() where id='23300000-0000-0000-0000-000000000031';

-- A malformed old manual marker with no entered number falls back to calculated basis.
update game_players set course_handicap=null,handicap_index=12,slope=113,rating=36 where id='23300000-0000-0000-0000-000000000041';
do $$ declare p jsonb; begin
 select e into p from jsonb_array_elements(get_live_scorecard('233-live-regression-token')->'players') e where e->>'id'='23300000-0000-0000-0000-000000000041';
 if p->>'course_handicap_source' is distinct from 'derived' then raise exception 'null manual value must use derived basis'; end if;
end $$;
update game_players set course_handicap=12,handicap_index=null,slope=null,rating=null where id='23300000-0000-0000-0000-000000000041';

create function pg_temp.login(n int) returns void language plpgsql as $$
declare u text := '23300000-0000-0000-0000-00000000000'||n;
begin
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 perform set_config('request.headers',json_build_object('x-bnn-scoring-device',u)::text,true);
 execute 'set local role authenticated';
end $$;
create function pg_temp.payment(club int, payer int, payee int, dedup text) returns uuid language sql as $$
 select public.record_settlement(('23300000-0000-0000-0000-00000000001'||club)::uuid,
 ('23300000-0000-0000-0000-00000000000'||payer)::uuid,('23300000-0000-0000-0000-00000000000'||payee)::uuid,
 100,'cash',('23300000-0000-0000-0000-00000000002'||club)::uuid,'confirmed',dedup,'[{"expense_id":null,"amount_cents":100}]');
$$;
create function pg_temp.must_fail(q text, expected text) returns void language plpgsql as $$
begin
 begin execute q; exception when others then
   if sqlstate = expected then return; end if;
   raise exception 'Unexpected rejection: % %',sqlstate,sqlerrm;
 end;
 raise exception 'Unauthorized operation succeeded: %',q;
end $$;
select pg_temp.login(4);
select pg_temp.must_fail($q$select pg_temp.payment(1,4,2,'outsider-payer')$q$,'42501');
select pg_temp.must_fail($q$select pg_temp.payment(1,2,4,'outsider-payee')$q$,'42501');
select pg_temp.login(3);
select pg_temp.must_fail($q$select pg_temp.payment(1,3,2,'removed-caller')$q$,'42501');
select pg_temp.login(2);
select pg_temp.payment(1,2,1,'active-payer');
select pg_temp.payment(2,2,1,'multi-club');
select pg_temp.payment(1,3,2,'active-recipient-historical');
select pg_temp.login(1);
select pg_temp.payment(1,2,3,'admin-historical');
select pg_temp.must_fail($q$select pg_temp.payment(1,2,3,'admin-historical')$q$,'23505');
reset role;
do $$ begin
 if (select count(*) from settlements where dedup_key in ('active-payer','multi-club','active-recipient-historical','admin-historical')) <> 4 then raise exception 'valid settlements lost'; end if;
 if exists(select 1 from settlements where dedup_key in ('outsider-payer','outsider-payee','removed-caller')) then raise exception 'rejected payments leaked'; end if;
 if exists(select 1 from settlements s left join settlement_allocations a on a.settlement_id=s.id where s.dedup_key in ('active-payer','multi-club','active-recipient-historical','admin-historical') group by s.id,s.amount_cents having sum(a.amount_cents)<>s.amount_cents) then raise exception 'allocation mismatch'; end if;
end $$;
select pg_temp.login(2);
select pg_temp.must_fail($q$select save_game_score_bundle('23300000-0000-0000-0000-000000000041',0,'{"scores":[],"putts":[],"fairways":[],"penalties":[],"sand":[]}',false)$q$,'BN164');
select pg_temp.must_fail($q$select save_game_score_bundle('23300000-0000-0000-0000-000000000041',0,'{"scores":[4]}',false)$q$,'BN164');
reset role;
do $$ declare live jsonb; begin
 if (select scores from game_players where id='23300000-0000-0000-0000-000000000041') <> '[5,5,5,5,5,5,5,5,5]'::jsonb then raise exception 'rejected score write leaked'; end if;
 select e into live from jsonb_array_elements(get_live_scorecard('233-live-regression-token')->'players') e where e->>'id'='23300000-0000-0000-0000-000000000041';
 if live->>'course_handicap_source' is distinct from 'manual' or (live->>'ch')::numeric <>12 then raise exception 'public manual source/value lost'; end if;
 select e into live from jsonb_array_elements(get_live_competition('233-cup-regression-token')#>'{sessions,0,players}') e where e->>'id'='23300000-0000-0000-0000-000000000041';
 if live->>'course_handicap_source' is distinct from 'manual' then raise exception 'Cup manual source lost'; end if;
end $$;
select pg_temp.login(1);
select save_game_score_bundle('23300000-0000-0000-0000-000000000041',0,'{"scores":[4,5,5,5,5,5,5,5,5]}',false);
select reset_game_scores('23300000-0000-0000-0000-000000000031');
reset role;
do $$ begin
 if (select status from games where id='23300000-0000-0000-0000-000000000031') <> 'active' then raise exception 'organizer reset did not reopen'; end if;
 if (select scores from game_players where id='23300000-0000-0000-0000-000000000041') <> '[]'::jsonb then raise exception 'organizer reset failed'; end if;
end $$;
select pg_temp.login(2);
select pg_temp.must_fail($q$select save_game_score_bundle('23300000-0000-0000-0000-000000000041',0,'{"scores":[2]}',false)$q$,'BN163');
select save_game_score_bundle('23300000-0000-0000-0000-000000000041',1,'{"scores":[5]}',false);
rollback;
