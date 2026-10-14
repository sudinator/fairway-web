-- 0183 (review findings 1, 2, 6): a member cannot supply provider data; approval applies only the
-- exact pending, complete revision of an unchanged course; incomplete checks never carry a payload.
do $$
declare mem uuid := '18300000-0000-0000-0000-000000000001'; adm uuid := '18300000-0000-0000-0000-000000000002';
        out_ uuid := '18300000-0000-0000-0000-000000000003'; grp uuid := '18300000-0000-0000-0000-000000000011';
        crs uuid := '18300000-0000-0000-0000-000000000021';
        good jsonb := '{"name":"Integrity CC","tees":[{"name":"Blue","rating":70.1,"slope":125}],"holes":[]}';
        r jsonb; rev bigint; ok boolean;
begin
  delete from course_freshness where course_id = crs; delete from group_courses where course_id = crs;
  delete from favorite_courses where id = crs; delete from group_members where group_id = grp; delete from groups where id = grp;
  delete from profiles where id in (mem, adm, out_); delete from auth.users where id in (mem, adm, out_);
  insert into auth.users(id,email) values (mem,'m183@x.com'),(adm,'a183@x.com'),(out_,'o183@x.com');
  insert into profiles(id,display_name) values (mem,'Member'),(adm,'Admin'),(out_,'Outsider');
  insert into groups(id,name) values (grp,'Integrity Club');
  insert into group_members(group_id,user_id,email,role,status) values (grp,mem,'m183@x.com','member','active'),(grp,adm,'a183@x.com','admin','active');
  insert into favorite_courses(id,user_id,name,data,external_id) values (crs, adm, 'Integrity CC', '{"name":"Integrity CC","tees":[{"name":"Blue","rating":70.0,"slope":124}],"holes":[]}', 'prov1');
  insert into group_courses(group_id,course_id) values (grp,crs);

  -- Finding 1: the browser path is gone, and app roles cannot call the server's recorder.
  if to_regprocedure('public.record_course_freshness(uuid,jsonb,jsonb,boolean)') is not null then raise exception 'browser recorder still exists'; end if;
  if has_function_privilege('authenticated', 'public.record_course_freshness_checked(uuid,uuid,jsonb,jsonb,boolean,text)', 'execute') then raise exception 'members can call the server recorder'; end if;

  -- The server records for a verified member; an outsider is refused even via the service role.
  execute 'set local role service_role';
  begin perform public.record_course_freshness_checked(crs, out_, good, '{"hasChanges":true,"tees":[1]}', true, 'ok'); ok := false;
  exception when others then ok := true; end;
  if not ok then raise exception 'outsider recorded a check'; end if;
  r := public.record_course_freshness_checked(crs, mem, good, '{"hasChanges":true,"tees":[1]}', true, 'ok');
  execute 'reset role';
  if (r->>'saved')::boolean is not true or (r->>'status') <> 'pending' then raise exception 'check not saved as pending: %', r; end if;
  rev := (r->>'revision')::bigint;

  -- Finding 2a: approving a STALE revision is refused.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  begin perform public.apply_course_freshness(crs, rev - 1); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'stale revision applied'; end if;

  -- Finding 2b: a hand correction AFTER the check makes the reviewed payload stale.
  execute 'reset role';
  update favorite_courses set data = jsonb_set(data, '{corrected}', 'true') where id = crs;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  begin perform public.apply_course_freshness(crs, rev); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'applied over a newer hand correction'; end if;
  if (select (data->>'corrected')::boolean from favorite_courses where id = crs) is not true then raise exception 'hand correction overwritten'; end if;

  -- Re-check (new revision fingerprints the corrected course) → approval of THAT revision applies.
  execute 'reset role';
  execute 'set local role service_role';
  r := public.record_course_freshness_checked(crs, mem, good, '{"hasChanges":true,"tees":[1]}', true, 'ok');
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform public.apply_course_freshness(crs, (r->>'revision')::bigint);
  -- Finding 2c: an already-applied snapshot cannot be applied again.
  begin perform public.apply_course_freshness(crs, (r->>'revision')::bigint); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'applied twice'; end if;
  -- A plain member can never approve.
  perform set_config('request.jwt.claim.sub', mem::text, true);
  begin perform public.apply_course_freshness(crs, (r->>'revision')::bigint); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'member approved'; end if;
  execute 'reset role';
  if (select data->'tees'->0->>'rating' from favorite_courses where id = crs) <> '70.1' then raise exception 'approved revision not applied'; end if;

  -- Finding 6: an incomplete provider response is recorded as such, with nothing to apply.
  execute 'set local role service_role';
  r := public.record_course_freshness_checked(crs, mem, good, '{"incomplete":["tee Blue: no slope"]}', true, 'incomplete');
  execute 'reset role';
  if (r->>'check_state') <> 'incomplete' or (select api_data from course_freshness where course_id = crs) is not null then raise exception 'incomplete check kept a payload: %', r; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  begin perform public.apply_course_freshness(crs, (r->>'revision')::bigint); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'incomplete check applied'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from course_freshness where course_id = crs; delete from group_courses where course_id = crs;
  delete from favorite_courses where id = crs; delete from group_members where group_id = grp; delete from groups where id = grp;
  delete from profiles where id in (mem, adm, out_); delete from auth.users where id in (mem, adm, out_);
  raise notice 'COURSE_FRESHNESS_INTEGRITY_PASS no browser-supplied data; exact pending revision of an unchanged course only; incomplete checks inert';
end $$;
