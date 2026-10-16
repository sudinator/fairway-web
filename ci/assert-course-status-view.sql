-- 0187 (207.1): the status view's facts are right after each outcome.
do $$
declare adm uuid := '18700000-0000-0000-0000-000000000001'; grp uuid := '18700000-0000-0000-0000-000000000011';
        crs uuid := '18700000-0000-0000-0000-000000000021'; r jsonb; rev bigint; ok boolean; s record; first_compared timestamptz;
        base jsonb := '{"name":"Status CC","tees":[{"name":"Blue","rating":70.0,"slope":125}],"holes":[]}';
        api jsonb := '{"name":"Status CC","tees":[{"name":"Blue","rating":70.0,"slope":125},{"name":"Gold","rating":72,"slope":131}],"holes":[]}';
begin
  delete from course_freshness where course_id = crs; delete from course_versions where course_id = crs; delete from group_courses where course_id = crs;
  delete from favorite_courses where id = crs; delete from course_api_check_log where provider_id = 'stat1'; delete from course_api_checks where provider_id = 'stat1';
  delete from group_members where group_id = grp; delete from groups where id = grp; delete from profiles where id = adm; delete from auth.users where id = adm;
  insert into auth.users(id,email) values (adm,'a187@x.com'); insert into profiles(id,display_name,is_admin) values (adm,'Site Admin',true);
  insert into groups(id,name) values (grp,'Status Club'); insert into group_members(group_id,user_id,email,role,status) values (grp,adm,'a187@x.com','admin','active');
  insert into favorite_courses(id,user_id,name,data,external_id) values (crs, adm, 'Status CC', base, 'stat1');
  insert into group_courses(group_id,course_id) values (grp,crs);

  -- A complete check finding an ADDED TEE: counted as a change (it was counted as 0).
  execute 'set local role service_role';
  r := public.record_course_freshness_checked(crs, adm, api, '{"hasChanges":true,"tees":[],"teesAdded":["Gold"],"teesRemoved":[],"holeChanges":[]}', true, 'ok', base);
  execute 'reset role';
  rev := (r->>'revision')::bigint;
  first_compared := (select last_compared_at from course_freshness where course_id = crs);
  if first_compared is null then raise exception 'complete comparison did not set last_compared_at'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  select * into s from public.admin_course_status() where course_id = crs;
  if s.freshness_changes <> 1 then raise exception 'added tee not counted: %', s.freshness_changes; end if;
  if s.current_version is null or s.current_version_source <> 'created' then raise exception 'current version not reported'; end if;
  -- The attempt log accepts 'incomplete'.
  perform public.record_course_api_check('stat1', 'incomplete', null, 'Status CC', null, 'incomplete: no tees', 200);
  -- Keep current data: a stale revision is refused; the reviewed one records its reason.
  begin perform public.dismiss_course_freshness(crs, rev - 1, 'x'); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'kept data against a stale revision'; end if;
  perform public.dismiss_course_freshness(crs, rev, 'provider tee is a temporary one');
  execute 'reset role';
  if (select status || '|' || decision_reason || '|' || (decided_by = adm)::text from course_freshness where course_id = crs) <> 'dismissed|provider tee is a temporary one|true' then
    raise exception 'dismissal not recorded with reason and who';
  end if;
  -- An INCOMPLETE check later does not move the last genuine comparison.
  perform pg_sleep(0.01);
  execute 'set local role service_role';
  perform public.record_course_freshness_checked(crs, adm, api, '{"incomplete":["no slope"]}', false, 'incomplete', base);
  execute 'reset role';
  if (select last_compared_at from course_freshness where course_id = crs) is distinct from first_compared then raise exception 'incomplete check moved last_compared_at'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  select * into s from public.admin_course_status() where course_id = crs;
  if s.freshness_check_state <> 'incomplete' or s.last_check_status <> 'incomplete' then raise exception 'incomplete outcome not reported: % / %', s.freshness_check_state, s.last_check_status; end if;
  -- The old status setter (which could mark 'applied' without applying) is gone.
  if to_regprocedure('public.set_course_freshness_status(uuid,text)') is not null then raise exception 'set_course_freshness_status still exists'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from course_freshness where course_id = crs; delete from course_versions where course_id = crs; delete from group_courses where course_id = crs;
  delete from favorite_courses where id = crs; delete from course_api_check_log where provider_id = 'stat1'; delete from course_api_checks where provider_id = 'stat1';
  delete from group_members where group_id = grp; delete from groups where id = grp; delete from profiles where id = adm; delete from auth.users where id = adm;
  raise notice 'COURSE_STATUS_VIEW_PASS full change count; current version; keep-data bound to revision with reason; incomplete keeps the last genuine comparison';
end $$;
