-- Real own-round RPC/RLS/device checks; disposable fixtures roll back.
begin;
insert into auth.users(id) values('23600000-0000-0000-0000-000000000001'),('23600000-0000-0000-0000-000000000002');
insert into profiles(id,display_name,account_status) values('23600000-0000-0000-0000-000000000001','Penalty owner','active'),('23600000-0000-0000-0000-000000000002','Other owner','active');
insert into rounds(id,user_id,course,status,played_at) values
 ('23600000-0000-0000-0000-000000000010','23600000-0000-0000-0000-000000000001','Full card','final',current_date),
 ('23600000-0000-0000-0000-000000000011','23600000-0000-0000-0000-000000000001','Partial card','final',current_date),
 ('23600000-0000-0000-0000-000000000012','23600000-0000-0000-0000-000000000001','Nine card','final',current_date);
insert into holes(round_id,hole_number,par,stroke_index,strokes,putts,penalties)
 select '23600000-0000-0000-0000-000000000010',n,4,n,5,2,0 from generate_series(1,18)n;
insert into holes(round_id,hole_number,par,stroke_index,strokes,putts,penalties)
 select '23600000-0000-0000-0000-000000000011',n,4,n,case when n=18 then null else 5 end,2,0 from generate_series(1,18)n;
insert into holes(round_id,hole_number,par,stroke_index,strokes,putts,penalties)
 select '23600000-0000-0000-0000-000000000012',n,4,n,5,2,0 from generate_series(1,9)n;
-- A posted round is immutable in score fields, but its owner can confirm observational metadata.
insert into games(id,code,name,course,created_by,status,game_type,course_par,holes_meta)
 select '23600000-0000-0000-0000-000000000020','236020','Posted fixture','Course','23600000-0000-0000-0000-000000000001','ended','stroke',72,jsonb_agg(jsonb_build_object('n',n,'par',4,'si',n)) from generate_series(1,18)n;
insert into rounds(id,user_id,course,status,played_at,game_id) values('23600000-0000-0000-0000-000000000013','23600000-0000-0000-0000-000000000001','Posted card','final',current_date,'23600000-0000-0000-0000-000000000020');
insert into holes(round_id,hole_number,par,stroke_index,strokes,putts,penalties) select '23600000-0000-0000-0000-000000000013',n,4,n,5,2,0 from generate_series(1,18)n;
create function pg_temp.pen_snapshot(r uuid) returns jsonb language sql as $$select jsonb_agg(jsonb_build_array(hole_number,strokes,penalties) order by hole_number) from public.holes where round_id=r$$;
select set_config('request.jwt.claim.sub','23600000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.claim_scoring_device('23600000-0000-0000-0000-000000000099',null,false);
select set_config('request.headers','{"x-bnn-scoring-device":"23600000-0000-0000-0000-000000000099"}',true);
do $$declare r uuid:='23600000-0000-0000-0000-000000000010'; s jsonb; denied boolean:=false; begin
 if (select penalties_tracked from rounds where id=r) then raise exception 'FAIL: legacy zeros automatically confirmed'; end if;
 perform public.set_round_penalties_tracked('23600000-0000-0000-0000-000000000013',true,pg_temp.pen_snapshot('23600000-0000-0000-0000-000000000013'));
 if not(select penalties_tracked from rounds where id='23600000-0000-0000-0000-000000000013') then raise exception 'FAIL: posted-round owner cannot confirm'; end if;
 begin update holes set strokes=2 where round_id='23600000-0000-0000-0000-000000000013' and hole_number=1; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: penalty confirmation weakened posted-score protection'; end if;
 denied:=false;

 s:=pg_temp.pen_snapshot(r);
 perform public.set_round_penalties_tracked(r,true,s);
 if not(select penalties_tracked from rounds where id=r) then raise exception 'FAIL: explicit zero confirmation not stored'; end if;
 perform public.set_round_penalties_tracked(r,true,s); -- repeat/re-entry idempotent
 update holes set putts=3 where round_id=r and hole_number=1;
 if not(select penalties_tracked from rounds where id=r) then raise exception 'FAIL: unrelated putting edit removed confirmation'; end if;
 update holes set penalties=1 where round_id=r and hole_number=1;
 if (select penalties_tracked from rounds where id=r) then raise exception 'FAIL: changed penalties retained stale confirmation'; end if;
 begin perform public.set_round_penalties_tracked(r,true,s); exception when invalid_parameter_value then denied:=true; end;
 if not denied or (select penalties_tracked from rounds where id=r) then raise exception 'FAIL: outdated displayed card was confirmed'; end if;
 perform public.set_round_penalties_tracked(r,true,pg_temp.pen_snapshot(r));
 update holes set strokes=6 where round_id=r and hole_number=1;
 if (select penalties_tracked from rounds where id=r) then raise exception 'FAIL: changed score retained confirmation'; end if;
 denied:=false;
 begin perform public.set_round_penalties_tracked('23600000-0000-0000-0000-000000000011',true,pg_temp.pen_snapshot('23600000-0000-0000-0000-000000000011')); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'FAIL: partial card was confirmed'; end if;
 perform public.set_round_penalties_tracked('23600000-0000-0000-0000-000000000012',true,pg_temp.pen_snapshot('23600000-0000-0000-0000-000000000012'));
 if not(select penalties_tracked from rounds where id='23600000-0000-0000-0000-000000000012') then raise exception 'FAIL: complete nine cannot confirm'; end if;
 perform public.set_round_penalties_tracked(r,true,pg_temp.pen_snapshot(r));
 perform public.set_round_penalties_tracked(r,false,null);
 if (select penalties_tracked from rounds where id=r) then raise exception 'FAIL: remove confirmation failed'; end if;
 -- 0240 (212.131): the flag changes only inside the RPC — a direct write by the owner is refused, whichever way it goes
 denied:=false;
 begin update rounds set penalties_tracked=true where id=r; exception when insufficient_privilege then denied:=true; end;
 if not denied or (select penalties_tracked from rounds where id=r) then raise exception 'FAIL: a direct write confirmed penalties without the review'; end if;
 perform public.set_round_penalties_tracked(r,true,pg_temp.pen_snapshot(r));
 denied:=false;
 begin update rounds set penalties_tracked=false where id=r; exception when insufficient_privilege then denied:=true; end;
 if not denied or not(select penalties_tracked from rounds where id=r) then raise exception 'FAIL: a direct write removed the confirmation'; end if;
 update rounds set ai_analysis='fine' where id=r;   -- an unrelated own-round write with the flag unchanged still works
 if not(select penalties_tracked from rounds where id=r) then raise exception 'FAIL: an unrelated write disturbed the confirmation'; end if;
 denied:=false;
 begin insert into rounds(user_id,course,status,played_at,penalties_tracked) values(auth.uid(),'Pre-confirmed','final',current_date,true); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: a round was inserted already confirmed'; end if;
 perform public.set_round_penalties_tracked(r,false,null);
 perform set_config('request.headers','{}',true);denied:=false;
 begin perform public.set_round_penalties_tracked(r,true,pg_temp.pen_snapshot(r)); exception when others then denied:=sqlerrm like 'Scoring is active on another device%'; end;
 if not denied or (select penalties_tracked from rounds where id=r) then raise exception 'FAIL: device refusal failed or changed metadata'; end if;
 perform set_config('request.jwt.claim.sub','23600000-0000-0000-0000-000000000002',true);denied:=false;
 begin perform public.set_round_penalties_tracked(r,false,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: another member changed penalty confirmation'; end if;
 if has_function_privilege('anon','public.set_round_penalties_tracked(uuid,boolean,jsonb)','execute') or has_function_privilege('authenticated','public.invalidate_penalty_confirmation()','execute') then raise exception 'FAIL: penalty confirmation ACL widened'; end if;
 raise notice 'PENALTY_TRACKING_PASS explicit zero, legacy unknown, snapshot concurrency, normal/retry/remove, incomplete/9H/18H, change invalidation, unrelated stats preserved, owner/device isolation and failure rollback, direct writes of the flag refused (0240)';
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update holes set penalties=1 where round_id='23600000-0000-0000-0000-000000000013' and hole_number=1;
do $$begin if (select penalties_tracked from rounds where id='23600000-0000-0000-0000-000000000013') then raise exception 'FAIL: server correction retained stale posted confirmation'; end if; end $$;
update profiles set account_status='pending' where id='23600000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','23600000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$declare denied boolean:=false; begin
 begin perform public.set_round_penalties_tracked('23600000-0000-0000-0000-000000000010',false,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: pending account changed confirmation'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update profiles set account_status='active',banned=true where id='23600000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','23600000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$declare denied boolean:=false; begin
 begin perform public.set_round_penalties_tracked('23600000-0000-0000-0000-000000000010',false,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: banned account changed confirmation'; end if;
 raise notice 'PENALTY_ADJACENT_PASS posted metadata allowed, score mutations denied, server corrections invalidate, pending and banned accounts denied';
end $$;
reset role;
rollback;
