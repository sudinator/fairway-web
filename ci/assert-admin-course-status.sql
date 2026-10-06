-- 0169: the Admin course-status view. One row per library course with provider verification,
-- freshness review and pending corrections; app admin only.
do $$
declare
  app uuid := '16900000-0000-0000-0000-000000000001'; mem uuid := '16900000-0000-0000-0000-000000000002';
  ga uuid := '16900000-0000-0000-0000-000000000011'; c1 uuid := '16900000-0000-0000-0000-000000000021';
begin
  delete from course_change_requests where course_id = c1; delete from course_freshness where course_id = c1;
  delete from course_api_checks where provider_id = 'adm00001'; delete from group_courses where course_id = c1;
  delete from favorite_courses where id = c1; delete from group_members where group_id = ga; delete from groups where id = ga;
  delete from profiles where id in (app, mem); delete from auth.users where id in (app, mem);
  insert into auth.users(id,email) values (app,'adm@example.com'),(mem,'m@example.com');
  insert into profiles(id,display_name,is_admin) values (app,'App Admin',true),(mem,'Member',false);
  insert into groups(id,name) values (ga,'Status Club');
  insert into group_members(group_id,user_id,email,role,status) values (ga,app,'adm@example.com','admin','active'),(ga,mem,'m@example.com','member','active');
  insert into favorite_courses(id,group_id,user_id,name,external_id,data) values (c1,null,app,'Status Course','adm00001','{"name":"Status Course","tees":[],"holes":[],"corrected":true}');
  insert into group_courses(group_id,course_id,added_by) values (ga,c1,app);
  execute 'set local role service_role';
  perform public.record_course_api_check('adm00001','ok','Club','Status Course','Town',null,200);
  perform public.record_course_freshness_system('adm00001','{"name":"Status Course","tees":[],"holes":[]}'::jsonb,
    '{"tees":[{"name":"Blue","ratingChanged":true,"slopeChanged":false,"yardageChanges":[{"hole":1,"from":1,"to":2},{"hole":2,"from":3,"to":4}]}],"hasChanges":true}'::jsonb, true);
  execute 'reset role';
  insert into course_change_requests(course_id,group_id,submitted_by,proposed_name,proposed_data,status) values (c1,ga,mem,'Status Course','{}'::jsonb,'pending');
end $$;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','16900000-0000-0000-0000-000000000001',true);
do $$ declare r record; begin
  select * into r from public.admin_course_status() where course_id = '16900000-0000-0000-0000-000000000021';
  if r.course_id is null then raise exception 'admin sees no row'; end if;
  if r.clubs <> 'Status Club' then raise exception 'clubs: %', r.clubs; end if;
  if r.last_check_status <> 'ok' or r.last_verified_at is null then raise exception 'verification columns: % %', r.last_check_status, r.last_verified_at; end if;
  if r.freshness_status <> 'pending' or r.freshness_changes <> 3 then raise exception 'freshness columns: % %', r.freshness_status, r.freshness_changes; end if;
  if r.pending_requests <> 1 or r.oldest_request_at is null then raise exception 'pending requests: %', r.pending_requests; end if;
  if r.corrected is not true then raise exception 'corrected flag'; end if;
end $$;
select set_config('request.jwt.claim.sub','16900000-0000-0000-0000-000000000002',true);
do $$ begin
  if (select count(*) from public.admin_course_status()) <> 0 then raise exception 'non-admin can read admin_course_status'; end if;
  raise notice 'ADMIN_COURSE_STATUS_PASS one row per course with verification, freshness and pending corrections; admin only';
end $$;
rollback;
delete from course_change_requests where course_id = '16900000-0000-0000-0000-000000000021'; delete from course_freshness where course_id = '16900000-0000-0000-0000-000000000021';
delete from course_api_checks where provider_id = 'adm00001'; delete from group_courses where course_id = '16900000-0000-0000-0000-000000000021';
delete from notifications where user_id in ('16900000-0000-0000-0000-000000000001','16900000-0000-0000-0000-000000000002');
delete from favorite_courses where id = '16900000-0000-0000-0000-000000000021'; delete from group_members where group_id = '16900000-0000-0000-0000-000000000011'; delete from groups where id = '16900000-0000-0000-0000-000000000011';
delete from profiles where id in ('16900000-0000-0000-0000-000000000001','16900000-0000-0000-0000-000000000002'); delete from auth.users where id in ('16900000-0000-0000-0000-000000000001','16900000-0000-0000-0000-000000000002');
