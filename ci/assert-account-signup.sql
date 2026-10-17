-- 0189 (208.0): sign-up approval and the duplicate check — every owner rule, as an app user would hit it.
do $$
declare sys uuid := '18900000-0000-0000-0000-000000000001';  -- system admin
        cad uuid := '18900000-0000-0000-0000-000000000002';  -- admin of club A only
        mem uuid := '18900000-0000-0000-0000-000000000003';  -- existing member "Vimal Narayanan"
        dupl uuid := '18900000-0000-0000-0000-000000000004'; -- new Google account, same name, via club A invite
        stranger uuid := '18900000-0000-0000-0000-000000000005'; -- new, no invite, no match
        invitee uuid := '18900000-0000-0000-0000-000000000006';  -- new, valid invite, no match
        late uuid := '18900000-0000-0000-0000-000000000007';     -- new, no invite, then opens an invite
        emailinv uuid := '18900000-0000-0000-0000-000000000008'; -- new, admin pre-added the address to club B
        emaildup uuid := '18900000-0000-0000-0000-000000000009'; -- new, same name as the member, email-invited to club B
        ga uuid := '18900000-0000-0000-0000-000000000011'; gb uuid := '18900000-0000-0000-0000-000000000012';
        r jsonb; ok boolean;
begin
  delete from notifications where user_id in (sys, cad, mem, dupl, stranger, invitee, late, emailinv, emaildup);
  delete from banned_emails where email like '%@signup189.test';
  delete from group_members where group_id in (ga, gb); delete from group_invites where group_id in (ga, gb); delete from groups where id in (ga, gb) or created_by in (dupl, stranger);
  delete from activity_log where target_user_id in (dupl, stranger, invitee, late);
  delete from profiles where id in (sys, cad, mem, dupl, stranger, invitee, late, emailinv, emaildup); delete from auth.users where id in (sys, cad, mem, dupl, stranger, invitee, late, emailinv, emaildup);
  insert into auth.users(id, email, raw_user_meta_data) values
    (sys, 'sys@signup189.test', '{"full_name":"Sys Admin"}'), (cad, 'cad@signup189.test', '{"full_name":"Club Admin"}'),
    (mem, 'vimal@signup189.test', '{"full_name":"Vimal Narayanan"}'), (dupl, 'vimal.gmail@signup189.test', '{"full_name":"Vimal Narayanan"}'),
    (stranger, 'pat@signup189.test', '{"full_name":"Pat Reilly"}'), (invitee, 'jo@signup189.test', '{"full_name":"Jo Brand"}'), (late, 'kim@signup189.test', '{"full_name":"Kim Lee"}'),
    (emailinv, 'lee@signup189.test', '{"full_name":"Lee Chen"}'), (emaildup, 'vn@signup189.test', '{"full_name":"Vimal N"}');
  insert into profiles(id, display_name, email, is_admin, account_status) values
    (sys, 'Sys Admin', 'sys@signup189.test', true, 'active'), (cad, 'Club Admin', 'cad@signup189.test', false, 'active'),
    (mem, 'Vimal Narayanan', 'vimal@signup189.test', false, 'active');
  insert into groups(id, name, status) values (ga, 'Club A 189', 'active'), (gb, 'Club B 189', 'active');
  insert into group_members(group_id, user_id, email, role, status) values (ga, cad, 'cad@signup189.test', 'admin', 'active'), (ga, mem, 'vimal@signup189.test', 'member', 'active');
  insert into group_invites(group_id, invite_code, role, status, created_by, expires_at, multi, use_count) values (ga, 'CLUBA189', 'member', 'active', cad, now() + interval '1 day', true, 0);
  insert into group_members(group_id, user_id, email, role, status) values (gb, null, 'lee@signup189.test', 'member', 'invited'), (gb, null, 'vn@signup189.test', 'member', 'invited');

  execute 'set local role authenticated';
  -- 1. Duplicate via club A's invite → held, with the existing member's MASKED email.
  perform set_config('request.jwt.claim.sub', dupl::text, true);
  insert into profiles(id, display_name, email, account_status) values (dupl, 'Vimal Narayanan', 'vimal.gmail@signup189.test', 'active');   -- the app's insert; 'active' must be ignored
  r := public.begin_account('CLUBA189');
  if r->>'state' <> 'possible_duplicate' or r->>'match_name' <> 'Vimal Narayanan' or r->>'match_email' not like 'v•••••@%' then raise exception 'duplicate not held: %', r; end if;
  -- …and cannot make itself active, or join / create a club on its own.
  begin update profiles set account_status = 'active' where id = dupl; ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a pending account activated itself'; end if;
  begin insert into groups(name, created_by, status) values ('Main', dupl, 'active'); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a pending account created a club'; end if;
  begin insert into group_members(group_id, user_id, email, role, status) values (gb, dupl, 'x', 'admin', 'active'); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a pending account joined a club'; end if;
  -- "That's not me" → approvers notified (system admin + club A admin).
  r := public.acknowledge_not_duplicate();
  -- 2. No invite, no match → waiting for a SYSTEM admin.
  perform set_config('request.jwt.claim.sub', stranger::text, true);
  r := public.begin_account(null);
  if r->>'state' <> 'pending' or r->>'kind' <> 'no_invite' then raise exception 'no-invite sign-up not held: %', r; end if;
  -- 3. Valid invite, no match → straight in.
  perform set_config('request.jwt.claim.sub', invitee::text, true);
  r := public.begin_account('CLUBA189');
  if r->>'state' <> 'active' then raise exception 'invited sign-up not admitted: %', r; end if;
  -- 4. No invite at first, then opens an invite → in straight away.
  perform set_config('request.jwt.claim.sub', late::text, true);
  r := public.begin_account(null);
  r := public.begin_account('cluba189');
  if r->>'state' <> 'active' then raise exception 'late invite did not admit: %', r; end if;
  -- 4b. Email invite, no match → in; email invite + name match ("Vimal N") → held for club B.
  perform set_config('request.jwt.claim.sub', emailinv::text, true);
  r := public.begin_account(null);
  if r->>'state' <> 'active' then raise exception 'email-invited sign-up not admitted: %', r; end if;
  perform set_config('request.jwt.claim.sub', emaildup::text, true);
  r := public.begin_account(null);
  if r->>'state' <> 'possible_duplicate' then raise exception 'email-invited duplicate not held: %', r; end if;
  -- …and the old email-invite function can't claim the row past approval.
  begin perform public.accept_group_email_invites(); ok := false; exception when others then ok := true; end;
  if not ok and exists (select 1 from group_members where user_id = emaildup and status = 'active') then raise exception 'held account claimed its email invite'; end if;
  -- 5. The retired default-club join joins nobody.
  if public.join_default_group('kim@signup189.test') is not null then raise exception 'default-club join still active'; end if;

  -- 6. Who may decide. Club A's admin: the duplicate held for club A — yes; the no-invite stranger — no.
  perform set_config('request.jwt.claim.sub', cad::text, true);
  begin perform public.admit_signup(stranger, ga); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a club admin admitted a no-invite sign-up'; end if;
  begin perform public.admit_signup(dupl, gb); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a club admin admitted into a club the sign-up was not held for'; end if;
  if (select count(*) from public.club_pending_signups(ga)) <> 1 then raise exception 'club admin does not see the one sign-up held for the club'; end if;
  perform public.reject_signup(dupl, 'Duplicate of Vimal Narayanan');
  -- System admin admits the stranger into club B.
  perform set_config('request.jwt.claim.sub', sys::text, true);
  perform public.admit_signup(stranger, gb);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);

  if (select account_status from profiles where id = mem) <> 'active' then raise exception 'existing member changed'; end if;
  if (select account_status from profiles where id = dupl) <> 'removed'
     or not exists (select 1 from banned_emails where email = 'vimal.gmail@signup189.test') then raise exception 'rejected duplicate not removed + blocked'; end if;
  if (select account_status from profiles where id = stranger) <> 'active' or not exists (select 1 from group_members where group_id = gb and user_id = stranger) then raise exception 'stranger not admitted to club B'; end if;
  if not exists (select 1 from group_members where group_id = ga and user_id = invitee) or not exists (select 1 from group_members where group_id = ga and user_id = late) then raise exception 'invited members not in club A'; end if;
  if (select count(*) from notifications where type = 'signup_pending' and user_id = sys) < 2 then raise exception 'system admin not notified of both waiting sign-ups'; end if;
  if not exists (select 1 from notifications where type = 'signup_pending' and user_id = cad) then raise exception 'club admin not notified of the duplicate held for the club'; end if;
  if exists (select 1 from notifications where type = 'signup_pending' and user_id = cad and message like '%Pat Reilly%') then raise exception 'club admin notified of a no-invite sign-up'; end if;
  if not exists (select 1 from notifications where type = 'signup_admitted' and user_id = stranger) then raise exception 'admitted member not told'; end if;
  if not exists (select 1 from group_members where group_id = gb and user_id = emailinv and status = 'active') then raise exception 'email invite not claimed'; end if;
  if (select pending_group from profiles where id = emaildup) <> gb then raise exception 'email-invited duplicate not held for club B'; end if;
  if (select use_count from group_invites where invite_code = 'CLUBA189') <> 2 then raise exception 'invite use count wrong: %', (select use_count from group_invites where invite_code = 'CLUBA189'); end if;

  delete from notifications where user_id in (sys, cad, mem, dupl, stranger, invitee, late, emailinv, emaildup);
  delete from banned_emails where email like '%@signup189.test';
  delete from group_members where group_id in (ga, gb); delete from group_invites where group_id in (ga, gb); delete from groups where id in (ga, gb);
  delete from activity_log where target_user_id in (dupl, stranger, invitee, late);
  delete from profiles where id in (sys, cad, mem, dupl, stranger, invitee, late, emailinv, emaildup); delete from auth.users where id in (sys, cad, mem, dupl, stranger, invitee, late, emailinv, emaildup);
  raise notice 'ACCOUNT_SIGNUP_PASS duplicate held + masked; no-invite waits for system admin; invite admits; late invite admits; club admin limited to its held duplicate; reject blocks; default join retired; pending cannot self-activate, join or create a club';
end $$;
