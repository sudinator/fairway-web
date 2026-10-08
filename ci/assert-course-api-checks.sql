-- Behaviour of the course-check ledger and its daily claim (0156, 0157, 0164).
--
-- Run against a scratch database that has had the migrations applied. Every assertion here was
-- written after EXECUTING the function, not from reading it: real bugs surfaced that way.
--   1. `provider_id` was both a column and an OUT parameter, so `on conflict (provider_id)` was
--      ambiguous and the function failed at RUNTIME while creating perfectly well (0156).
--   2. Two concurrent claims took the SAME ten rows. `on conflict do update` orders the writes but
--      not the SELECT: under READ COMMITTED both runs snapshot before either commits. Measured
--      overlap was 10 of 10. An advisory lock fixed it; measured overlap is now 0 (0156).
--   3. A claim with no recorded result counted as a verification for seven days. The previous
--      version of THIS FILE masked it: it flipped last_status to 'ok' by hand between "days"
--      instead of recording through the function, so the claim-is-fresh path was never exercised.
--      Production ran that way for four days and printed "Nothing due" (0164). The day cycle below
--      now records results the way the monitor does, as service_role, and the stranded-claim case
--      is asserted explicitly.
do $$
declare
  ids text[] := array(select 'ci'||g from generate_series(1,18) g);
  n integer;
  first_two text;
  due text;
  claimed text[];
begin
  delete from public.course_api_checks where provider_id like 'ci%';

  -- Day one claims exactly the budget, not the whole set.
  select count(*) into n from public.claim_course_api_checks(ids, 10);
  if n <> 10 then raise exception 'day one claimed %, expected 10', n; end if;
  -- Results are recorded the way the monitor records them: through the function, as service_role.
  select array_agg(p.provider_id) into claimed from public.course_api_checks p where p.provider_id like 'ci%' and p.last_status = 'claimed';
  execute 'set local role service_role';
  perform public.record_course_api_check(x, 'ok', null, null, null, null, 200) from unnest(claimed) as x;
  execute 'reset role';

  -- Day two takes the remainder: the ten just checked are inside the freshness window.
  select count(*) into n from public.claim_course_api_checks(ids, 10);
  if n <> 8 then raise exception 'day two claimed %, expected the remaining 8', n; end if;
  select array_agg(p.provider_id) into claimed from public.course_api_checks p where p.provider_id like 'ci%' and p.last_status = 'claimed';
  execute 'set local role service_role';
  perform public.record_course_api_check(x, 'ok', null, null, null, null, 200) from unnest(claimed) as x;
  execute 'reset role';

  -- Day three: everything fresh, nothing due, ZERO provider requests.
  select count(*) into n from public.claim_course_api_checks(ids, 10);
  if n <> 0 then raise exception 'day three claimed %, expected 0', n; end if;

  -- Only what has aged past the window comes back. Freshness is the last SUCCESS, not the last touch.
  update public.course_api_checks
     set last_success_at = now() - interval '8 days', last_checked_at = now() - interval '8 days'
   where provider_id in ('ci1','ci2','ci3','ci4','ci5');
  select count(*) into n from public.claim_course_api_checks(ids, 10);
  if n <> 5 then raise exception 'aged claim returned %, expected 5', n; end if;

  -- THE 0164 CASE. Those five are now claimed and nothing was recorded (the run died). Once the
  -- claim is old enough to be dead, they are due AGAIN. Under 0156 this returned 0 and the monitor
  -- printed "Nothing due".
  update public.course_api_checks set last_checked_at = now() - interval '1 hour'
   where provider_id like 'ci%' and last_status = 'claimed';
  select count(*) into n from public.claim_course_api_checks(ids, 10);
  if n <> 5 then raise exception 'stranded claims re-claimed %, expected 5: a claim is counting as a verification', n; end if;

  -- A claim made moments ago is in flight and must not be handed to a second run.
  select count(*) into n from public.claim_course_api_checks(ids, 10);
  if n <> 0 then raise exception 'in-flight claims re-claimed %, expected 0', n; end if;

  -- A recorded failure is not a verification either: it is due again next run. A drift IS a
  -- successful fetch and counts as fresh.
  execute 'set local role service_role';
  perform public.record_course_api_check('ci1', 'error', null, null, null, 'HTTP 429 daily quota', 429);
  perform public.record_course_api_check('ci2', 'drift', null, null, null, 'course name drifted', 200);
  perform public.record_course_api_check('ci3', 'ok', null, null, null, null, 200);
  perform public.record_course_api_check('ci4', 'ok', null, null, null, null, 200);
  perform public.record_course_api_check('ci5', 'ok', null, null, null, null, 200);
  execute 'reset role';
  if (select last_success_at from public.course_api_checks where provider_id = 'ci1') > now() - interval '7 days' then
    raise exception 'a failed check moved last_success_at';
  end if;
  if (select last_http_status from public.course_api_checks where provider_id = 'ci1') <> 429 then
    raise exception 'last_http_status not recorded';
  end if;
  select string_agg(out_provider_id, ',') into due from public.claim_course_api_checks(ids, 10);
  if due is distinct from 'ci1' then raise exception 'after a failure the due set was %, expected ci1 alone', due; end if;

  -- Release hands back ONLY rows still claimed, with the reason, and winds the attempt time back to
  -- the last success so the course keeps its queue position.
  execute 'set local role service_role';
  select public.release_course_api_claims(array['ci1','ci2','ci3'], 'HTTP 401 key rejected') into n;
  execute 'reset role';
  if n <> 1 then raise exception 'release touched % rows, expected 1 (only ci1 was claimed)', n; end if;
  if (select last_status || '|' || note from public.course_api_checks where provider_id = 'ci1')
       <> 'error|not checked: HTTP 401 key rejected' then
    raise exception 'release did not record the reason';
  end if;
  if (select last_status from public.course_api_checks where provider_id = 'ci2') <> 'drift' then
    raise exception 'release overwrote a recorded result';
  end if;

  -- Oldest ATTEMPT first, so no course can starve.
  update public.course_api_checks set last_success_at = now(), last_checked_at = now(), last_status = 'ok' where provider_id like 'ci%';
  update public.course_api_checks set last_success_at = now() - interval '10 days', last_checked_at = now() - interval '10 days' where provider_id = 'ci1';
  update public.course_api_checks set last_success_at = now() - interval '9 days',  last_checked_at = now() - interval '9 days'  where provider_id = 'ci2';
  select string_agg(out_provider_id, ',' order by out_last_checked_at asc) into first_two
    from public.claim_course_api_checks(ids, 10);
  if first_two is distinct from 'ci1,ci2' then raise exception 'oldest-first gave %, expected ci1,ci2', first_two; end if;

  -- The limit is capped at the provider's daily allowance, whatever the caller asks for.
  delete from public.course_api_checks where provider_id like 'ci%';
  select count(*) into n from public.claim_course_api_checks(array(select 'ci'||g from generate_series(1,60) g), 9999);
  if n <> 35 then raise exception 'limit capped at %, expected 35', n; end if;

  -- A failed lookup must not erase what the course looked like when it last resolved.
  delete from public.course_api_checks where provider_id like 'ci%';
  insert into public.course_api_checks (provider_id, club_name, course_name, location, last_success_at)
    values ('ci_keep', 'Known Club', 'Known Course', 'Known Town', now() - interval '9 days');
  update public.course_api_checks set last_checked_at = now() - interval '9 days' where provider_id = 'ci_keep';
  perform public.claim_course_api_checks(array['ci_keep'], 1);
  if (select club_name from public.course_api_checks where provider_id = 'ci_keep') is distinct from 'Known Club' then
    raise exception 'claiming erased the last known club name';
  end if;
  execute 'set local role service_role';
  perform public.record_course_api_check('ci_keep', 'error', null, null, null, 'HTTP 404', 404);
  execute 'reset role';
  if (select club_name from public.course_api_checks where provider_id = 'ci_keep') is distinct from 'Known Club' then
    raise exception 'a failed record erased the last known club name';
  end if;

  -- The claim path is the only writer of 'claimed'.
  begin
    execute 'set local role service_role';
    perform public.record_course_api_check('ci_keep', 'claimed');
    execute 'reset role';
    raise exception 'record accepted status claimed';
  exception when others then
    execute 'reset role';
    if position('status must be ok, drift or error' in sqlerrm) = 0 then raise; end if;
  end;

  delete from public.course_api_checks where provider_id like 'ci%';
  raise notice 'COURSE_API_CHECKS_PASS daily claim: budget, remainder, idle, ageing, stranded-claim, in-flight, failure-not-fresh, release, oldest-first, cap, retention';
end $$;

-- The client read path (0164): a signed-in user sees status for the ids asked; nobody else.
do $$
declare n integer;
begin
  delete from public.course_api_checks where provider_id like 'ci%';
  execute 'set local role service_role';
  perform public.record_course_api_check('ci_read', 'ok', 'Club', 'Course', 'Town', null, 200);
  execute 'reset role';
  execute 'set local role authenticated';
  execute $q$select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true)$q$;
  select count(*) into n from public.course_api_status(array['ci_read', 'ci_absent']);
  execute 'reset role';
  if n <> 1 then raise exception 'course_api_status returned % rows for one known id, expected 1', n; end if;
  if (select last_success_at from public.course_api_status(array['ci_read'])) is null then
    raise exception 'course_api_status did not return last_success_at';
  end if;
  execute $q$select set_config('request.jwt.claim.sub', '', true)$q$;
  select count(*) into n from public.course_api_status(array['ci_read']);
  if n <> 0 then raise exception 'course_api_status returned rows with no auth.uid()'; end if;
  delete from public.course_api_checks where provider_id like 'ci%';
  raise notice 'COURSE_API_STATUS_PASS signed-in read works, unauthenticated read is empty';
end $$;

-- Permission boundary. authenticated may RECORD (the app does) and READ STATUS (the course view
-- does) but may not CLAIM, RELEASE or read the table.
do $$
begin
  if has_function_privilege('authenticated', 'public.claim_course_api_checks(text[],integer,interval)', 'execute') then
    raise exception 'authenticated can claim the daily batch; it must be service_role only';
  end if;
  if has_function_privilege('authenticated', 'public.release_course_api_claims(text[],text)', 'execute') then
    raise exception 'authenticated can release claims; it must be service_role only';
  end if;
  if not has_function_privilege('authenticated', 'public.record_course_api_check(text,text,text,text,text,text,integer)', 'execute') then
    raise exception 'authenticated cannot record a verification; the app needs this';
  end if;
  if not has_function_privilege('authenticated', 'public.course_api_status(text[])', 'execute') then
    raise exception 'authenticated cannot read course API status; the course view needs this';
  end if;
  if has_function_privilege('anon', 'public.course_api_status(text[])', 'execute') then
    raise exception 'anon can read course API status';
  end if;
  if to_regprocedure('public.record_course_api_check(text,text,text,text,text,text)') is not null then
    raise exception 'the 6-argument record_course_api_check overload still exists; PostgREST will reject named calls as ambiguous (PGRST203)';
  end if;
  if has_table_privilege('authenticated', 'public.course_api_checks', 'select') then
    raise exception 'authenticated can read course_api_checks directly; it is service-role state';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.course_api_checks'::regclass) then
    raise exception 'RLS is not enabled on course_api_checks';
  end if;
  raise notice 'COURSE_API_CHECKS_PERMS_PASS claim/release are service-role only, record and status are authenticated, table is denied';
end $$;

-- 0171: every recorded outcome and every released claim lands in the attempt log; the admin reader
-- is gated; retention is per provider.
do $$
declare adm uuid := '17100000-0000-0000-0000-000000000001'; n integer;
begin
  delete from public.course_api_check_log where provider_id like 'ci_log%';
  delete from public.course_api_checks where provider_id like 'ci_log%';
  delete from profiles where id = adm; delete from auth.users where id = adm;
  insert into auth.users(id,email) values (adm,'log-admin@x.com'); insert into profiles(id,display_name,is_admin) values (adm,'Log Admin',true);
  execute 'set local role service_role';
  perform public.record_course_api_check('ci_log1','error',null,null,null,'HTTP 429 daily quota',429);
  perform public.record_course_api_check('ci_log1','ok','Club','Course','Town',null,200);
  perform public.claim_course_api_checks(array['ci_log2'], 1);
  perform public.release_course_api_claims(array['ci_log2'], 'HTTP 401 key rejected');
  execute 'reset role';
  select count(*) into n from public.course_api_check_log where provider_id = 'ci_log1';
  if n <> 2 then raise exception 'log rows for ci_log1: %, expected 2', n; end if;
  if (select note from public.course_api_check_log where provider_id = 'ci_log2') <> 'not checked: HTTP 401 key rejected' then raise exception 'release not logged'; end if;
  if (select source from public.course_api_check_log where provider_id = 'ci_log1' limit 1) <> 'monitor' then raise exception 'source not monitor for service_role'; end if;
  update public.course_api_check_log set at = now() - interval '91 days' where provider_id = 'ci_log1' and status = 'error';
  execute 'set local role service_role';
  perform public.record_course_api_check('ci_log1','ok','Club','Course','Town',null,200);
  execute 'reset role';
  if exists (select 1 from public.course_api_check_log where provider_id = 'ci_log1' and status = 'error') then raise exception '91-day row not pruned'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  select count(*) into n from public.admin_course_check_log('ci_log1');
  if n <> 2 then raise exception 'admin reader returned %', n; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  if (select count(*) from public.admin_course_check_log('ci_log1')) <> 0 then raise exception 'unauthenticated read of the log'; end if;
  execute 'reset role';
  if has_table_privilege('authenticated', 'public.course_api_check_log', 'select') then raise exception 'authenticated can read the log table'; end if;
  delete from public.course_api_check_log where provider_id like 'ci_log%'; delete from public.course_api_checks where provider_id like 'ci_log%';
  delete from profiles where id = adm; delete from auth.users where id = adm;
  raise notice 'COURSE_API_CHECK_LOG_PASS outcomes and releases logged, 90-day retention, admin-only reader';
end $$;
