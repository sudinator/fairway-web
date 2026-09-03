-- FRESH-DB ONLY: representative real RLS authorization behavior tests.
-- Uses disposable fixtures and an authenticated JWT claim; all changes roll back.

begin;
set local row_security = on;

-- Avoid unrelated application triggers: this script tests RLS, not notifications/analytics side effects.
alter table public.notifications disable trigger user;
alter table public.rounds disable trigger user;
alter table public.holes disable trigger user;

-- Fixture owners do not need profile rows; is_admin() therefore resolves false.
insert into public.notifications(id,user_id,message) values
 ('a1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','A fixture'),
 ('b1000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','B fixture');
insert into public.rounds(id,user_id,course,group_id,status) values
 ('a2000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','RLS A',null,'final'),
 ('b2000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','RLS B',null,'final');
insert into public.holes(id,round_id,hole_number,par) values
 ('a3000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001',1,4),
 ('b3000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001',1,4);

insert into public.profiles(id,display_name,email,is_admin,is_owner,banned) values
 ('11111111-1111-1111-1111-111111111111','RLS A','rls-a@example.test',false,false,false),
 ('22222222-2222-2222-2222-222222222222','RLS B','rls-b@example.test',false,false,false);
insert into public.groups(id,name,created_by) values
 ('a4000000-0000-0000-0000-000000000001','RLS A Group','11111111-1111-1111-1111-111111111111'),
 ('b4000000-0000-0000-0000-000000000001','RLS B Group','22222222-2222-2222-2222-222222222222');
insert into public.group_members(id,group_id,user_id,email,role,status) values
 ('a5000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','rls-a@example.test','admin','active'),
 ('a5000000-0000-0000-0000-000000000002','a4000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','rls-b@example.test','member','active'),
 ('b5000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','rls-b@example.test','admin','active'),
 ('b5000000-0000-0000-0000-000000000002','b4000000-0000-0000-0000-000000000001',null,'rls-a@example.test','member','invited');
insert into public.games(id,code,name,course,holes_meta,group_id,created_by,status,game_type) values
 ('b6000000-0000-0000-0000-000000000001','990001','RLS B Game','Test Course','[]'::jsonb,'b4000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','active','stableford'),
 ('a6000000-0000-0000-0000-000000000001','990002','RLS A Completed','Test Course','[]'::jsonb,'a4000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','ended','stableford'),
 ('a6000000-0000-0000-0000-000000000002','990003','RLS A Alternate Shot','Test Course','[]'::jsonb,'a4000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','ended','alt_shot');
insert into public.competitions(
  id,group_id,name,start_date,status,team_a_name,team_b_name,created_by
) values (
  'a8000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  'RLS Completed Ryder Cup',current_date,'active','Blue','Red',
  '11111111-1111-1111-1111-111111111111'
);
insert into public.competition_players(competition_id,user_id,team_key,display_name) values
 ('a8000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','A','RLS A'),
 ('a8000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','B','RLS B');
insert into public.games(
  id,code,name,course,holes_meta,group_id,created_by,status,game_type,teams
) values (
  'a6000000-0000-0000-0000-000000000003','990004','RLS Cup Completed','Test Course','[]'::jsonb,
  'a4000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','ended','match',
  '[{"key":"A","name":"Blue"},{"key":"B","name":"Red"}]'::jsonb
);
insert into public.game_players(id,game_id,user_id,display_name) values
 ('b6100000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','RLS B Player');
insert into public.game_players(id,game_id,user_id,display_name,team) values
 ('a6100000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','RLS A','A'),
 ('a6100000-0000-0000-0000-000000000002','a6000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','RLS B','B');
insert into public.competition_sessions(
  id,competition_id,name,format,session_order,play_date,game_id
) values (
  'a8100000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000001',
  'Completed Singles','match',1,current_date,'a6000000-0000-0000-0000-000000000003'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.email','rls-a@example.test',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"rls-a@example.test"}',true);

do $$
declare
  n integer;
  denied boolean;
begin
  select count(*) into n from public.notifications where id in ('a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'RLS behavior: notification owner SELECT expected 1 visible fixture, got %', n; end if;

  select count(*) into n from public.rounds where id in ('a2000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'RLS behavior: round owner SELECT expected 1 visible fixture, got %', n; end if;

  select count(*) into n from public.holes where id in ('a3000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'RLS behavior: hole owner SELECT expected 1 visible fixture, got %', n; end if;

  insert into public.notifications(id,user_id,message) values
    ('a1000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','A allowed');
  denied := false;
  begin
    insert into public.notifications(id,user_id,message) values
      ('b1000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','B denied');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'RLS behavior: cross-user notification INSERT unexpectedly allowed'; end if;

  insert into public.rounds(id,user_id,course,group_id,status) values
    ('a2000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','RLS A allowed',null,'final');
  denied := false;
  begin
    insert into public.rounds(id,user_id,course,group_id,status) values
      ('b2000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','RLS B denied',null,'final');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'RLS behavior: cross-user round INSERT unexpectedly allowed'; end if;

  insert into public.holes(id,round_id,hole_number,par) values
    ('a3000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001',2,4);
  denied := false;
  begin
    insert into public.holes(id,round_id,hole_number,par) values
      ('b3000000-0000-0000-0000-000000000002','b2000000-0000-0000-0000-000000000001',2,4);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'RLS behavior: cross-user hole INSERT unexpectedly allowed'; end if;

  denied := false;
  begin
    update public.profiles set is_owner = true where id = auth.uid();
  exception when others then denied := true;
  end;
  if not denied then raise exception 'Security boundary: user self-promoted to owner'; end if;

  denied := false;
  begin
    insert into public.group_members(group_id,user_id,email,role,status) values
      ('b4000000-0000-0000-0000-000000000001',auth.uid(),'rls-a-rogue@example.test','admin','active');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'Security boundary: outsider self-appointed as group admin'; end if;

  perform public.accept_group_email_invites();
  select count(*) into n from public.group_members
   where id = 'b5000000-0000-0000-0000-000000000002'
     and user_id = auth.uid() and status = 'active' and role = 'member';
  if n <> 1 then raise exception 'Security boundary: invite acceptance did not preserve member role'; end if;

  -- PostgreSQL RLS commonly filters an unauthorized UPDATE to zero rows rather than throwing.
  -- Prove the persisted outcome instead of requiring a particular error surface.
  update public.group_members set role = 'admin'
   where id = 'b5000000-0000-0000-0000-000000000002';
  select count(*) into n from public.group_members
   where id = 'b5000000-0000-0000-0000-000000000002'
     and role = 'admin';
  if n <> 0 then raise exception 'Security boundary: invitee upgraded own membership role'; end if;

  update public.games set name = 'Hijacked'
   where id = 'b6000000-0000-0000-0000-000000000001';
  if found then raise exception 'Security boundary: group member edited another organizer''s game'; end if;

  denied := false;
  begin
    perform public.delete_game('a6000000-0000-0000-0000-000000000001', false);
  exception when others then denied := true;
  end;
  if not denied then raise exception 'Security boundary: organizer deleted a completed game'; end if;

  denied := false;
  begin
    perform * from public.delete_team_competition('a8000000-0000-0000-0000-000000000001');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'Security boundary: club admin deleted a Ryder Cup containing a completed Game'; end if;

  denied := false;
  begin
    perform * from public.admin_game_oversight(null, 'all', 200);
  exception when others then denied := true;
  end;
  if not denied then raise exception 'Security boundary: ordinary member used system-admin Game oversight'; end if;

  if has_table_privilege('authenticated','public.games','TRUNCATE')
     or has_table_privilege('anon','public.games','TRUNCATE') then
    raise exception 'Security boundary: browser role retains TRUNCATE';
  end if;
  if has_function_privilege('authenticated','public._money_snapshot(uuid)','EXECUTE')
     or has_function_privilege('anon','public._money_snapshot(uuid)','EXECUTE') then
    raise exception 'Security boundary: browser role can execute internal money snapshot helper';
  end if;
  if has_function_privilege('anon','public.sweep_stale_games()','EXECUTE') then
    raise exception 'Security boundary: anon can execute stale-game sweep';
  end if;
end $$;

reset role;

-- System-admin Game inspection and deletion behavior. Own-ball history survives; shared-ball
-- Alternate Shot history does not.
insert into public.rounds(id,user_id,course,group_id,status,game_id) values
 ('a7000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Own Ball','a4000000-0000-0000-0000-000000000001','final','a6000000-0000-0000-0000-000000000001'),
 ('a7000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Shared Ball','a4000000-0000-0000-0000-000000000001','final','a6000000-0000-0000-0000-000000000002'),
 ('a7000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Ryder Cup Own Ball','a4000000-0000-0000-0000-000000000001','final','a6000000-0000-0000-0000-000000000003');
insert into public.holes(id,round_id,hole_number,par) values
 ('a7100000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001',1,4),
 ('a7100000-0000-0000-0000-000000000002','a7000000-0000-0000-0000-000000000002',1,4),
 ('a7100000-0000-0000-0000-000000000003','a7000000-0000-0000-0000-000000000003',1,4);
update public.profiles set is_admin = true where id = '11111111-1111-1111-1111-111111111111';

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.email','rls-a@example.test',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"rls-a@example.test"}',true);

do $$
declare
  n integer;
begin
  select count(*) into n
    from public.game_players
   where game_id = 'b6000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'System-admin oversight: unrelated Game players are not visible'; end if;

  select count(*) into n
    from public.admin_game_oversight('RLS B Player', 'all', 200)
   where game_id = 'b6000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'System-admin oversight: Game/player search did not find the unrelated Game'; end if;

  perform public.admin_delete_game('a6000000-0000-0000-0000-000000000001');
  perform public.admin_delete_game('a6000000-0000-0000-0000-000000000002');
  perform * from public.delete_team_competition('a8000000-0000-0000-0000-000000000001');
end $$;

reset role;

do $$
begin
  if not exists (select 1 from public.rounds where id = 'a7000000-0000-0000-0000-000000000001') then
    raise exception 'System-admin deletion removed an own-ball round';
  end if;
  if not exists (select 1 from public.holes where id = 'a7100000-0000-0000-0000-000000000001') then
    raise exception 'System-admin deletion removed own-ball hole detail';
  end if;
  if exists (select 1 from public.rounds where id = 'a7000000-0000-0000-0000-000000000002') then
    raise exception 'System-admin deletion preserved an Alternate Shot shared-ball round';
  end if;
  if exists (select 1 from public.holes where id = 'a7100000-0000-0000-0000-000000000002') then
    raise exception 'System-admin deletion preserved Alternate Shot shared-ball hole detail';
  end if;
  if exists (select 1 from public.competitions where id = 'a8000000-0000-0000-0000-000000000001')
     or exists (select 1 from public.games where id = 'a6000000-0000-0000-0000-000000000003') then
    raise exception 'System-admin deletion did not remove the Ryder Cup and linked Game';
  end if;
  if not exists (select 1 from public.rounds where id = 'a7000000-0000-0000-0000-000000000003')
     or not exists (select 1 from public.holes where id = 'a7100000-0000-0000-0000-000000000003') then
    raise exception 'System-admin Ryder Cup deletion removed an own-ball round';
  end if;
  if not exists (
    select 1 from public.activity_log
     where actor_id = '11111111-1111-1111-1111-111111111111'
       and action = 'admin_game_repair'
       and summary like 'System admin deleted game "RLS A Completed"%'
  ) then
    raise exception 'System-admin Game deletion did not write its transactional audit entry';
  end if;
  if not exists (
    select 1 from public.activity_log
     where actor_id = '11111111-1111-1111-1111-111111111111'
       and action = 'competition_deleted'
       and summary like 'Deleted Ryder Cup "RLS Completed Ryder Cup"%'
  ) then
    raise exception 'System-admin Ryder Cup deletion did not write its transactional audit entry';
  end if;
end $$;

select 'CORE_RLS_BEHAVIOR_PASS' as marker, 'core ownership plus owner/group/game/function/grant escalation boundaries enforced' as result;
rollback;
