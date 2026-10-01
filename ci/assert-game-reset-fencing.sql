-- Disposable fresh database only; no production fixtures. Everything rolls back.
begin;
insert into auth.users(id) values ('16300000-0000-0000-0000-000000000001'),('16300000-0000-0000-0000-000000000002');
insert into public.profiles(id,display_name,is_admin) values ('16300000-0000-0000-0000-000000000001','Reset organizer',true),('16300000-0000-0000-0000-000000000002','Reset player',false);
insert into public.games(id,code,name,course,game_type,status,created_by,holes_meta,foursomes) values
 ('16300000-0000-0000-0000-000000000020','916301','Reset fence','Test course','alt_shot','active','16300000-0000-0000-0000-000000000001',
 '[{"n":1,"par":4,"si":1}]','[{"id":"reset-group","a":["16300000-0000-0000-0000-000000000001","16300000-0000-0000-0000-000000000002"],"b":["16300000-0000-0000-0000-000000000001","16300000-0000-0000-0000-000000000002"]}]');
insert into public.game_players(id,game_id,user_id,display_name,scores,putts,fairways,penalties,sand) values
 ('16300000-0000-0000-0000-000000000021','16300000-0000-0000-0000-000000000020','16300000-0000-0000-0000-000000000001','Organizer','[5]','[2]','["hit"]','[0]','[false]'),
 ('16300000-0000-0000-0000-000000000022','16300000-0000-0000-0000-000000000020','16300000-0000-0000-0000-000000000002','Player','[6]','[3]','["miss"]','[1]','[true]');
select set_config('request.jwt.claim.sub','16300000-0000-0000-0000-000000000001',true);
select public.claim_scoring_device('16300000-0000-0000-0000-000000000010');
select set_config('request.headers','{"x-bnn-scoring-device":"16300000-0000-0000-0000-000000000010"}',true);
set local role authenticated;
do $$
declare gid uuid:='16300000-0000-0000-0000-000000000020'; pid uuid:='16300000-0000-0000-0000-000000000021'; denied boolean; result jsonb;
begin
 result:=public.save_game_score_bundle(pid,0,'{"scores":[4],"putts":[1]}');
 if result->'scores'<>'[4]'::jsonb then raise exception 'FAIL: current version did not save'; end if;
 perform public.claim_scoring_device('16300000-0000-0000-0000-000000000012',null,true);
 denied:=false;
 begin perform public.save_game_score_bundle(pid,0,'{"scores":[9]}');
 exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: reset fencing bypassed primary-device transfer'; end if;
 perform public.claim_scoring_device('16300000-0000-0000-0000-000000000010',null,true);
 perform public.save_alt_shot_score_fenced(gid,0,'reset-group','a',0,4);
 perform public.reset_game_scores(gid);
 if (select scoring_version from public.games where id=gid)<>1 then raise exception 'FAIL: organizer reset version'; end if;
 denied:=false;
 begin perform public.save_game_score_bundle(pid,0,'{"scores":[8],"putts":[4]}');
 exception when sqlstate 'BN163' then denied:=true; end;
 if not denied then raise exception 'FAIL: stale player score restored after reset'; end if;
 denied:=false;
 begin perform public.save_game_score_bundle(pid,0,'{"putts":[4]}',true);
 exception when sqlstate 'BN163' then denied:=true; end;
 if not denied then raise exception 'FAIL: stale stats restored after reset'; end if;
 denied:=false;
 begin perform public.save_alt_shot_score_fenced(gid,0,'reset-group','a',0,8);
 exception when sqlstate 'BN163' then denied:=true; end;
 if not denied then raise exception 'FAIL: stale side score restored after reset'; end if;
 denied:=false;
 begin update public.game_players set scores='[9]' where id=pid;
 exception when sqlstate 'BN163' then denied:=true; end;
 if not denied then raise exception 'FAIL: legacy direct update bypassed reset version'; end if;
 denied:=false;
 begin perform public.save_hole_stats(pid,'[4]');
 exception when sqlstate 'BN163' then denied:=true; end;
 if not denied then raise exception 'FAIL: legacy stats endpoint bypassed reset version'; end if;
 denied:=false;
 begin perform public.save_alt_shot_side_score(gid,'reset-group','a',0,8);
 exception when sqlstate 'BN163' then denied:=true; end;
 if not denied then raise exception 'FAIL: legacy side endpoint bypassed reset version'; end if;
 denied:=false;
 begin update public.games set scoring_version=0 where id=gid;
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: browser rewound reset version'; end if;
 if (select scores from public.game_players where id=pid)<>'[]'::jsonb or exists(select 1 from public.game_alt_shot_scores where game_id=gid) then raise exception 'FAIL: denied writes changed cleared scores'; end if;
 perform public.save_game_score_bundle(pid,1,'{"scores":[3],"putts":[1]}');
 perform public.save_game_score_bundle(pid,1,'{"scores":[null]}');
 perform public.save_alt_shot_score_fenced(gid,1,'reset-group','a',0,null);
 perform public.admin_reset_game(gid);
 if (select scoring_version from public.games where id=gid)<>2 then raise exception 'FAIL: admin reset version'; end if;
 denied:=false;
 begin perform public.save_game_score_bundle(pid,1,'{"scores":[7]}');
 exception when sqlstate 'BN163' then denied:=true; end;
 if not denied then raise exception 'FAIL: repeated reset accepted previous version'; end if;
 denied:=false;
 begin perform public.save_game_score_bundle(pid,null,'{"scores":[7]}');
 exception when sqlstate 'BN163' then denied:=true; end;
 if not denied then raise exception 'FAIL: absent version accepted'; end if;
 denied:=false;
 begin perform public.save_game_score_bundle(pid,2,'{"course_handicap":9}');
 exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: patch changed setup metadata'; end if;
 -- Another member still cannot use the stats-only path to mutate someone else's row.
 perform set_config('request.jwt.claim.sub','16300000-0000-0000-0000-000000000002',true);
 perform public.claim_scoring_device('16300000-0000-0000-0000-000000000011');
 perform set_config('request.headers','{"x-bnn-scoring-device":"16300000-0000-0000-0000-000000000011"}',true);
 denied:=false;
 begin perform public.save_game_score_bundle(pid,2,'{"putts":[4]}',true);
 exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: reset fencing widened own-stats permission'; end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.save_game_score_bundle(uuid,integer,jsonb,boolean)','execute') or has_function_privilege('anon','public.save_alt_shot_score_fenced(uuid,integer,text,text,integer,integer)','execute') then raise exception 'FAIL: anonymous reset-fenced RPC grant'; end if;
end $$;
rollback;
