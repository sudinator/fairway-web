-- 0197 (210.3): only approved accounts change data directly; a kept correction keeps its protection.
do $$
declare act uuid := '19700000-0000-0000-0000-000000000001'; pend uuid := '19700000-0000-0000-0000-000000000002';
        sus uuid := '19700000-0000-0000-0000-000000000003'; c uuid := '19700000-0000-0000-0000-000000000011';
        rs uuid := '19700000-0000-0000-0000-000000000021'; ok boolean; d jsonb;
begin
  delete from course_freshness where course_id = c; delete from course_versions where course_id = c;
  delete from favorite_courses where user_id in (act, pend, sus); delete from rounds where user_id in (act, pend, sus);
  delete from profiles where id in (act, pend, sus); delete from auth.users where id in (act, pend, sus);
  insert into auth.users(id, email) values (act, 'a@a197.test'), (pend, 'p@a197.test'), (sus, 's@a197.test');
  insert into profiles(id, display_name, email, account_status, is_admin) values (act, 'Active', 'a@a197.test', 'active', true), (pend, 'Pending', 'p@a197.test', 'pending', false), (sus, 'Suspended', 's@a197.test', 'suspended', false);
  insert into rounds(id, user_id, course, played_at, status) values (rs, sus, 'R197', current_date, 'final');

  execute 'set local role authenticated';
  -- a pending account: no shared course, no round — but its own profile name, yes
  perform set_config('request.jwt.claim.sub', pend::text, true);
  begin insert into favorite_courses(user_id, name, data) values (pend, 'Pending Course', '{}'); ok := false; exception when others then ok := sqlerrm like '%can''t make changes%'; end;
  if not ok then raise exception 'a pending account added a shared course'; end if;
  begin insert into rounds(user_id, course, played_at, status) values (pend, 'R197', current_date, 'final'); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a pending account recorded a round'; end if;   -- refused (by this rule or the scoring-device rule)
  update profiles set display_name = 'Pending Pat' where id = pend;
  -- a suspended account: can't change its own round, and can't write to a table only THIS rule guards
  perform set_config('request.jwt.claim.sub', sus::text, true);
  begin update rounds set course = 'Changed' where id = rs; ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a suspended account changed its round'; end if;
  begin insert into activity_log(actor_id, action, summary) values (sus, 'x', 'x'); ok := false; exception when others then ok := sqlerrm like '%can''t make changes%'; end;
  if not ok then raise exception 'a suspended account wrote to the activity log (this rule did not refuse it)'; end if;
  -- an active member: both work
  perform set_config('request.jwt.claim.sub', act::text, true);
  insert into favorite_courses(id, user_id, name, data) values (c, act, 'Oak 197', '{"name":"Oak 197","tees":[{"name":"Blue","rating":73,"slope":125,"par":72}],"holes":[]}');
  insert into activity_log(actor_id, action, summary) values (act, 'a197', 'allowed');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if (select display_name from profiles where id = pend) <> 'Pending Pat' then raise exception 'a pending account could not edit its own profile name'; end if;
  if (select course from rounds where id = rs) <> 'R197' then raise exception 'the suspended round changed'; end if;

  -- point 1: the provider's own data is saved when an update is applied, and the review compares against it
  insert into course_freshness(course_id, checked_at, api_data, diff, has_changes, status, revision, base_hash, check_state)
    values (c, now(), '{"name":"Oak 197","tees":[{"name":"Blue","rating":74,"slope":128,"par":72}],"holes":[]}', '{}', true, 'pending', 1, 'x', 'ok');
  update course_freshness set status = 'applied' where course_id = c;
  if (select provider_baseline->'tees'->0->>'rating' from course_freshness where course_id = c) <> '74' then raise exception 'the provider baseline was not saved on apply'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', act::text, true);
  d := public.course_review_detail(c);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if d->'last_provider'->'tees'->0->>'rating' <> '74' then raise exception 'the review does not compare against the provider baseline: %', d->'last_provider'; end if;

  delete from course_freshness where course_id = c; delete from course_versions where course_id = c;
  delete from favorite_courses where user_id in (act, pend, sus); delete from rounds where user_id in (act, pend, sus);
  delete from activity_log where actor_id in (act, pend, sus);
  delete from profiles where id in (act, pend, sus); delete from auth.users where id in (act, pend, sus);
  raise notice 'ACTIVE_ACCOUNTS_PASS pending / suspended accounts can''t write directly (own profile name still editable); provider baseline saved and used';
end $$;
