-- 0192 (209.1): apply selected provider changes — server only, everything re-checked, declines remembered.
do $$
declare sys uuid := '19200000-0000-0000-0000-000000000001'; mem uuid := '19200000-0000-0000-0000-000000000002';
        c uuid := '19200000-0000-0000-0000-000000000011';
        stored jsonb; api jsonb; merged jsonb; bad jsonb; si jsonb; r jsonb; ok boolean; v int; rev bigint;
begin
  delete from course_freshness where course_id = c; delete from course_versions where course_id = c; delete from favorite_courses where id = c;
  delete from profiles where id in (sys, mem); delete from auth.users where id in (sys, mem);
  insert into auth.users(id, email) values (sys, 'sys@c192.test'), (mem, 'mem@c192.test');
  insert into profiles(id, display_name, email, is_admin, account_status) values (sys, 'Sys', 'sys@c192.test', true, 'active'), (mem, 'Mem', 'mem@c192.test', false, 'active');
  si := (select jsonb_agg(jsonb_build_object('n', i, 'par', 4, 'si', i) order by i) from generate_series(1, 18) i);
  stored := jsonb_build_object('name', 'Oak 192', 'tees', jsonb_build_array(jsonb_build_object('name', 'Blue', 'rating', 71.2, 'slope', 125, 'par', 72)), 'holes', si);
  api := jsonb_build_object('name', 'Oak 192', 'tees', jsonb_build_array(jsonb_build_object('name', 'Blue', 'rating', 71.2, 'slope', 128, 'par', 72)), 'holes', si);
  insert into favorite_courses(id, user_id, name, data) values (c, sys, 'Oak 192', stored);   -- history version 1 ('initial')
  insert into course_freshness(course_id, checked_at, api_data, diff, has_changes, status, revision, base_hash, check_state)
    values (c, now(), api, '{}'::jsonb, true, 'pending', 7, md5(stored::text), 'ok');
  select revision into rev from course_freshness where course_id = c;   -- assigned by the 0183 revision rule
  merged := jsonb_set(stored, '{tees,0,slope}', '128');

  -- The review detail carries the provider's last version (here the starting snapshot).
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', sys::text, true);
  r := public.course_review_detail(c);
  if r->'last_provider' is null or (r->>'revision')::bigint <> rev then raise exception 'review detail incomplete: %', r; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);

  -- App users can't call the apply directly — CHECKED by privilege, never by calling (Supabase PG 17.6 ≤ .111 bug).
  if has_function_privilege('authenticated', 'public.apply_course_freshness_selected_as(uuid,uuid,bigint,jsonb,text[],jsonb)', 'execute') then raise exception 'apply callable from the app'; end if;
  execute 'set local role service_role';
  -- a member who can't administer the course
  begin perform public.apply_course_freshness_selected_as(mem, c, rev, merged, array['slope:blue'], '{}'); ok := false; exception when others then ok := sqlerrm like '%club admin required%'; end;
  if not ok then raise exception 'a non-admin applied changes'; end if;
  -- an out-of-date review
  begin perform public.apply_course_freshness_selected_as(sys, c, rev - 1, merged, array['slope:blue'], '{}'); ok := false; exception when others then ok := sqlerrm like '%re-checked since%'; end;
  if not ok then raise exception 'a stale review applied'; end if;
  -- a broken set of stroke indexes (two holes on 1)
  bad := jsonb_set(merged, '{holes,1,si}', '1');
  begin perform public.apply_course_freshness_selected_as(sys, c, rev, bad, array['si'], '{}'); ok := false; exception when others then ok := sqlerrm like '%stroke indexes must be 1 to 18%'; end;
  if not ok then raise exception 'an invalid stroke-index set was saved'; end if;
  execute 'reset role';
  -- the course edited after the check
  update favorite_courses set data = jsonb_set(stored, '{tees,0,rating}', '71.5') where id = c;
  execute 'set local role service_role';
  begin perform public.apply_course_freshness_selected_as(sys, c, rev, merged, array['slope:blue'], '{}'); ok := false; exception when others then ok := sqlerrm like '%edited after this check%'; end;
  execute 'reset role';
  if not ok then raise exception 'applied over an edit made after the check'; end if;
  update favorite_courses set data = stored where id = c;
  update course_freshness set base_hash = md5((select data::text from favorite_courses where id = c)) where course_id = c;

  -- The real apply: Blue slope taken, a decline remembered, one history version naming what was taken.
  select max(version) into v from course_versions where course_id = c;
  execute 'set local role service_role';
  r := public.apply_course_freshness_selected_as(sys, c, (select revision from course_freshness where course_id = c), merged, array['slope:blue'], '{"tee_remove:red": null}'::jsonb);
  execute 'reset role';
  if (select (data->'tees'->0->>'slope')::int from favorite_courses where id = c) <> 128 then raise exception 'slope not applied'; end if;
  if (select status from course_freshness where course_id = c) <> 'applied' then raise exception 'not marked applied'; end if;
  if not ((select declined from course_freshness where course_id = c) ? 'tee_remove:red') then raise exception 'decline not remembered'; end if;
  if (select reason from course_versions where course_id = c order by version desc limit 1) not like '%selected: slope:blue%' or (select max(version) from course_versions where course_id = c) <> v + 1 then
    raise exception 'history does not record exactly what was taken'; end if;

  delete from course_freshness where course_id = c; delete from course_versions where course_id = c; delete from favorite_courses where id = c;
  delete from profiles where id in (sys, mem); delete from auth.users where id in (sys, mem);
  raise notice 'COURSE_SELECTIVE_PASS server only; admin, revision, unedited course and valid stroke indexes enforced; one history version naming what was taken; declines remembered';
end $$;
