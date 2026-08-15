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

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select set_config('request.jwt.claim.role','authenticated',true);

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
end $$;

reset role;
select 'CORE_RLS_BEHAVIOR_PASS' as marker, 'owner visibility/writes allowed; cross-user notification/round/hole access denied' as result;
rollback;
