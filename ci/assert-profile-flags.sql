-- assert-profile-flags.sql — 0229 (212.58): is_test and deactivated on a profile change only through a system admin
-- (a member may clear their own deactivated flag, as the join page does); the editor's own fields stay the member's.
begin;
insert into auth.users(id, email) values
 ('22300000-0000-0000-0000-0000000000a0', 'org@w.test'), ('22300000-0000-0000-0000-0000000000a1', 'player@w.test'),
 ('22300000-0000-0000-0000-0000000000a2', 'cadmin@w.test'), ('22300000-0000-0000-0000-0000000000a3', 'member@w.test'),
 ('22300000-0000-0000-0000-0000000000a4', 'outsider@w.test'), ('22300000-0000-0000-0000-0000000000a5', 'sysadmin@w.test');
insert into public.profiles(id, display_name, account_status, is_admin)
select id, split_part(email, '@', 1), 'active', email like 'sysadmin@%' from auth.users where email like '%@w.test';
insert into public.groups(id, name, created_by) values ('22300000-0000-0000-0000-00000000c1b0', 'Who Club', '22300000-0000-0000-0000-0000000000a2');
insert into public.group_members(group_id, user_id, email, role, status)
select '22300000-0000-0000-0000-00000000c1b0', id, email, case when email like 'cadmin@%' then 'admin' else 'member' end, 'active'
  from auth.users where email in ('org@w.test', 'player@w.test', 'cadmin@w.test', 'member@w.test');
insert into public.scoring_devices(user_id, token) select id, id from auth.users where email like '%@w.test';

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-bnn-scoring-device', u)::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.as_maintenance() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '', true); perform set_config('request.headers', '', true); end $$;
-- did the server let this person do it? (always rolled back, so every attempt starts from the same game)
create or replace function pg_temp.allowed(q text) returns boolean language plpgsql as $$
begin execute q; raise exception 'BNN_ALLOWED'; exception when others then return sqlerrm = 'BNN_ALLOWED'; end $$;

do $$
declare pl uuid := '22300000-0000-0000-0000-0000000000a1'; sys uuid := '22300000-0000-0000-0000-0000000000a5'; c record; got boolean; bad text := '';
begin
  for c in select * from (values
    -- (what, actor, change, allowed?, starting state of deactivated)
    ('member marks themselves a test account',   pl,  'is_test = true',          false, false),
    ('member reactivates themselves',            pl,  'deactivated = false',     true,  true),
    ('member deactivates themselves',            pl,  'deactivated = true',      false, false),
    ('member edits their own name and handicap', pl,  'display_name = ''Tiger'', handicap_index = 9.1', true, false),
    ('member gives themselves admin',            pl,  'is_admin = true',         false, false),
    ('system admin marks the test account',      sys, 'is_test = true',          true,  false),
    ('system admin deactivates the member',      sys, 'deactivated = true',      true,  false)
  ) as t(what, actor, q, want, start_deactivated) loop
    perform pg_temp.as_maintenance(); update public.profiles set deactivated = c.start_deactivated where id = pl;
    perform pg_temp.as_user(c.actor);
    got := pg_temp.allowed(format('do $y$ declare n int; begin update public.profiles set %s where id = %L; get diagnostics n = row_count; if n = 0 then raise exception ''no row''; end if; end $y$', c.q, pl));
    perform pg_temp.as_maintenance();
    if got is distinct from c.want then bad := bad || format(E'\n  %s was %s (expected %s)', c.what, case when got then 'ALLOWED' else 'refused' end, case when c.want then 'allowed' else 'refused' end); end if;
  end loop;
  if bad is distinct from '' then raise exception 'PROFILE FLAGS mismatch:%', bad; end if;
  raise notice 'PROFILE_FLAGS_PASS is_test and deactivation are a system admin''s; a member reactivates themselves and edits their own fields; no self-promotion';
end $$;
rollback;
