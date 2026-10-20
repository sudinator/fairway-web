-- 0200 (210.9): a support visit is not a join.
do $$
declare adm uuid := '20000000-0000-0000-0000-0000000000a1'; boss uuid := '20000000-0000-0000-0000-0000000000a2';
        mem uuid := '20000000-0000-0000-0000-0000000000a3'; newbie uuid := '20000000-0000-0000-0000-0000000000a4';
        g uuid := '20000000-0000-0000-0000-0000000000c1'; other uuid := '20000000-0000-0000-0000-0000000000c2'; msg text;
begin
  delete from notifications where user_id in (adm, boss, mem, newbie); delete from group_members where group_id in (g, other);
  delete from groups where id in (g, other); delete from profiles where id in (adm, boss, mem, newbie); delete from auth.users where id in (adm, boss, mem, newbie);
  insert into auth.users(id, email, created_at) values (adm, 'a@s200.test', now() - interval '1 year'), (boss, 'b@s200.test', now() - interval '1 year'), (mem, 'm@s200.test', now() - interval '1 year'), (newbie, 'n@s200.test', now() - interval '1 year');
  insert into profiles(id, display_name, email, is_admin, account_status) values (adm, 'Amit Sud', 'a@s200.test', true, 'active'), (boss, 'Jigar', 'b@s200.test', false, 'active'), (mem, 'Member', 'm@s200.test', false, 'active'), (newbie, 'Newbie', 'n@s200.test', false, 'active');
  insert into groups(id, name, status, created_by) values (g, 'PA-NJ test', 'active', boss), (other, 'Other S200', 'active', adm);
  insert into group_members(group_id, user_id, email, role, status) values (g, boss, 'b@s200.test', 'admin', 'active'), (g, mem, 'm@s200.test', 'member', 'active');
  delete from notifications where user_id in (adm, boss, mem, newbie);

  -- 1. the owner enters as support (the real function)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform public.admin_enter_group(g, 'a@s200.test');
  execute 'reset role';
  if exists (select 1 from notifications where type = 'group_member' and group_id = g) then raise exception 'a support visit was announced as a JOIN'; end if;
  select message into msg from notifications where user_id = boss and type = 'support_visit';
  if msg is distinct from 'Amit Sud (BNN admin) looked in on PA-NJ test to help with support. Support visits are logged.' then raise exception 'the club admin was not told about the support visit honestly (got %)', msg; end if;
  if exists (select 1 from notifications where user_id = mem and type = 'support_visit') then raise exception 'ordinary members were told about a support visit (admins only)'; end if;
  -- 3. a real member joins while the owner is inside: counted without the support visit; the visitor isn't told
  insert into group_members(group_id, user_id, email, role, status) values (g, newbie, 'n@s200.test', 'member', 'active');
  select message into msg from notifications where user_id = boss and type = 'group_member';
  if msg is distinct from 'Newbie joined PA-NJ test (their first club).' then raise exception 'join wording wrong (got %)', msg; end if;
  if exists (select 1 from notifications where user_id = adm and type = 'group_member') then raise exception 'the support visitor was sent a join notification'; end if;
  -- …and a support visit elsewhere doesn't make someone "already in N other clubs"
  insert into group_members(group_id, user_id, email, role, status, is_support) values (other, mem, 'm@s200.test', 'admin', 'active', true);
  delete from notifications where type = 'group_member';
  update group_members set status = 'removed' where group_id = g and user_id = newbie;
  insert into group_members(group_id, user_id, email, role, status) values (other, newbie, 'n@s200.test', 'member', 'active');
  if exists (select 1 from notifications where message like '%already in%' and message like 'Newbie%') then raise exception 'a support membership counted as another club'; end if;
  -- 2. exit: the visit goes, nothing is announced
  delete from notifications where user_id in (adm, boss, mem, newbie);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform public.admin_exit_group(g);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if exists (select 1 from group_members where group_id = g and user_id = adm) then raise exception 'exit did not remove the support visit'; end if;
  if exists (select 1 from notifications where user_id in (boss, mem)) then raise exception 'exiting announced something'; end if;

  delete from activity_log where actor_id in (adm, boss, mem, newbie) or target_user_id in (adm, boss, mem, newbie);
  delete from notifications where user_id in (adm, boss, mem, newbie); delete from group_members where group_id in (g, other);
  delete from groups where id in (g, other); delete from profiles where id in (adm, boss, mem, newbie); delete from auth.users where id in (adm, boss, mem, newbie);
  raise notice 'SUPPORT_VISIT_PASS a support visit tells club admins honestly, never "joined"; joins exclude support visits; exit is silent';
end $$;
