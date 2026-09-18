-- Behaviour of the course-check ledger and its daily claim (0156).
--
-- Run against a scratch database that has had the migrations applied. Every assertion here was
-- written after EXECUTING the function, not from reading it: two real bugs surfaced that way.
--   1. `provider_id` was both a column and an OUT parameter, so `on conflict (provider_id)` was
--      ambiguous and the function failed at RUNTIME while creating perfectly well.
--   2. Two concurrent claims took the SAME ten rows. `on conflict do update` orders the writes but
--      not the SELECT: under READ COMMITTED both runs snapshot before either commits. Measured
--      overlap was 10 of 10. An advisory lock fixed it; measured overlap is now 0.
do $$
declare
  ids text[] := array(select 'ci'||g from generate_series(1,18) g);
  n integer;
  first_two text;
begin
  delete from public.course_api_checks where provider_id like 'ci%';

  -- Day one claims exactly the budget, not the whole set.
  select count(*) into n from public.claim_course_api_checks(ids, 10);
  if n <> 10 then raise exception 'day one claimed %, expected 10', n; end if;
  update public.course_api_checks set last_status = 'ok' where provider_id like 'ci%';

  -- Day two takes the remainder: the ten just checked are inside the freshness window.
  select count(*) into n from public.claim_course_api_checks(ids, 10);
  if n <> 8 then raise exception 'day two claimed %, expected the remaining 8', n; end if;
  update public.course_api_checks set last_status = 'ok' where provider_id like 'ci%';

  -- Day three: everything fresh, nothing due, ZERO provider requests.
  select count(*) into n from public.claim_course_api_checks(ids, 10);
  if n <> 0 then raise exception 'day three claimed %, expected 0', n; end if;

  -- Only what has aged past the window comes back.
  update public.course_api_checks set last_checked_at = now() - interval '8 days'
   where provider_id in ('ci1','ci2','ci3','ci4','ci5');
  select count(*) into n from public.claim_course_api_checks(ids, 10);
  if n <> 5 then raise exception 'aged claim returned %, expected 5', n; end if;

  -- Oldest first, so no course can starve.
  update public.course_api_checks set last_checked_at = now() where provider_id like 'ci%';
  update public.course_api_checks set last_checked_at = now() - interval '10 days' where provider_id = 'ci1';
  update public.course_api_checks set last_checked_at = now() - interval '9 days'  where provider_id = 'ci2';
  select string_agg(out_provider_id, ',' order by out_last_checked_at asc) into first_two
    from public.claim_course_api_checks(ids, 10);
  if first_two <> 'ci1,ci2' then raise exception 'oldest-first gave %, expected ci1,ci2', first_two; end if;

  -- The limit is capped at the provider's daily allowance, whatever the caller asks for.
  delete from public.course_api_checks where provider_id like 'ci%';
  select count(*) into n from public.claim_course_api_checks(array(select 'ci'||g from generate_series(1,60) g), 9999);
  if n <> 35 then raise exception 'limit capped at %, expected 35', n; end if;

  -- A failed lookup must not erase what the course looked like when it last resolved.
  delete from public.course_api_checks where provider_id like 'ci%';
  insert into public.course_api_checks (provider_id, club_name, course_name, location)
    values ('ci_keep', 'Known Club', 'Known Course', 'Known Town');
  update public.course_api_checks set last_checked_at = now() - interval '9 days' where provider_id = 'ci_keep';
  perform public.claim_course_api_checks(array['ci_keep'], 1);
  if (select club_name from public.course_api_checks where provider_id = 'ci_keep') is distinct from 'Known Club' then
    raise exception 'claiming erased the last known club name';
  end if;

  delete from public.course_api_checks where provider_id like 'ci%';
  raise notice 'COURSE_API_CHECKS_PASS daily claim: budget, remainder, idle, ageing, oldest-first, cap, retention';
end $$;

-- Permission boundary. authenticated may RECORD (the app does) but may not CLAIM or read the table.
do $$
begin
  if has_function_privilege('authenticated', 'public.claim_course_api_checks(text[],integer,interval)', 'execute') then
    raise exception 'authenticated can claim the daily batch; it must be service_role only';
  end if;
  if not has_function_privilege('authenticated', 'public.record_course_api_check(text,text,text,text,text,text)', 'execute') then
    raise exception 'authenticated cannot record a verification; the app needs this';
  end if;
  if has_table_privilege('authenticated', 'public.course_api_checks', 'select') then
    raise exception 'authenticated can read course_api_checks directly; it is service-role state';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.course_api_checks'::regclass) then
    raise exception 'RLS is not enabled on course_api_checks';
  end if;
  raise notice 'COURSE_API_CHECKS_PERMS_PASS claim is service-role only, record is authenticated, table is denied';
end $$;
