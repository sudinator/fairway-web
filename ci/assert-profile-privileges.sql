-- Disposable fresh database only. Real authenticated role/RLS; all fixtures roll back.
begin;
insert into auth.users(id) values
 ('15800000-0000-0000-0000-000000000001'),('15800000-0000-0000-0000-000000000002'),
 ('15800000-0000-0000-0000-000000000003'),('15800000-0000-0000-0000-000000000004'),
 ('15800000-0000-0000-0000-000000000005');
insert into public.banned_emails(email) values('privilege-blocked@example.test');
insert into public.profiles(id,display_name,is_admin,is_owner,banned) values
 ('15800000-0000-0000-0000-000000000001','Privilege Owner',true,true,false),
 ('15800000-0000-0000-0000-000000000002','Privilege Admin',true,false,false),
 ('15800000-0000-0000-0000-000000000003','Privilege Member',false,false,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','15800000-0000-0000-0000-000000000004',true);
-- Forged request metadata must not confer service_role SQL privileges.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ begin
  begin
    insert into public.profiles(id,is_admin) values(auth.uid(),true);
    raise exception 'FAIL: privileged admin insert succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.profiles(id,is_owner) values(auth.uid(),true);
    raise exception 'FAIL: privileged owner insert succeeded';
  exception when insufficient_privilege then null; end;
  insert into public.profiles(id,display_name) values(auth.uid(),'Ordinary signup');
  update public.profiles set display_name='Ordinary edit' where id=auth.uid();
  begin
    update public.profiles set is_admin=true where id=auth.uid();
    raise exception 'FAIL: ordinary user self-promotion succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set banned=true where id=auth.uid();
    raise exception 'FAIL: ordinary user changed ban state';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','15800000-0000-0000-0000-000000000002',true);
do $$ begin
  begin
    update public.profiles set is_admin=true where id='15800000-0000-0000-0000-000000000003';
    raise exception 'FAIL: non-owner admin directly promoted member';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_set_system_admin('15800000-0000-0000-0000-000000000003',true);
    raise exception 'FAIL: non-owner admin used owner RPC';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set is_owner=true where id=auth.uid();
    raise exception 'FAIL: non-owner admin became owner';
  exception when insufficient_privilege then null; end;
  update public.profiles set banned=true where id='15800000-0000-0000-0000-000000000003';
  update public.profiles set banned=false where id='15800000-0000-0000-0000-000000000003';
end $$;
select set_config('request.jwt.claim.sub','15800000-0000-0000-0000-000000000001',true);
select public.admin_set_system_admin('15800000-0000-0000-0000-000000000003',true);
select public.admin_set_system_admin('15800000-0000-0000-0000-000000000003',true);
update public.profiles set is_admin=false where id='15800000-0000-0000-0000-000000000003';
do $$ begin
  begin
    update public.profiles set is_admin=false where id=auth.uid();
    raise exception 'FAIL: owner self-demotion succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set is_owner=false where id=auth.uid();
    raise exception 'FAIL: browser owner mutation succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set id='15800000-0000-0000-0000-000000000004' where id=auth.uid();
    raise exception 'FAIL: browser transferred owner through profile identity';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare n integer; begin
  select count(*) into n from public.activity_log
    where target_user_id='15800000-0000-0000-0000-000000000003'
      and action in ('system_admin_granted','system_admin_revoked');
  if n <> 2 then raise exception 'FAIL: expected exactly two audit entries, got %', n; end if;
  if (select is_admin from public.profiles where id='15800000-0000-0000-0000-000000000003') then
    raise exception 'FAIL: owner demotion did not persist'; end if;
  if (select display_name from public.profiles where id='15800000-0000-0000-0000-000000000004') <> 'Ordinary edit' then
    raise exception 'FAIL: ordinary signup/edit broken'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','15800000-0000-0000-0000-000000000005',true);
insert into public.profiles(id,email) values(auth.uid(),'privilege-blocked@example.test');
do $$ begin
  begin
    update public.profiles set banned=false where id=auth.uid();
    raise exception 'FAIL: banned user cleared own ban';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if not (select banned from public.profiles where id='15800000-0000-0000-0000-000000000005') then
    raise exception 'FAIL: blocklist insert trigger no longer marks banned'; end if;
end $$;
set local role service_role;
update public.profiles set is_admin=true where id='15800000-0000-0000-0000-000000000003';
reset role;
do $$ begin
  if not (select is_admin from public.profiles where id='15800000-0000-0000-0000-000000000003') then
    raise exception 'FAIL: trusted service provisioning broken'; end if;
end $$;
rollback;
