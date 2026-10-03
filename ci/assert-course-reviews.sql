-- 0167: the course review queue. Executed on real rows against the full chain.
--   * a second provider change REOPENS a dismissed review and notifies again; the same diff does not
--   * pending_course_reviews: app admin sees every club, club admin sees their own, member sees none
--   * apply_course_freshness writes the provider data and marks applied; a member is refused
do $$
declare
  app uuid := '16700000-0000-0000-0000-000000000001';   -- app admin
  ca  uuid := '16700000-0000-0000-0000-000000000002';   -- admin of club A only
  mem uuid := '16700000-0000-0000-0000-000000000003';   -- member of club A
  ga  uuid := '16700000-0000-0000-0000-000000000011';
  gb  uuid := '16700000-0000-0000-0000-000000000012';
  c1  uuid := '16700000-0000-0000-0000-000000000021';   -- club A course
  c2  uuid := '16700000-0000-0000-0000-000000000022';   -- club B course
  diff1 jsonb := '{"tees":[{"name":"Blue","ratingChanged":false,"slopeChanged":false,"yardageChanges":[{"hole":1,"from":999,"to":359}]}],"hasChanges":true}';
  diff2 jsonb := '{"tees":[{"name":"Blue","ratingChanged":true,"ratingFrom":70.1,"ratingTo":69.8,"slopeChanged":false,"yardageChanges":[]}],"hasChanges":true}';
  api1 jsonb := '{"name":"Course One","tees":[{"name":"Blue","rating":70.1,"slope":125,"par":36,"yardages":[359]}],"holes":[]}';
  n integer; st text;
begin
  -- clean start (also after a crashed run)
  delete from notifications where user_id in (app, ca, mem);
  delete from course_freshness where course_id in (c1, c2, '16700000-0000-0000-0000-000000000023');
  delete from group_courses where course_id in (c1, c2, '16700000-0000-0000-0000-000000000023');
  delete from favorite_courses where id in (c1, c2, '16700000-0000-0000-0000-000000000023');
  delete from group_members where group_id in (ga, gb);
  delete from groups where id in (ga, gb);
  delete from profiles where id in (app, ca, mem);
  delete from auth.users where id in (app, ca, mem);

  insert into auth.users(id,email) values (app,'app@example.com'),(ca,'ca@example.com'),(mem,'mem@example.com');
  insert into profiles(id,display_name,is_admin) values (app,'App Admin',true),(ca,'Club Admin',false),(mem,'Member',false);
  insert into groups(id,name) values (ga,'Club A'),(gb,'Club B');
  insert into group_members(group_id,user_id,email,role,status) values
    (ga,app,'app@example.com','admin','active'),(ga,ca,'ca@example.com','admin','active'),(ga,mem,'mem@example.com','member','active'),
    (gb,app,'app@example.com','admin','active');
  -- THE PRODUCTION CASE (0168): group_id is NULL (legacy column, cleared by club delete/merge); the
  -- course belongs to club A through the group_courses link. c2 keeps the legacy column only.
  insert into favorite_courses(id,group_id,user_id,name,external_id,data) values
    (c1,null,app,'Course One','rev00001','{"name":"Course One","tees":[{"name":"Blue","rating":70.1,"slope":125,"par":36,"yardages":[999]}],"holes":[],"corrected":true}'),
    (c2,gb,app,'Course Two','rev00002','{"name":"Course Two","tees":[],"holes":[]}');
  insert into group_courses(group_id,course_id,added_by) values (ga,c1,app);

  -- First detection: pending + one notice per club admin.
  execute 'set local role service_role';
  perform public.record_course_freshness_system('rev00001', api1, diff1, true);
  perform public.record_course_freshness_system('rev00002', api1, diff1, true);
  execute 'reset role';
  select count(*) into n from notifications where type = 'course_change' and user_id = ca;
  if n <> 1 then raise exception 'club admin got % notices for first detection, expected 1', n; end if;

  -- Dismiss c1, re-record the SAME diff: stays dismissed, no new notice.
  update course_freshness set status = 'dismissed' where course_id = c1;
  execute 'set local role service_role';
  perform public.record_course_freshness_system('rev00001', api1, diff1, true);
  execute 'reset role';
  select status into st from course_freshness where course_id = c1;
  if st <> 'dismissed' then raise exception 'same diff changed status to %', st; end if;
  select count(*) into n from notifications where type = 'course_change' and user_id = ca;
  if n <> 1 then raise exception 'same diff produced a new notice'; end if;

  -- A DIFFERENT diff reopens it and notifies again. Before 0167 this stayed dismissed forever.
  execute 'set local role service_role';
  perform public.record_course_freshness_system('rev00001', api1, diff2, true);
  execute 'reset role';
  select status into st from course_freshness where course_id = c1;
  if st <> 'pending' then raise exception 'new diff did not reopen: status %', st; end if;
  select count(*) into n from notifications where type = 'course_change' and user_id = ca;
  if n <> 2 then raise exception 'new diff did not notify again (% notices)', n; end if;

  -- An UNLINKED course (no club at all) is recorded and notifies the app admins instead of failing.
  delete from notifications where user_id = app and type = 'course_change';
  insert into favorite_courses(id,group_id,user_id,name,external_id,data) values
    ('16700000-0000-0000-0000-000000000023',null,app,'Course Three','rev00003','{"name":"Course Three","tees":[],"holes":[]}');
  execute 'set local role service_role';
  perform public.record_course_freshness_system('rev00003', api1, diff1, true);
  execute 'reset role';
  if (select status from course_freshness where course_id = '16700000-0000-0000-0000-000000000023') <> 'pending' then raise exception 'unlinked course not recorded'; end if;
  if (select count(*) from notifications where user_id = app and type = 'course_change') <> 1 then raise exception 'unlinked course did not notify the app admin'; end if;
  raise notice 'COURSE_REVIEWS_REOPEN_PASS same diff keeps the decision, a new diff reopens and notifies, null group_id works via links';
end $$;

-- Queue scoping and apply, as each caller.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '16700000-0000-0000-0000-000000000001', true);
do $$ declare n integer; begin
  select count(*) into n from public.pending_course_reviews();
  if n <> 3 then raise exception 'app admin sees % pending, expected 3 (two clubs + one unlinked)', n; end if;
  if (select club_name from public.pending_course_reviews() where course_name = 'Course Three') <> 'No club' then raise exception 'unlinked course club label wrong'; end if;
  if (select club_name from public.pending_course_reviews() where course_name = 'Course One') <> 'Club A' then raise exception 'linked club not resolved through group_courses'; end if;
end $$;
select set_config('request.jwt.claim.sub', '16700000-0000-0000-0000-000000000002', true);
do $$ declare n integer; r record; begin
  select count(*) into n from public.pending_course_reviews();
  if n <> 1 then raise exception 'club admin sees % pending, expected 1 (own club only)', n; end if;
  select * into r from public.pending_course_reviews();
  if r.club_name <> 'Club A' or r.corrected is not true then raise exception 'queue row wrong: % corrected=%', r.club_name, r.corrected; end if;
end $$;
select set_config('request.jwt.claim.sub', '16700000-0000-0000-0000-000000000003', true);
do $$ begin
  if (select count(*) from public.pending_course_reviews()) <> 0 then raise exception 'member can see the queue'; end if;
  begin
    perform public.set_course_freshness_status('16700000-0000-0000-0000-000000000021', 'dismissed');
    raise exception 'member dismissed a review';
  exception when insufficient_privilege then null; end;
  begin
    perform public.apply_course_freshness('16700000-0000-0000-0000-000000000021');
    raise exception 'member applied a course update';
  exception when insufficient_privilege then null; end;
end $$;
-- Club admin applies their club's course (not the app admin): this is the right 0167 widened.
select set_config('request.jwt.claim.sub', '16700000-0000-0000-0000-000000000002', true);
select public.apply_course_freshness('16700000-0000-0000-0000-000000000021');
select public.set_course_freshness_status('16700000-0000-0000-0000-000000000021', 'applied');  -- dismiss/apply status path on a null-group course
do $$ begin
  begin
    perform public.apply_course_freshness('16700000-0000-0000-0000-000000000022');
    raise exception 'club admin applied another club''s course';
  exception when insufficient_privilege then null; end;
end $$;
commit;
do $$ declare y jsonb; st text; begin
  select data->'tees'->0->'yardages'->0, (select status from course_freshness where course_id = '16700000-0000-0000-0000-000000000021')
    into y, st from favorite_courses where id = '16700000-0000-0000-0000-000000000021';
  if y::text <> '359' or st <> 'applied' then raise exception 'apply did not write provider data / status: % %', y, st; end if;
  raise notice 'COURSE_REVIEWS_QUEUE_PASS app admin all clubs, club admin own club, member nothing; apply writes and is gated';
end $$;

-- cleanup
delete from notifications where user_id in ('16700000-0000-0000-0000-000000000001','16700000-0000-0000-0000-000000000002','16700000-0000-0000-0000-000000000003');
delete from course_freshness where course_id in ('16700000-0000-0000-0000-000000000021','16700000-0000-0000-0000-000000000022','16700000-0000-0000-0000-000000000023');
delete from group_courses where course_id in ('16700000-0000-0000-0000-000000000021','16700000-0000-0000-0000-000000000022','16700000-0000-0000-0000-000000000023');
delete from favorite_courses where id in ('16700000-0000-0000-0000-000000000021','16700000-0000-0000-0000-000000000022','16700000-0000-0000-0000-000000000023');
delete from group_members where group_id in ('16700000-0000-0000-0000-000000000011','16700000-0000-0000-0000-000000000012');
delete from groups where id in ('16700000-0000-0000-0000-000000000011','16700000-0000-0000-0000-000000000012');
delete from profiles where id in ('16700000-0000-0000-0000-000000000001','16700000-0000-0000-0000-000000000002','16700000-0000-0000-0000-000000000003');
delete from auth.users where id in ('16700000-0000-0000-0000-000000000001','16700000-0000-0000-0000-000000000002','16700000-0000-0000-0000-000000000003');
