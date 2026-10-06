-- 0170: failing vs dormant push endpoints, device-naming drill-down, 60-day prune.
-- Seeds Amit's exact production shape: one iPhone endpoint from July last seen Aug (dormant, 0
-- fails), one from October seen today (healthy); plus a genuinely failing endpoint for another user.
do $$
declare a uuid := '17000000-0000-0000-0000-000000000001'; b uuid := '17000000-0000-0000-0000-000000000002'; adm uuid := '17000000-0000-0000-0000-000000000003';
begin
  delete from push_subscriptions where user_id in (a, b, adm);
  delete from profiles where id in (a, b, adm); delete from auth.users where id in (a, b, adm);
  insert into auth.users(id,email) values (a,'a@x.com'),(b,'b@x.com'),(adm,'adm@x.com');
  insert into profiles(id,display_name,is_admin) values (a,'Dormant Dave',false),(b,'Failing Fran',false),(adm,'Admin',true);
  insert into push_subscriptions(user_id,endpoint,p256dh,auth,platform,user_agent,disabled,fail_count,created_at,last_seen) values
    (a,'https://web.push.apple.com/old-1','k','k','ios','Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit',false,0, now()-interval '88 days', now()-interval '44 days'),
    (a,'https://web.push.apple.com/new-1','k','k','ios','Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit',false,0, now()-interval '4 days',  now()),
    (b,'https://fcm.googleapis.com/f-1',  'k','k','Win32','Mozilla/5.0 (Windows NT 10.0) Chrome',false,5, now()-interval '30 days', now()-interval '2 days'),
    (b,'https://fcm.googleapis.com/f-2',  'k','k','Win32','Mozilla/5.0 (Windows NT 10.0) Chrome',false,0, now()-interval '90 days', now()-interval '75 days');
end $$;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000003',true);
do $$ declare j jsonb; r record; n integer; begin
  j := public.admin_push_device_stats();
  if (j->>'failing_endpoints')::int < 1 or (j->>'dormant_endpoints')::int < 2 then raise exception 'stats: %', j; end if;
  -- Dave has a current device, so he is NOT a dormant USER; Fran's 75-day endpoint is dormant and she has no healthy one.
  select count(*) into n from public.admin_push_devices('push_dormant') where name = 'Dormant Dave';
  if n <> 1 then raise exception 'dormant drill-down for Dave: % rows', n; end if;
  select * into r from public.admin_push_devices('push_dormant') where name = 'Dormant Dave';
  if r.detail not like 'ios · iPhone iOS 18.7 · enrolled % · last seen % · has a current device' then raise exception 'dormant detail: %', r.detail; end if;
  select * into r from public.admin_push_devices('push_failing') where name = 'Failing Fran';
  if r.detail not like '% · Windows · % · fails 5' or r.tag <> 'failing' then raise exception 'failing detail: % %', r.detail, r.tag; end if;
  if exists (select 1 from public.admin_push_devices('push_failing') where name = 'Dormant Dave') then raise exception 'dormant endpoint listed as failing'; end if;
end $$;
select set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000001',true);
do $$ begin
  if public.admin_push_device_stats() <> '{}'::jsonb then raise exception 'non-admin got stats'; end if;
  if (select count(*) from public.admin_push_devices('push_dormant')) <> 0 then raise exception 'non-admin got devices'; end if;
end $$;
rollback;
do $$ declare n integer; begin
  n := public.prune_push_subscriptions();
  if n <> 1 then raise exception 'prune removed %, expected 1 (only the 75-day endpoint)', n; end if;
  if not exists (select 1 from push_subscriptions where endpoint = 'https://web.push.apple.com/old-1') then raise exception 'prune removed a 44-day endpoint'; end if;
end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and not exists (select 1 from cron.job where jobname = 'push-subscription-prune') then
    raise exception 'nightly prune not scheduled';
  end if;
  raise notice 'PUSH_DEVICE_HEALTH_PASS failing vs dormant split, device named in drill-down, admin-only, 60-day prune scheduled';
end $$;
delete from push_subscriptions where user_id in ('17000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000002','17000000-0000-0000-0000-000000000003');
delete from profiles where id in ('17000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000002','17000000-0000-0000-0000-000000000003');
delete from auth.users where id in ('17000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000002','17000000-0000-0000-0000-000000000003');

-- 0172: delivery log readers are gated; the nightly prune trims it to 90 days.
do $$
declare a uuid := '17200000-0000-0000-0000-000000000001'; adm uuid := '17200000-0000-0000-0000-000000000002'; n integer;
begin
  delete from push_delivery_log where user_id in (a, adm); delete from profiles where id in (a, adm); delete from auth.users where id in (a, adm);
  insert into auth.users(id,email) values (a,'pl@x.com'),(adm,'pladm@x.com');
  insert into profiles(id,display_name,is_admin) values (a,'Push Pat',false),(adm,'Push Admin',true);
  insert into push_delivery_log(user_id,type,delivery,endpoints,sent,failed,result,at) values
    (a,'money_owed','push',1,1,0,'1 delivered to the push service, 0 failed', now()),
    (a,'course_change','inapp',0,0,0,'not pushed: this type is set to inapp', now()),
    (a,'test','test',1,0,1,'0 delivered, 1 failed: HTTP 410', now() - interval '91 days');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  select count(*) into n from public.my_push_delivery_log(10);
  if n <> 3 then raise exception 'own log rows: %', n; end if;
  if (select count(*) from public.admin_push_delivery_log(null, 50)) <> 0 then raise exception 'non-admin read the admin log'; end if;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  if (select count(*) from public.admin_push_delivery_log(a, 50)) <> 3 then raise exception 'admin filter by user failed'; end if;
  if (select count(*) from public.my_push_delivery_log(10)) <> 0 then raise exception 'my_push_delivery_log leaked another user''s rows'; end if;
  execute 'reset role';
  perform public.prune_push_subscriptions();
  if (select count(*) from push_delivery_log where user_id = a) <> 2 then raise exception '91-day log row not pruned'; end if;
  if has_table_privilege('authenticated', 'public.push_delivery_log', 'select') then raise exception 'authenticated can read push_delivery_log'; end if;
  delete from push_delivery_log where user_id in (a, adm); delete from profiles where id in (a, adm); delete from auth.users where id in (a, adm);
  raise notice 'PUSH_DELIVERY_LOG_PASS own and admin readers gated, 90-day prune, table denied';
end $$;
