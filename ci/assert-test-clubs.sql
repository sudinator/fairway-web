-- assert-test-clubs.sql — 0231 (212.70): a test club's quarterly report is never emailed (the app drops test clubs' games
-- from head-to-head and Season Wrapped — lib/test-clubs; Rounds-based stats never saw them: 0106).
begin;
insert into auth.users(id, email) values ('23100000-0000-0000-0000-0000000000a0', 'owner-tc@w.test');
insert into public.profiles(id, display_name, account_status, email, club_report_emails, is_owner) values ('23100000-0000-0000-0000-0000000000a0', 'Owner', 'active', 'owner-tc@w.test', true, true);
insert into public.groups(id, name, created_by, is_test) values ('23100000-0000-0000-0000-00000000c1b0', 'Real Club', '23100000-0000-0000-0000-0000000000a0', false),
  ('23100000-0000-0000-0000-00000000c1b1', 'App Testing', '23100000-0000-0000-0000-0000000000a0', true);
insert into public.group_members(group_id, user_id, email, role, status) values ('23100000-0000-0000-0000-00000000c1b0', '23100000-0000-0000-0000-0000000000a0', 'owner-tc@w.test', 'admin', 'active'),
  ('23100000-0000-0000-0000-00000000c1b1', '23100000-0000-0000-0000-0000000000a0', 'owner-tc@w.test', 'admin', 'active');
insert into public.club_reports(id, group_id, period_key, period_label, period_from, period_to, snapshot, published_at) values
  ('23101000-0000-0000-0000-000000000001', '23100000-0000-0000-0000-00000000c1b0', '2026-Q3', 'Q3 2026', '2026-07-01', '2026-09-30', '{}'::jsonb, now()),
  ('23101000-0000-0000-0000-000000000002', '23100000-0000-0000-0000-00000000c1b1', '2026-Q3', 'Q3 2026', '2026-07-01', '2026-09-30', '{}'::jsonb, now());
do $$
declare n_real int; n_test int;
begin
  select count(*) into n_real from public.due_club_report_emails(50) d where d.group_id = '23100000-0000-0000-0000-00000000c1b0';
  select count(*) into n_test from public.due_club_report_emails(50) d where d.group_id = '23100000-0000-0000-0000-00000000c1b1';
  if n_real <> 1 then raise exception 'the real club''s report should be due for its owner (got %)', n_real; end if;
  if n_test <> 0 then raise exception 'the TEST club''s report must never be emailed (got %)', n_test; end if;
  raise notice 'TEST_CLUBS_PASS a test club''s report is never emailed; a real club''s is';
end $$;
rollback;
