-- 0199 (210.8): club requests are visible to system admins, decided only by them, and enforced in the database.
do $$
declare adm uuid := '19900000-0000-0000-0000-0000000000a1'; req uuid := '19900000-0000-0000-0000-0000000000a2'; other uuid := '19900000-0000-0000-0000-0000000000a3';
        g1 uuid; g2 uuid; n int; ok boolean; v text;
begin
  delete from notifications where user_id in (adm, req, other); delete from group_invites where created_by in (adm, req, other);
  delete from group_members where user_id in (adm, req, other); delete from groups where created_by in (adm, req, other);
  delete from profiles where id in (adm, req, other); delete from auth.users where id in (adm, req, other);
  insert into auth.users(id, email) values (adm, 'a@c199.test'), (req, 'r@c199.test'), (other, 'o@c199.test');
  insert into profiles(id, display_name, email, is_admin, account_status) values (adm, 'Admin', 'a@c199.test', true, 'active'), (req, 'Jigar', 'r@c199.test', false, 'active'), (other, 'Other', 'o@c199.test', false, 'active');

  execute 'set local role authenticated';
  -- the requester asks for a club — even asking for 'active' gives a PENDING club
  perform set_config('request.jwt.claim.sub', req::text, true);
  insert into groups(name, created_by, status, request_note) values ('PA-NJ test', req, 'active', 'for weekends') returning id into g1;
  insert into group_members(group_id, user_id, email, role, status) values (g1, req, 'r@c199.test', 'admin', 'active');
  -- the requester can't approve their own club, and can't invite before approval
  begin update groups set status = 'active' where id = g1; ok := false; exception when others then ok := sqlerrm like '%only a system admin%'; end;
  if not ok then raise exception 'the requester approved their own club'; end if;
  begin insert into group_invites(group_id, invite_code, role, status, created_by) values (g1, 'C199INV1', 'member', 'active', req); ok := false; exception when others then ok := sqlerrm like '%waiting for approval%'; end;
  if not ok then raise exception 'a pending club created an invite'; end if;
  -- a regular member can't list requests
  perform set_config('request.jwt.claim.sub', other::text, true);
  begin perform public.admin_club_requests(); ok := false; exception when others then ok := sqlerrm like '%system admins only%'; end;
  if not ok then raise exception 'a regular member listed club requests'; end if;
  -- THE BUG: a system admin reading clubs directly sees none of someone else's pending requests…
  perform set_config('request.jwt.claim.sub', adm::text, true);
  select count(*) into n from groups where id = g1;
  if n <> 0 then raise notice 'note: the direct read now shows the request (visibility rule changed)'; end if;
  -- …the fix: the admin function shows it, with the requester and the note
  select count(*) into n from public.admin_club_requests() where id = g1 and requester_name = 'Jigar' and request_note = 'for weekends';
  if n <> 1 then raise exception 'the system admin cannot see the club request'; end if;
  -- approve → active, requester notified; deciding twice is refused
  v := public.decide_club_request(g1, true);
  if v is distinct from 'active' then raise exception 'approve returned %', v; end if;
  begin perform public.decide_club_request(g1, true); ok := false; exception when others then ok := sqlerrm like '%isn''t waiting for approval%'; end;
  if not ok then raise exception 'a club was approved twice'; end if;
  -- decline → declined, requester notified
  perform set_config('request.jwt.claim.sub', req::text, true);
  insert into groups(name, created_by, request_note) values ('Second ask', req, null) returning id into g2;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  v := public.decide_club_request(g2, false);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if (select status from groups where id = g1) is distinct from 'active' or (select status from groups where id = g2) is distinct from 'declined' then raise exception 'decisions not saved'; end if;
  if (select count(*) from notifications where user_id = req and type = 'club_decision') <> 2 then raise exception 'the requester was not notified of both decisions'; end if;
  -- 210.10: the approval opens Clubs WITH that club; the decline opens Clubs
  if not exists (select 1 from notifications where user_id = req and type = 'club_decision' and link = '/?tab=groups&club=' || g1::text) then raise exception 'the approval notification does not open the approved club'; end if;
  if not exists (select 1 from notifications where user_id = req and type = 'club_decision' and link = '/?tab=groups') then raise exception 'the decline notification does not open Clubs'; end if;

  delete from notifications where user_id in (adm, req, other); delete from group_invites where created_by in (adm, req, other);
  delete from group_members where user_id in (adm, req, other); delete from groups where created_by in (adm, req, other);
  delete from profiles where id in (adm, req, other); delete from auth.users where id in (adm, req, other);
  raise notice 'CLUB_REQUESTS_PASS admins see every request; new clubs start pending; only admins decide; pending clubs can''t invite; requester notified';
end $$;
