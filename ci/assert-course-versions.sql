-- 0186 (207.0): course history and restore — the proposal's acceptance test, plus coverage of the
-- edit paths, the starting snapshot, and the restore permissions.
do $$
declare adm uuid := '18600000-0000-0000-0000-000000000001'; mem uuid := '18600000-0000-0000-0000-000000000002';
        grp uuid := '18600000-0000-0000-0000-000000000011'; crs uuid := '18600000-0000-0000-0000-000000000021';
        rnd uuid := '18600000-0000-0000-0000-000000000031';
        v0 jsonb := '{"name":"History CC","tees":[{"name":"Blue","rating":70.0,"slope":125}],"holes":[]}';
        api jsonb := '{"name":"History CC","tees":[{"name":"Blue","rating":70.0,"slope":132}],"holes":[]}';
        r jsonb; n integer; ok boolean; rev bigint;
begin
  delete from rounds where id = rnd; delete from course_freshness where course_id = crs; delete from course_versions where course_id = crs;
  delete from group_courses where course_id = crs; delete from favorite_courses where id = crs;
  delete from group_members where group_id = grp; delete from groups where id = grp;
  delete from profiles where id in (adm, mem); delete from auth.users where id in (adm, mem);
  insert into auth.users(id,email) values (adm,'a186@x.com'),(mem,'m186@x.com');
  insert into profiles(id,display_name,is_admin) values (adm,'Site Admin',true),(mem,'Member',false);
  insert into groups(id,name) values (grp,'History Club');
  insert into group_members(group_id,user_id,email,role,status) values (grp,adm,'a186@x.com','admin','active'),(grp,mem,'m186@x.com','member','active');

  -- Creation is version 1 ('created').
  insert into favorite_courses(id,user_id,name,data,external_id) values (crs, adm, 'History CC', v0, 'hist1');
  insert into group_courses(group_id,course_id) values (grp,crs);
  if (select source from course_versions where course_id = crs and version = 1) <> 'created' then raise exception 'creation not recorded'; end if;
  -- A flag-only change is NOT a version.
  update favorite_courses set vetted = true where id = crs;
  if (select count(*) from course_versions where course_id = crs) <> 1 then raise exception 'flag-only change recorded as a version'; end if;
  -- A historical round with its own snapshot of the course.
  insert into rounds(id,user_id,course,played_at,status,rating,slope) values (rnd, mem, 'History CC', '2026-09-01', 'final', 70.0, 125);

  -- Apply a provider update (approved revision) → version 2 'provider_update', by the admin.
  execute 'set local role service_role';
  r := public.record_course_freshness_checked(crs, mem, api, '{"hasChanges":true,"tees":[1]}', true, 'ok', (select data from favorite_courses where id = crs));
  execute 'reset role';
  rev := (r->>'revision')::bigint;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform public.apply_course_freshness(crs, rev);
  execute 'reset role';
  if (select source || '|' || coalesce(actor::text,'') from course_versions where course_id = crs and version = 2) <> 'provider_update|' || adm then
    raise exception 'provider update not recorded with source and actor: %', (select source from course_versions where course_id = crs and version = 2);
  end if;
  -- Inspect the change: version 1 and 2 hold the before / after content.
  if (select data->'tees'->0->>'slope' from course_versions where course_id = crs and version = 1) <> '125'
     or (select data->'tees'->0->>'slope' from course_versions where course_id = crs and version = 2) <> '132' then raise exception 'versions do not hold before/after'; end if;

  -- A provider check recorded against v2, pending review…
  execute 'set local role service_role';
  r := public.record_course_freshness_checked(crs, mem, v0, '{"hasChanges":true,"tees":[1]}', true, 'ok', (select data from favorite_courses where id = crs));
  execute 'reset role';
  rev := (r->>'revision')::bigint;

  -- Restore permissions: a member cannot; no reason is refused; the current version is refused.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', mem::text, true);
  begin perform public.restore_course_version(crs, 1, 'trying'); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a member restored a shared course'; end if;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  begin perform public.restore_course_version(crs, 1, ''); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'restore without a reason'; end if;
  begin perform public.restore_course_version(crs, 2, 'already current'); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'restored the current version onto itself'; end if;
  -- Restore version 1 → a NEW version 3 ('restore', with the reason).
  n := public.restore_course_version(crs, 1, 'Provider slope was wrong');
  execute 'reset role';
  if n <> 3 then raise exception 'restore should create version 3, got %', n; end if;
  if (select data->'tees'->0->>'slope' from favorite_courses where id = crs) <> '125' then raise exception 'restored course is not current'; end if;
  if (select count(*) from course_versions where course_id = crs) <> 3 then raise exception 'history not intact'; end if;
  if (select source || '|' || reason from course_versions where course_id = crs and version = 3) <> 'restore|Provider slope was wrong' then raise exception 'restore entry'; end if;
  -- Historical rounds unchanged.
  if (select slope from rounds where id = rnd) <> 125 then raise exception 'historical round changed'; end if;
  -- The approval pending against the pre-restore course is now stale and blocked.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  begin perform public.apply_course_freshness(crs, rev); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'stale approval applied over a restore'; end if;
  -- App roles cannot write history.
  begin insert into course_versions(course_id,version,source) values (crs, 99, 'manual_edit'); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'app role wrote a history row'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);

  -- A manual edit (any direct update) is recorded as 'manual_edit'.
  update favorite_courses set data = jsonb_set(data, '{corrected}', 'true') where id = crs;
  if (select source from course_versions where course_id = crs and version = 4) <> 'manual_edit' then raise exception 'manual edit not recorded'; end if;

  delete from rounds where id = rnd; delete from course_freshness where course_id = crs; delete from course_versions where course_id = crs;
  delete from group_courses where course_id = crs; delete from favorite_courses where id = crs;
  delete from group_members where group_id = grp; delete from groups where id = grp;
  delete from profiles where id in (adm, mem); delete from auth.users where id in (adm, mem);
  raise notice 'COURSE_VERSIONS_PASS every content change versioned with source; restore = new version, site admin + reason; rounds untouched; stale approval blocked';
end $$;
