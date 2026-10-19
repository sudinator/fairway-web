-- 0195 (210.1): publishing club reports — who sees them, who's notified, who gets the email.
do $$
declare own uuid := '19500000-0000-0000-0000-0000000000a1'; m1 uuid := '19500000-0000-0000-0000-0000000000a2';
        off uuid := '19500000-0000-0000-0000-0000000000a3'; other uuid := '19500000-0000-0000-0000-0000000000a4';
        g1 uuid := '19500000-0000-0000-0000-0000000000c1'; g2 uuid := '19500000-0000-0000-0000-0000000000c2'; g3 uuid := '19500000-0000-0000-0000-0000000000c3';
        rid uuid; n int;
begin
  delete from club_report_email_log where user_id in (own, m1, off, other); delete from club_reports where group_id in (g1, g2, g3);
  delete from notifications where user_id in (own, m1, off, other); delete from games where group_id in (g1, g2, g3);
  delete from group_members where group_id in (g1, g2, g3); delete from groups where id in (g1, g2, g3);
  delete from profiles where id in (own, m1, off, other); delete from auth.users where id in (own, m1, off, other);
  insert into auth.users(id, email) values (own, 'own@r195.test'), (m1, 'm1@r195.test'), (off, 'off@r195.test'), (other, 'oth@r195.test');
  insert into profiles(id, display_name, email, is_owner, account_status, club_report_emails) values
    (own, 'Owner', 'own@r195.test', true, 'active', true), (m1, 'Member', 'm1@r195.test', false, 'active', true),
    (off, 'Opted Out', 'off@r195.test', false, 'active', false), (other, 'Other Club', 'oth@r195.test', false, 'active', true);
  insert into groups(id, name, status) values (g1, 'R195 One', 'active'), (g2, 'R195 Two', 'active'), (g3, 'R195 Quiet', 'active');
  insert into group_members(group_id, user_id, email, role, status) values (g1, m1, 'm1@r195.test', 'member', 'active'), (g1, off, 'off@r195.test', 'member', 'active'), (g2, other, 'oth@r195.test', 'member', 'active');
  insert into games(code, name, course, holes_meta, group_id, status, played_at, created_by) values ('195001', 'G', 'C', '[]', g1, 'ended', '2026-08-01', own), ('195002', 'G', 'C', '[]', g2, 'ended', '2026-08-02', own), ('195003', 'G', 'C', '[]', g3, 'ended', '2026-11-02', own);
  update app_settings set value = '{"recipients": "owner"}' where key = 'club_reports';

  -- queue: one report per club WITH games in the period (the quiet club's game is outside it)
  perform public.queue_club_reports('2026-Q3', 'July–September 2026', '2026-07-01', '2026-09-30');
  perform public.queue_club_reports('2026-Q3', 'July–September 2026', '2026-07-01', '2026-09-30');   -- twice: no duplicates
  select count(*) into n from club_reports where group_id in (g1, g2, g3);
  if n <> 2 or exists (select 1 from club_reports where group_id = g3) then raise exception 'queue: expected 2 reports (not the quiet club), got %', n; end if;
  -- publish g1: frozen copy + members notified once
  select id into rid from club_reports where group_id = g1;
  perform public.save_club_report(rid, '{"club":"R195 One","games":1}'::jsonb);
  perform public.save_club_report(rid, '{"club":"R195 One","games":1}'::jsonb);
  if (select count(*) from notifications where type = 'club_report' and group_id = g1) <> 2 then raise exception 'members of the club should be notified once each'; end if;
  if (select snapshot->>'club' from club_reports where id = rid) <> 'R195 One' then raise exception 'snapshot not saved'; end if;
  -- members read their own club's published report — not another club's
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', m1::text, true);
  if (select count(*) from club_reports where group_id = g1) <> 1 then raise exception 'a member cannot read their club''s report'; end if;
  perform set_config('request.jwt.claim.sub', other::text, true);
  if (select count(*) from club_reports where group_id = g1) <> 0 then raise exception 'a member read another club''s report'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  -- emails: the owner only at first
  if (select count(*) from public.due_club_report_emails(50) where report_id = rid) <> 1 or not exists (select 1 from public.due_club_report_emails(50) where report_id = rid and user_id = own) then raise exception 'owner mode: only the owner should be due'; end if;
  perform public.record_club_report_email(rid, own, 'sent');
  if exists (select 1 from public.due_club_report_emails(50) where report_id = rid and user_id = own) then raise exception 'emailed twice'; end if;
  -- everyone: the club's members who haven't turned it off
  update app_settings set value = '{"recipients": "everyone"}' where key = 'club_reports';
  if not exists (select 1 from public.due_club_report_emails(50) where report_id = rid and user_id = m1) then raise exception 'everyone mode missed a member'; end if;
  if exists (select 1 from public.due_club_report_emails(50) where report_id = rid and user_id in (off, other)) then raise exception 'an opted-out member, or another club''s member, would be emailed'; end if;
  update app_settings set value = '{"recipients": "owner"}' where key = 'club_reports';
  -- server only — checked by privilege, never by calling (208.4)
  if has_function_privilege('authenticated', 'public.queue_club_reports(text,text,date,date)', 'execute') or has_function_privilege('authenticated', 'public.save_club_report(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.due_club_report_emails(integer)', 'execute') or has_function_privilege('authenticated', 'public.record_club_report_email(uuid,uuid,text,text)', 'execute') then
    raise exception 'app users can call club-report server functions'; end if;

  delete from club_report_email_log where user_id in (own, m1, off, other); delete from club_reports where group_id in (g1, g2, g3);
  delete from notifications where user_id in (own, m1, off, other); delete from games where group_id in (g1, g2, g3);
  delete from group_members where group_id in (g1, g2, g3); delete from groups where id in (g1, g2, g3);
  delete from profiles where id in (own, m1, off, other); delete from auth.users where id in (own, m1, off, other);
  raise notice 'CLUB_REPORTS_PASS queued for clubs with games; frozen copy; members notified once; own club only; owner-only emails, opt-out and everyone mode; server only';
end $$;
