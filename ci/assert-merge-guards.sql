-- 0196 (210.2): a merge can't take out the owner, the acting admin, or a system admin; nobody suspends themselves.
do $$
declare owner uuid := '19600000-0000-0000-0000-000000000001'; admin1 uuid := '19600000-0000-0000-0000-000000000002';
        admin2 uuid := '19600000-0000-0000-0000-000000000003'; m uuid := '19600000-0000-0000-0000-000000000004'; dup uuid := '19600000-0000-0000-0000-000000000005';
        ok boolean;
begin
  delete from activity_log where target_user_id in (owner, admin1, admin2, m, dup) or actor_id in (owner, admin1, admin2, m, dup);
  delete from banned_emails where email like '%@g196.test';
  delete from profiles where id in (owner, admin1, admin2, m, dup); delete from auth.users where id in (owner, admin1, admin2, m, dup);
  insert into auth.users(id, email) values (owner, 'o@g196.test'), (admin1, 'a1@g196.test'), (admin2, 'a2@g196.test'), (m, 'm@g196.test'), (dup, 'd@g196.test');
  insert into profiles(id, display_name, email, is_owner, is_admin, account_status) values
    (owner, 'Owner', 'o@g196.test', true, true, 'active'), (admin1, 'Admin One', 'a1@g196.test', false, true, 'active'),
    (admin2, 'Admin Two', 'a2@g196.test', false, true, 'active'), (m, 'Member', 'm@g196.test', false, false, 'active'), (dup, 'Member', 'd@g196.test', false, false, 'active');

  execute 'set local role service_role';
  begin perform public.merge_accounts_as(admin1, m, owner, 'x'); ok := false; exception when others then ok := sqlerrm like '%owner%deliberate transfer%'; end;
  if not ok then raise exception 'an admin merged the OWNER away'; end if;
  begin perform public.merge_accounts_as(admin1, m, admin1, 'x'); ok := false; exception when others then ok := sqlerrm like '%your own account%'; end;
  if not ok then raise exception 'an admin merged THEMSELVES away'; end if;
  begin perform public.merge_accounts_as(admin1, m, admin2, 'x'); ok := false; exception when others then ok := sqlerrm like '%system admin%remove its system-admin role first%'; end;
  if not ok then raise exception 'an admin merged ANOTHER SYSTEM ADMIN away'; end if;
  -- a normal duplicate still merges
  perform public.merge_accounts_as(admin1, m, dup, 'Duplicate');
  execute 'reset role';
  if (select account_status from profiles where id = owner) <> 'active' or (select account_status from profiles where id = admin2) <> 'active' or (select account_status from profiles where id = admin1) <> 'active' then
    raise exception 'a refused merge changed something'; end if;
  if (select account_status from profiles where id = dup) <> 'merged' then raise exception 'a normal merge was blocked'; end if;
  -- nobody suspends themselves
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', admin1::text, true);
  begin perform public.set_account_suspended(admin1, true, 'x'); ok := false; exception when others then ok := sqlerrm like '%your own account%'; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if not ok then raise exception 'an admin suspended themselves'; end if;

  delete from activity_log where target_user_id in (owner, admin1, admin2, m, dup) or actor_id in (owner, admin1, admin2, m, dup);
  delete from banned_emails where email like '%@g196.test';
  delete from profiles where id in (owner, admin1, admin2, m, dup); delete from auth.users where id in (owner, admin1, admin2, m, dup);
  raise notice 'MERGE_GUARDS_PASS owner, self and system admins can''t be merged away; refusals change nothing; a normal merge works; no self-suspension';
end $$;
