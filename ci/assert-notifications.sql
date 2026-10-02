-- Behaviour of every notification writer redefined by 0165, executed on real rows.
-- Expected texts are asserted EXACTLY: a notification is product copy, and a regression that drops
-- the person's name or the club turns "Amit Sud joined Pine Valley Hackers" back into "A new golfer
-- joined your club", which is what this file exists to prevent.
-- Start clean even after a previous crashed run left fixture rows behind (same statements as the
-- cleanup at the end).
delete from notifications where user_id in ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003'); delete from tee_time_rsvps where tee_time_id = '77777777-0000-0000-0000-000000000007'; delete from tee_times where id = '77777777-0000-0000-0000-000000000007'; delete from settlements where group_id = 'dddddddd-0000-0000-0000-000000000004'; delete from expense_shares where expense_id in ('99999999-0000-0000-0000-000000000009','88888888-0000-0000-0000-000000000008'); delete from expense_payers where expense_id in ('99999999-0000-0000-0000-000000000009','88888888-0000-0000-0000-000000000008'); delete from expenses where id in ('99999999-0000-0000-0000-000000000009','88888888-0000-0000-0000-000000000008'); delete from group_events where id = '55555555-0000-0000-0000-000000000005';
delete from friction_items where signature like 'ci165:%'; delete from course_freshness where course_id = '66666666-0000-0000-0000-000000000006'; delete from favorite_courses where id = '66666666-0000-0000-0000-000000000006';
delete from game_players where game_id = 'ffffffff-0000-0000-0000-000000000006'; delete from games where id = 'ffffffff-0000-0000-0000-000000000006';
delete from group_members where group_id in ('dddddddd-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-000000000005'); delete from groups where id in ('dddddddd-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-000000000005'); delete from profiles where id in ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003');
delete from auth.users where id in ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003');

do $$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  c uuid := 'cccccccc-0000-0000-0000-000000000003';
  g uuid := 'dddddddd-0000-0000-0000-000000000004';
  g2 uuid := 'eeeeeeee-0000-0000-0000-000000000005';
  gm uuid := 'ffffffff-0000-0000-0000-000000000006';
  ex uuid := '99999999-0000-0000-0000-000000000009';
  ex2 uuid := '88888888-0000-0000-0000-000000000008';
  tt uuid := '77777777-0000-0000-0000-000000000007';
  fc uuid := '66666666-0000-0000-0000-000000000006';
  ev uuid := '55555555-0000-0000-0000-000000000005';
  m text; d text; n integer;
  procedure_label text := 'NOTIFICATIONS';
begin
  delete from notifications where user_id in (a,b,c); delete from group_members where group_id in (g,g2); delete from groups where id in (g,g2); delete from profiles where id in (a,b,c); delete from auth.users where id in (a,b,c);
  insert into auth.users(id,email,created_at) values (a,'amit.sud@example.com', now()-interval '30 days'),(b,'bob@example.com', now()-interval '30 days'),(c,'newguy@example.com', now());
  insert into profiles(id,display_name,email,is_admin) values (a,'Amit Sud','amit.sud@example.com',true),(b,'Bob Jones','bob@example.com',false),(c,null,null,false);
  insert into groups(id,name) values (g,'Pine Valley Hackers'),(g2,'Sunday Swingers');
  -- 0121: every payment lives in a money Bucket (group_events); seed the club's General one.
  insert into group_events(id,group_id,name,event_type,status,is_general) values (ev,g,'General','manual','open',true) on conflict (id) do nothing;
  insert into group_members(group_id,user_id,email,role) values (g,a,'amit.sud@example.com','admin'),(g,b,'bob@example.com','member');
  delete from notifications;

  -- Member joined: a signup with NO display name yet is named by email prefix, not "A new golfer".
  insert into group_members(group_id,user_id,email) values (g,c,'newguy@example.com');
  select message into m from notifications where user_id = a and type = 'group_member';
  if m <> 'newguy joined Pine Valley Hackers (new to BNN, signed up today).' then raise exception 'join text: %', m; end if;
  if exists (select 1 from notifications where user_id = c and type = 'group_member') then raise exception 'joiner notified about themselves'; end if;
  insert into group_members(group_id,user_id,email,role) values (g2,a,'x','admin');
  delete from notifications;
  insert into group_members(group_id,user_id,email) values (g2,b,'x');
  select message into m from notifications where user_id = a and type = 'group_member';
  if m <> 'Bob Jones joined Sunday Swingers (already in 1 other club).' then raise exception 'second-club join text: %', m; end if;
  delete from notifications;

  -- Added to a game: organizer named, game named, specifics in detail, organizer not notified.
  insert into games(id,code,name,course,game_type,group_id,created_by,holes_meta) values (gm,'ABCD','Saturday Stableford','Essex County','stableford',g,a,
    '[{"n":1,"par":4,"si":1},{"n":2,"par":4,"si":3},{"n":3,"par":5,"si":5},{"n":4,"par":3,"si":7},{"n":5,"par":4,"si":9},{"n":6,"par":5,"si":2},{"n":7,"par":4,"si":4},{"n":8,"par":3,"si":6},{"n":9,"par":5,"si":8}]');
  insert into game_players(game_id,user_id,display_name,tee_name,course_handicap,scores) values
    (gm,a,'Amit','Blue',7,'[4,4,5,3,4,5,4,3,5]'),
    (gm,b,'Bob','White',12,'[5,5,6,4,5,6,5,4,6]'),
    (gm,c,'New','White',20,'[5,5,6,null,null,null,null,null,null]');
  select message, detail into m, d from notifications where user_id = b and type = 'game_added';
  if m <> 'Amit Sud added you to "Saturday Stableford".' then raise exception 'game added text: %', m; end if;
  if d not like 'Essex County · set up % · stableford · code ABCD · you play the White tees (CH 12)' then raise exception 'game added detail: %', d; end if;
  if exists (select 1 from notifications where user_id = a and type = 'game_added') then raise exception 'organizer notified about own game'; end if;
  delete from notifications;

  -- Game final, individual: own gross/net and position by net; partial card says thru N.
  update games set status = 'ended' where id = gm;
  select message into m from notifications where user_id = a and type = 'game_finished';
  if m <> '"Saturday Stableford" is final: you shot 37 (net 30), 1st of 2 by net.' then raise exception 'final text (winner): %', m; end if;
  select message into m from notifications where user_id = b and type = 'game_finished';
  if m <> '"Saturday Stableford" is final: you shot 46 (net 34), 2nd of 2 by net.' then raise exception 'final text (second): %', m; end if;
  select message into m from notifications where user_id = c and type = 'game_finished';
  if m <> '"Saturday Stableford" is final: you were 16 thru 3.' then raise exception 'final text (partial): %', m; end if;
  delete from notifications;
  -- Team format: no position claim (the match result lives in the app's scoring engines).
  update games set status = 'active', game_type = 'fourball' where id = gm;
  update games set status = 'ended' where id = gm;
  select message into m from notifications where user_id = a and type = 'game_finished';
  if m <> '"Saturday Stableford" is final: you shot 37 (net 30). Open the game for the match result.' then raise exception 'final text (team): %', m; end if;
  delete from notifications;

  -- Charge and payment name the people and the club.
  insert into expenses(id,group_id,created_by,payer_user_id,description,amount_cents,event_id) values (ex2,g,a,a,'Greens fees, Oct 4',5000,ev);
  insert into expense_shares(expense_id,user_id,share_cents) values (ex2,b,2500),(ex2,a,2500);
  select message into m from notifications where user_id = b and type = 'money_owed';
  if m <> '$25.00 charge from Amit Sud: "Greens fees, Oct 4" (Pine Valley Hackers).' then raise exception 'charge text: %', m; end if;
  if exists (select 1 from notifications where user_id = a and type = 'money_owed') then raise exception 'payer charged themselves'; end if;
  insert into settlements(group_id,from_user_id,to_user_id,amount_cents,method,event_id) values (g,b,a,2500,'Venmo',ev);
  select message into m from notifications where user_id = a and type = 'money_paid';
  if m <> 'Bob Jones paid you $25.00 by Venmo (Pine Valley Hackers).' then raise exception 'paid text: %', m; end if;
  delete from notifications;

  -- New tee time: course, date, times, poster, deadline.
  insert into tee_times(id,group_id,created_by,course,play_date,tee_off_times,signup_deadline,max_spots)
    values (tt,g,a,'Essex County',(now() at time zone 'America/New_York')::date,'{8:10,8:20}',now()+interval '3 hours',8);
  select message, detail into m, d from notifications where user_id = b and type = 'tee_new';
  if m not like 'New tee time: Essex County, % at 8:10, 8:20, posted by Amit Sud — RSVP by %.' then raise exception 'tee text: %', m; end if;
  if d <> '8 spots' then raise exception 'tee detail: %', d; end if;
  if exists (select 1 from notifications where user_id = a and type = 'tee_new') then raise exception 'poster notified about own tee time'; end if;
  insert into tee_time_rsvps(tee_time_id,user_id,choice) values (tt,a,'in'),(tt,b,'in');
  delete from notifications;
  perform send_tee_reminders();
  select message, detail into m, d from notifications where user_id = b and link like '%r=day';
  if m <> 'Tee time today: Essex County at 8:10, 8:20 — 2 playing.' or d <> 'Amit Sud, Bob Jones' then raise exception 'day-of reminder: % / %', m, d; end if;
  select message into m from notifications where user_id = c and link like '%r=deadline';
  if m not like 'RSVP closes soon: Essex County, % at 8:10, 8:20 — 2 in so far.' then raise exception 'deadline reminder: %', m; end if;
  if exists (select 1 from notifications where user_id = b and link like '%r=deadline') then raise exception 'deadline reminder sent to someone who already answered'; end if;
  select count(*) into n from notifications; perform send_tee_reminders();
  if (select count(*) from notifications) <> n then raise exception 'reminders are not idempotent'; end if;
  delete from notifications;

  raise notice 'NOTIFICATIONS_PASS joins, game added/final (individual, team, partial), charge, payment, tee time, reminders';
end $$;

-- Bet: the DEFERRED trigger sees payers and shares written after the expense row.
begin;
insert into expenses(id,group_id,created_by,payer_user_id,description,amount_cents,source_game_id,source_kind,event_id)
  values ('99999999-0000-0000-0000-000000000009','dddddddd-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Nassau',3600,'ffffffff-0000-0000-0000-000000000006','tgc_bet','55555555-0000-0000-0000-000000000005');
insert into expense_payers(expense_id,user_id,paid_cents) values ('99999999-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000001',3600);
insert into expense_shares(expense_id,user_id,share_cents) values ('99999999-0000-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-000000000002',1200),('99999999-0000-0000-0000-000000000009','cccccccc-0000-0000-0000-000000000003',2400);
commit;
do $$
declare m text; d text;
begin
  select message, detail into m, d from notifications where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and type = 'bet_posted';
  if m <> 'Bet posted for "Saturday Stableford": you owe Amit Sud $12.00.' then raise exception 'bet text (loser): %', m; end if;
  if d <> 'Pot $36.00 · Nassau · posted by Amit Sud' then raise exception 'bet detail: %', d; end if;
  select message into m from notifications where user_id = 'cccccccc-0000-0000-0000-000000000003' and type = 'bet_posted';
  if m <> 'Bet posted for "Saturday Stableford": you owe Amit Sud $24.00.' then raise exception 'bet text (second loser): %', m; end if;
  if exists (select 1 from notifications where type = 'money_owed' and link = '/?tab=money' and created_at > now() - interval '1 minute'
             and user_id in ('bbbbbbbb-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003')) then
    raise exception 'bet share also produced a generic charge notification (told twice)';
  end if;
  if (select tgdeferrable and tginitdeferred from pg_trigger where tgname = 'trg_notify_bet_posted' and tgrelid = 'public.expenses'::regclass) is not true then
    raise exception 'trg_notify_bet_posted is not a deferred constraint trigger';
  end if;
  delete from notifications;
  raise notice 'NOTIFICATIONS_BET_PASS deferred trigger names winner, amounts and pot';
end $$;

-- Course freshness: the admin notice names the course and summarises the diff; detail lists it.
insert into favorite_courses(id,group_id,name,user_id,data) values ('66666666-0000-0000-0000-000000000006','dddddddd-0000-0000-0000-000000000004','Pinch Brook Golf Course','aaaaaaaa-0000-0000-0000-000000000001','{"name":"Pinch Brook Golf Course","tees":[],"holes":[]}'::jsonb)
  on conflict (id) do nothing;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select record_course_freshness('66666666-0000-0000-0000-000000000006','{}'::jsonb,
 '{"tees":[{"name":"Blue","slopeTo":112,"ratingTo":63.6,"slopeFrom":115,"ratingFrom":64.2,"slopeChanged":true,"ratingChanged":true,"yardageChanges":[{"to":171,"from":174,"hole":1},{"to":473,"from":476,"hole":2}]},{"name":"White","slopeTo":106,"ratingTo":62.3,"slopeFrom":106,"ratingFrom":62.6,"slopeChanged":false,"ratingChanged":true,"yardageChanges":[{"to":147,"from":157,"hole":1}]}],"hasChanges":true}'::jsonb, true);
commit;
do $$
declare m text; d text;
begin
  select message, detail into m, d from notifications where type = 'course_change' and user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if m <> 'Pinch Brook Golf Course: GolfCourseAPI now lists different data — Blue rating 64.2→63.6, slope 115→112, White rating 62.6→62.3; 3 yardage changes across 2 tees. Review in Courses.' then raise exception 'course change text: %', m; end if;
  if d <> E'Blue: rating 64.2 → 63.6; slope 115 → 112; hole 1 174→171, hole 2 476→473\nWhite: rating 62.6 → 62.3; hole 1 157→147' then raise exception 'course change detail: %', d; end if;
  if exists (select 1 from notifications where type = 'course_change' and user_id = 'bbbbbbbb-0000-0000-0000-000000000002') then raise exception 'non-admin got the course notice'; end if;
  delete from notifications;
  raise notice 'NOTIFICATIONS_COURSE_PASS names the course and the changes';
end $$;

-- create_notification: single overload, detail stored.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select create_notification(p_recipient => 'bbbbbbbb-0000-0000-0000-000000000002', p_message => 'hello', p_detail => 'the long part');
commit;
do $$
begin
  if (select detail from notifications where message = 'hello') <> 'the long part' then raise exception 'detail not stored'; end if;
  if (select count(*) from pg_proc where proname = 'create_notification') <> 1 then raise exception 'create_notification has more than one overload (PGRST203)'; end if;
  delete from notifications;
  -- The 0092 sweep's generic admin notice is enriched on insert with the first flags by name.
  insert into friction_items(signature, kind, subject_user, detail) values ('ci165:1', 'dup_day', 'bbbbbbbb-0000-0000-0000-000000000002', 'x'), ('ci165:2', 'integrity', 'cccccccc-0000-0000-0000-000000000003', 'par missing on 3 holes'), ('ci165:3', 'dup_game', 'aaaaaaaa-0000-0000-0000-000000000001', 'y');
  insert into notifications(user_id, message, type, link) values ('aaaaaaaa-0000-0000-0000-000000000001', '3 new data-integrity flags to review', 'friction', '/');
  if (select message from notifications where type = 'friction') <> '3 new data-integrity flags: Bob Jones — two rounds on one day; newguy — par missing on 3 holes and 1 more' then
    raise exception 'friction notice not enriched: %', (select message from notifications where type = 'friction');
  end if;
  insert into notifications(user_id, message, type, link) values ('aaaaaaaa-0000-0000-0000-000000000001', 'unrelated friction text', 'friction', '/');
  if (select message from notifications where message like 'unrelated%') <> 'unrelated friction text' then raise exception 'trigger rewrote a message it should not touch'; end if;
  delete from friction_items where signature like 'ci165:%';
  delete from notifications;
end $$;

-- Admin signups: admin sees everyone with sign-up and club dates; a member sees nothing.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $$
declare r record; n integer;
begin
  select count(*) into n from admin_member_signups();
  if n < 3 then raise exception 'admin sees % signups, expected at least 3', n; end if;
  select * into r from admin_member_signups() where email = 'bob@example.com';
  if r.clubs not like 'Pine Valley Hackers (%), Sunday Swingers (%)' then raise exception 'clubs: %', r.clubs; end if;
  if r.signed_up_at is null then raise exception 'signed_up_at missing'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $$
begin
  if (select count(*) from admin_member_signups()) <> 0 then raise exception 'non-admin can read signups'; end if;
  raise notice 'NOTIFICATIONS_ADMIN_PASS admin_member_signups gated and populated';
end $$;
rollback;

-- Clean up the fixture rows so later assertions start from an empty ledger.
delete from notifications where user_id in ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003'); delete from tee_time_rsvps where tee_time_id = '77777777-0000-0000-0000-000000000007'; delete from tee_times where id = '77777777-0000-0000-0000-000000000007'; delete from settlements where group_id = 'dddddddd-0000-0000-0000-000000000004'; delete from expense_shares where expense_id in ('99999999-0000-0000-0000-000000000009','88888888-0000-0000-0000-000000000008'); delete from expense_payers where expense_id in ('99999999-0000-0000-0000-000000000009','88888888-0000-0000-0000-000000000008'); delete from expenses where id in ('99999999-0000-0000-0000-000000000009','88888888-0000-0000-0000-000000000008'); delete from group_events where id = '55555555-0000-0000-0000-000000000005';
delete from friction_items where signature like 'ci165:%'; delete from course_freshness where course_id = '66666666-0000-0000-0000-000000000006'; delete from favorite_courses where id = '66666666-0000-0000-0000-000000000006';
delete from game_players where game_id = 'ffffffff-0000-0000-0000-000000000006'; delete from games where id = 'ffffffff-0000-0000-0000-000000000006';
delete from group_members where group_id in ('dddddddd-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-000000000005'); delete from groups where id in ('dddddddd-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-000000000005'); delete from profiles where id in ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003');
delete from auth.users where id in ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003');
