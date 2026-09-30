-- Disposable database only; authenticated roles and real RPC; fixtures roll back.
begin;
insert into auth.users(id) values('15900000-0000-0000-0000-000000000001'),('15900000-0000-0000-0000-000000000002');
insert into public.profiles(id,display_name) values('15900000-0000-0000-0000-000000000001','Round owner'),('15900000-0000-0000-0000-000000000002','Other member');
set local role authenticated;
select set_config('request.jwt.claim.sub','15900000-0000-0000-0000-000000000001',true);
do $$
declare
  v_id uuid := '15900000-0000-0000-0000-000000000010';
  v_other uuid := '15900000-0000-0000-0000-000000000011';
  v_payload jsonb := '{"id":"","user_id":"ignored-client-identity","game_id":"ignored-client-game","course":"Test course","tee_name":"Blue","rating":72,"slope":113,"course_par":72,"handicap_index":12,"course_handicap":20,"course_handicap_source":"manual","played_at":"2026-09-29","holes":[{"id":"","round_id":"ignored-client-round","hole_number":1,"par":4,"stroke_index":1,"strokes":5,"putts":2},{"hole_number":2,"par":4,"stroke_index":2,"strokes":6,"putts":2}]}';
  v_result jsonb;
begin
  perform public.save_personal_round(v_id,v_payload,false,false);
  perform public.save_personal_round(v_id,v_payload,false,false);
  if (select count(*) from public.rounds where id=v_id) <> 1 or
     (select count(*) from public.holes where round_id=v_id) <> 2 then
    raise exception 'FAIL: backup retry duplicated records'; end if;
  if (select user_id from public.rounds where id=v_id) <> auth.uid()
     or (select game_id from public.rounds where id=v_id) is not null then
    raise exception 'FAIL: ignored JSON identity altered ownership or game linkage'; end if;
  -- A later invalid hole must roll back the earlier valid write and metadata changes.
  begin
    perform public.save_personal_round(v_id,jsonb_set(jsonb_set(v_payload,'{holes,0,strokes}','7'),'{holes,1,par}','-1'),true,false);
    raise exception 'FAIL: invalid hole accepted';
  exception when invalid_parameter_value then null; end;
  if (select strokes from public.holes where round_id=v_id and hole_number=1) <> 5
     or (select status from public.rounds where id=v_id) <> 'in_progress' then
    raise exception 'FAIL: transaction did not roll back'; end if;
  begin
    perform public.save_personal_round(v_other,jsonb_set(v_payload,'{holes,1,par}','-1'),true,false);
    raise exception 'FAIL: invalid new round accepted';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from public.rounds where id=v_other) then
    raise exception 'FAIL: failed creation left a partial round'; end if;
  v_result:=public.save_personal_round(v_id,jsonb_set(v_payload,'{holes,0,strokes}','7'),true,false);
  if (v_result->>'was_final')::boolean then raise exception 'FAIL: first completion classified as edit'; end if;
  if (select course_handicap from public.rounds where id=v_id) <> 20
     or (select course_handicap_source from public.rounds where id=v_id) <> 'manual' then
    raise exception 'FAIL: manual handicap was not preserved'; end if;
  v_result:=public.save_personal_round(v_id,v_payload,true,false);
  if not (v_result->>'was_final')::boolean then raise exception 'FAIL: retry classification wrong'; end if;
  begin
    perform public.save_personal_round(v_id,v_payload,false,false);
    raise exception 'FAIL: background changed final round';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.discard_personal_round(v_id);
    raise exception 'FAIL: discarded final round';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_personal_round(v_other,jsonb_set(v_payload,'{holes,1,hole_number}','1'),true,false);
    raise exception 'FAIL: duplicate holes accepted';
  exception when invalid_parameter_value then null; end;
  perform public.save_personal_round(v_other,v_payload,false,false);
  perform public.discard_personal_round(v_other);
  perform public.discard_personal_round(v_other);
  if exists(select 1 from public.rounds where id=v_other) or exists(select 1 from public.holes where round_id=v_other) then
    raise exception 'FAIL: discard left partial data'; end if;
  if (select count(*) from public.holes where round_id=v_id) <> 2 then
    raise exception 'FAIL: discard affected a different round at the same course'; end if;
  perform public.save_personal_round(v_other,v_payload,false,false);
  perform set_config('request.jwt.claim.sub','15900000-0000-0000-0000-000000000002',true);
  begin
    perform public.save_personal_round(v_id,v_payload,true,false);
    raise exception 'FAIL: edited another users round';
  exception when insufficient_privilege or unique_violation then null; end;
  perform public.discard_personal_round(v_other);
  perform set_config('request.jwt.claim.sub','15900000-0000-0000-0000-000000000001',true);
  if not exists(select 1 from public.rounds where id=v_other) then
    raise exception 'FAIL: another user discarded a hidden round'; end if;
end $$;
-- Completed total-only round: metadata correction preserves gross and never creates holes.
insert into public.rounds(id,user_id,course,course_par,played_at,status,gross_score,rating,slope,handicap_index,course_handicap)
values('15900000-0000-0000-0000-000000000012',auth.uid(),'Test course',72,'2026-09-29','final',85,72,113,12,12);
select public.save_personal_round('15900000-0000-0000-0000-000000000012',
 '{"course":"Test course","course_par":72,"played_at":"2026-09-28","rating":73,"slope":113,"course_handicap":13,"holes":[]}',true,true);
do $$ begin
 if (select gross_score from public.rounds where id='15900000-0000-0000-0000-000000000012') <> 85 or
    exists(select 1 from public.holes where round_id='15900000-0000-0000-0000-000000000012') then
   raise exception 'FAIL: gross-only correction lost total or invented holes'; end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.save_personal_round(uuid,jsonb,boolean,boolean)','execute') or
    has_function_privilege('anon','public.discard_personal_round(uuid)','execute') then
   raise exception 'FAIL: anonymous RPC execution granted'; end if;
end $$;
rollback;
