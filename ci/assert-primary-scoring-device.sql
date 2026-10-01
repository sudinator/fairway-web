-- Disposable database only. Real authenticated RLS and actual scoring RPCs.
begin;
insert into auth.users(id) values ('16200000-0000-0000-0000-000000000001'),('16200000-0000-0000-0000-000000000002');
insert into public.profiles(id,display_name) values ('16200000-0000-0000-0000-000000000001','Primary scorer'),('16200000-0000-0000-0000-000000000002','Other scorer');
select set_config('request.jwt.claim.sub','16200000-0000-0000-0000-000000000001',true);
select public.claim_scoring_device('16200000-0000-0000-0000-000000000010');
select set_config('request.headers','{"x-bnn-scoring-device":"16200000-0000-0000-0000-000000000010"}',true);
insert into public.games(id,code,name,course,game_type,status,created_by,holes_meta,foursomes) values
 ('16200000-0000-0000-0000-000000000020','916201','Device test','Device course','alt_shot','active','16200000-0000-0000-0000-000000000001',
 '[{"n":1,"par":4,"si":1}]','[{"id":"device-group","a":["16200000-0000-0000-0000-000000000001","16200000-0000-0000-0000-000000000002"],"b":["16200000-0000-0000-0000-000000000001","16200000-0000-0000-0000-000000000002"]}]');
insert into public.game_players(id,game_id,user_id,display_name,scores,putts,fairways,penalties,sand) values
 ('16200000-0000-0000-0000-000000000021','16200000-0000-0000-0000-000000000020','16200000-0000-0000-0000-000000000001','Primary scorer','[5]','[2]','["hit"]','[0]','[false]');
set local role authenticated;
do $$
declare
 a uuid := '16200000-0000-0000-0000-000000000010'; b uuid := '16200000-0000-0000-0000-000000000011';
 rid uuid := '16200000-0000-0000-0000-000000000030'; gid uuid := '16200000-0000-0000-0000-000000000020';
 payload jsonb := '{"course":"Device course","played_at":"2026-09-30","course_handicap":12,"holes":[{"hole_number":1,"par":4,"stroke_index":1,"strokes":5,"putts":2}]}';
 denied boolean;
begin
 if public.claim_scoring_device(b)->>'active' <> 'false' then raise exception 'FAIL: passive second device took over'; end if;
 perform public.save_personal_round(rid,payload,false,false);
 perform public.save_alt_shot_side_score(gid,'device-group','a',0,5);
 if public.claim_scoring_device(b,null,true)->>'active' <> 'true' then raise exception 'FAIL: explicit transfer failed'; end if;
 -- The old header cannot save, finish, discard, write stats, or score a side.
 denied:=false;
 begin perform public.save_personal_round(rid,payload || '{"holes":[{"hole_number":1,"par":4,"stroke_index":1,"strokes":9}]}',false,false);
 exception when raise_exception then if sqlerrm like 'Scoring is active on another device.%' then denied:=true; else raise; end if; end;
 if not denied then raise exception 'FAIL: stale personal save succeeded'; end if;
 denied:=false;
 begin perform public.save_personal_round(rid,payload,true,false);
 exception when raise_exception then if sqlerrm like 'Scoring is active on another device.%' then denied:=true; else raise; end if; end;
 if not denied then raise exception 'FAIL: stale Finish succeeded'; end if;
 denied:=false;
 begin perform public.discard_personal_round(rid);
 exception when raise_exception then if sqlerrm like 'Scoring is active on another device.%' then denied:=true; else raise; end if; end;
 if not denied then raise exception 'FAIL: stale Discard succeeded'; end if;
 denied:=false;
 begin update public.game_players set scores='[9]',putts='[4]' where id='16200000-0000-0000-0000-000000000021';
 exception when raise_exception then if sqlerrm like 'Scoring is active on another device.%' then denied:=true; else raise; end if; end;
 if not denied then raise exception 'FAIL: stale direct game scores/stats succeeded'; end if;
 denied:=false;
 begin perform public.save_hole_stats('16200000-0000-0000-0000-000000000021','[4]');
 exception when raise_exception then if sqlerrm like 'Scoring is active on another device.%' then denied:=true; else raise; end if; end;
 if not denied then raise exception 'FAIL: stale SECURITY DEFINER stats write succeeded'; end if;
 denied:=false;
 begin perform public.save_alt_shot_side_score(gid,'device-group','a',0,9);
 exception when raise_exception then if sqlerrm like 'Scoring is active on another device.%' then denied:=true; else raise; end if; end;
 if not denied then raise exception 'FAIL: stale SECURITY DEFINER Alternate Shot write succeeded'; end if;
 if (select strokes from public.holes where round_id=rid and hole_number=1) <> 5 or
    (select scores from public.game_players where id='16200000-0000-0000-0000-000000000021') <> '[5]'::jsonb or
    (select strokes from public.game_alt_shot_scores where game_id=gid and side='a') <> 5 then
   raise exception 'FAIL: rejected old-device writes changed data'; end if;
 -- Current header works, including deliberately clearing a score.
 perform set_config('request.headers',jsonb_build_object('x-bnn-scoring-device',b)::text,true);
 perform public.save_personal_round(rid,payload || '{"holes":[{"hole_number":1,"par":4,"stroke_index":1,"strokes":4}]}',false,false);
 perform public.save_hole_stats('16200000-0000-0000-0000-000000000021','[1]');
 update public.game_players set scores='[4]',putts='[1]' where id='16200000-0000-0000-0000-000000000021';
 perform public.save_alt_shot_side_score(gid,'device-group','a',0,null);
 if (select strokes from public.holes where round_id=rid and hole_number=1) <> 4 or
    (select scores from public.game_players where id='16200000-0000-0000-0000-000000000021') <> '[4]'::jsonb or
    (select strokes from public.game_alt_shot_scores where game_id=gid and side='a') is not null then
   raise exception 'FAIL: current-device scoring/clear failed'; end if;
 -- Legacy clients with no header are also fenced after rollout.
 perform set_config('request.headers','{}',true);
 denied:=false;
 begin update public.game_players set putts='[3]' where id='16200000-0000-0000-0000-000000000021';
 exception when raise_exception then if sqlerrm like 'Scoring is active on another device.%' then denied:=true; else raise; end if; end;
 if not denied then raise exception 'FAIL: headerless client bypassed guard'; end if;
 -- Normal tab resume rotates the old token; it does not disclose another device's token.
 if public.claim_scoring_device(a,b,false)->>'active' <> 'true' then raise exception 'FAIL: known tab resume failed'; end if;
 if public.claim_scoring_device(b)->>'active' <> 'false' then raise exception 'FAIL: old token reclaimed automatically'; end if;
 perform set_config('request.jwt.claim.sub','16200000-0000-0000-0000-000000000002',true);
 if public.claim_scoring_device(b)->>'active' <> 'true' then raise exception 'FAIL: distinct user sharing device was blocked'; end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.claim_scoring_device(uuid,uuid,boolean)','execute') then raise exception 'FAIL: anonymous device claim grant'; end if;
 if has_table_privilege('authenticated','public.scoring_devices','update') or has_table_privilege('authenticated','public.scoring_devices','select') then raise exception 'FAIL: device token table exposed'; end if;
end $$;
rollback;
