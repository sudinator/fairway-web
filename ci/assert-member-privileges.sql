-- 0206 (211.4): members' table privileges match their row rules; every member-writable table carries the
-- approved-accounts rule (except the recorded exceptions); a suspended member still in a club can't write.
do $$
declare bad text; sus uuid := '20600000-0000-0000-0000-000000000001'; act uuid := '20600000-0000-0000-0000-000000000002';
        g uuid := '20600000-0000-0000-0000-0000000000c1'; ok boolean;
begin
  select string_agg(distinct g2.table_name, ', ') into bad from information_schema.role_table_grants g2
   where g2.table_schema = 'public' and g2.grantee = 'authenticated' and g2.privilege_type in ('INSERT','UPDATE','DELETE')
     and g2.table_name not in ('profiles','notifications','push_subscriptions','daily_active','feedback')
     and not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = g2.table_name and c.relnamespace = 'public'::regnamespace and t.tgname = 'guard_active_account');
  if bad is not null then raise exception 'member-writable tables without the approved-accounts rule: %', bad; end if;
  select string_agg(distinct table_name, ', ') into bad from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')
     and table_name not in ('activity_log','favorite_courses','game_players','games','group_courses','group_invites','group_members','groups','holes','notifications','profiles','rounds');
  if bad is not null then raise exception 'members still hold TRUNCATE / REFERENCES / TRIGGER on: %', bad; end if;
  if has_function_privilege('authenticated', 'public.can_decide_signup(uuid,uuid)', 'execute') then raise exception 'members can call the internal can_decide_signup helper'; end if;
  -- behaviour: a SUSPENDED member who is still in a club can't add a guest directly; an active one can
  delete from group_guests where group_id = g; delete from group_members where group_id = g; delete from groups where id = g;
  delete from profiles where id in (sus, act); delete from auth.users where id in (sus, act);
  insert into auth.users(id, email) values (sus, 's@m206.test'), (act, 'a@m206.test');
  insert into profiles(id, display_name, email, account_status) values (sus, 'Suspended', 's@m206.test', 'suspended'), (act, 'Active', 'a@m206.test', 'active');
  insert into groups(id, name, status, created_by) values (g, 'M206', 'active', act);
  insert into group_members(group_id, user_id, email, role, status) values (g, sus, 's@m206.test', 'admin', 'active'), (g, act, 'a@m206.test', 'admin', 'active');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', sus::text, true);
  begin insert into group_guests(group_id, name, created_by, sponsor_user_id) values (g, 'Guest S', sus, sus); ok := false; exception when others then ok := sqlerrm like '%can''t make changes%'; end;
  if not ok then raise exception 'a suspended member added a guest directly'; end if;
  perform set_config('request.jwt.claim.sub', act::text, true);
  insert into group_guests(group_id, name, created_by, sponsor_user_id) values (g, 'Guest A', act, act);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  delete from group_guests where group_id = g; delete from group_members where group_id = g; delete from groups where id = g;
  delete from profiles where id in (sus, act); delete from auth.users where id in (sus, act);
  raise notice 'MEMBER_PRIVILEGES_PASS privileges match row rules; every member-writable table has the approved-accounts rule; a suspended member is refused, an active one isn''t';
end $$;
