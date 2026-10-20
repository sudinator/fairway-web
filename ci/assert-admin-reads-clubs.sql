-- 0202 (210.12): system admins read every club and membership; members still see only their own clubs.
do $$
declare adm uuid := '20200000-0000-0000-0000-0000000000a1'; boss uuid := '20200000-0000-0000-0000-0000000000a2';
        mem uuid := '20200000-0000-0000-0000-0000000000a3'; outsider uuid := '20200000-0000-0000-0000-0000000000a4';
        g uuid := '20200000-0000-0000-0000-0000000000c1'; mine uuid := '20200000-0000-0000-0000-0000000000c2'; n int;
begin
  delete from notifications where user_id in (adm, boss, mem, outsider); delete from group_members where group_id in (g, mine);
  delete from groups where id in (g, mine); delete from profiles where id in (adm, boss, mem, outsider); delete from auth.users where id in (adm, boss, mem, outsider);
  insert into auth.users(id, email) values (adm, 'a@r202.test'), (boss, 'b@r202.test'), (mem, 'm@r202.test'), (outsider, 'o@r202.test');
  insert into profiles(id, display_name, email, is_admin, account_status) values (adm, 'Admin', 'a@r202.test', true, 'active'), (boss, 'Boss', 'b@r202.test', false, 'active'), (mem, 'Member', 'm@r202.test', false, 'active'), (outsider, 'Outsider', 'o@r202.test', false, 'active');
  insert into groups(id, name, status, created_by) values (g, 'Their Club', 'active', boss), (mine, 'Outsider Club', 'active', outsider);
  insert into group_members(group_id, user_id, email, role, status) values (g, boss, 'b@r202.test', 'admin', 'active'), (g, mem, 'm@r202.test', 'member', 'active'), (mine, outsider, 'o@r202.test', 'admin', 'active');

  execute 'set local role authenticated';
  -- a system admin who isn't in the club: sees it, its members, and can really remove one
  perform set_config('request.jwt.claim.sub', adm::text, true);
  if not exists (select 1 from groups where id = g) then raise exception 'a system admin cannot see a club they are not in'; end if;
  select count(*) into n from group_members where group_id = g;
  if n <> 2 then raise exception 'a system admin sees % of the club''s 2 memberships', n; end if;
  update group_members set status = 'removed' where group_id = g and user_id = mem; get diagnostics n = row_count;
  if n <> 1 then raise exception 'removing a member from a club the admin isn''t in silently did nothing'; end if;
  -- a regular member of another club: sees neither the club nor its members
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  if exists (select 1 from groups where id = g) or exists (select 1 from group_members where group_id = g) then raise exception 'a regular member can see a club they are not in'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from notifications where user_id in (adm, boss, mem, outsider); delete from group_members where group_id in (g, mine);
  delete from groups where id in (g, mine); delete from profiles where id in (adm, boss, mem, outsider); delete from auth.users where id in (adm, boss, mem, outsider);
  raise notice 'ADMIN_READS_CLUBS_PASS system admins see every club and membership (and removals work); members still see only their own clubs';
end $$;
