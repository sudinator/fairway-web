-- 0193 (209.3): who gets a round-summary email, and when.
do $$
declare own uuid := '19300000-0000-0000-0000-000000000001'; mem uuid := '19300000-0000-0000-0000-000000000002'; off uuid := '19300000-0000-0000-0000-000000000003';
        r_own uuid := '19300000-0000-0000-0000-000000000011'; r_new uuid := '19300000-0000-0000-0000-000000000012';
        r_mem uuid := '19300000-0000-0000-0000-000000000013'; r_off uuid := '19300000-0000-0000-0000-000000000014';
        n int; fp text;
begin
  delete from round_email_log where user_id in (own, mem, off); delete from holes where round_id in (select id from rounds where user_id in (own, mem, off)); delete from rounds where user_id in (own, mem, off);
  delete from profiles where id in (own, mem, off); delete from auth.users where id in (own, mem, off);
  insert into auth.users(id, email) values (own, 'own@e193.test'), (mem, 'mem@e193.test'), (off, 'off@e193.test');
  insert into profiles(id, display_name, email, is_owner, account_status, round_emails) values
    (own, 'Owner', 'own@e193.test', true, 'active', true), (mem, 'Member', 'mem@e193.test', false, 'active', true), (off, 'Opted Out', 'off@e193.test', false, 'active', false);
  insert into rounds(id, user_id, course, played_at, status, finished_at) values
    (r_own, own, 'E193', current_date, 'final', now() - interval '2 hours'),
    (r_new, own, 'E193', current_date, 'final', now() - interval '10 minutes'),
    (r_mem, mem, 'E193', current_date, 'final', now() - interval '2 hours'),
    (r_off, off, 'E193', current_date, 'final', now() - interval '2 hours');
  -- 210.7: real rounds have hole-by-hole scores (0198 excludes rounds without any).
  insert into holes(round_id, hole_number, par, strokes) select x, 1, 4, 4 from unnest(array[r_own, r_new, r_mem, r_off]) x;
  update app_settings set value = '{"recipients": "owner"}' where key = 'round_emails';

  -- "owner only": just the owner's round finished over an hour ago
  select count(*) into n from public.due_round_emails(50) where user_id in (own, mem, off);
  if n <> 1 or not exists (select 1 from public.due_round_emails(50) where round_id = r_own) then raise exception 'owner mode should give only the owner''s finished round (got %)', n; end if;
  -- sent → not due again within the hour; the fingerprint comes back for change detection
  perform public.record_round_email(r_own, own, 'fp-1', 'summary', 'sent');
  if exists (select 1 from public.due_round_emails(50) where round_id = r_own) then raise exception 'emailed again within the hour'; end if;
  update round_email_log set at = now() - interval '2 hours' where round_id = r_own;
  select last_fingerprint into fp from public.due_round_emails(50) where round_id = r_own;
  if fp is distinct from 'fp-1' then raise exception 'last fingerprint not returned (%)', fp; end if;
  -- "everyone": the member too — never the opted-out one
  update app_settings set value = '{"recipients": "everyone"}' where key = 'round_emails';
  if not exists (select 1 from public.due_round_emails(50) where round_id = r_mem) then raise exception 'everyone mode missed a member'; end if;
  if exists (select 1 from public.due_round_emails(50) where round_id in (r_off, r_new)) then raise exception 'opted-out or too-recent round offered'; end if;
  update app_settings set value = '{"recipients": "owner"}' where key = 'round_emails';
  -- server only — checked by privilege, never by calling (208.4)
  if has_function_privilege('authenticated', 'public.due_round_emails(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.record_round_email(uuid,uuid,text,text,text,text)', 'execute') then raise exception 'app users can call round-email functions'; end if;
  if not exists (select 1 from account_reference_columns where table_name = 'round_email_log' and column_name = 'user_id') then raise exception 'merge registry misses round_email_log'; end if;

  delete from round_email_log where user_id in (own, mem, off); delete from holes where round_id in (select id from rounds where user_id in (own, mem, off)); delete from rounds where user_id in (own, mem, off);
  delete from profiles where id in (own, mem, off); delete from auth.users where id in (own, mem, off);
  raise notice 'ROUND_EMAIL_PASS owner-only by default; an hour after, not twice within the hour; opted-out skipped; everyone mode; server only';
end $$;
