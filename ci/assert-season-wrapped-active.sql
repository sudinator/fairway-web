-- 0191 (209.0): Season Wrapped goes to ACTIVE members only; the dry run lists exactly who would be notified.
do $$
declare act uuid := '19100000-0000-0000-0000-000000000001'; sus uuid := '19100000-0000-0000-0000-000000000002';
        mer uuid := '19100000-0000-0000-0000-000000000003'; n int; sent int;
begin
  delete from notifications where user_id in (act, sus, mer); delete from rounds where user_id in (act, sus, mer);
  delete from profiles where id in (act, sus, mer); delete from auth.users where id in (act, sus, mer);
  insert into auth.users(id, email) values (act, 'act@w191.test'), (sus, 'sus@w191.test'), (mer, 'mer@w191.test');
  insert into profiles(id, display_name, email, account_status) values
    (act, 'Active Ann', 'act@w191.test', 'active'), (sus, 'Suspended Sid', 'sus@w191.test', 'suspended'), (mer, 'Merged Mo', 'mer@w191.test', 'merged');
  insert into rounds(user_id, course, played_at, status) values
    (act, 'W191', '2026-05-01', 'final'), (act, 'W191', '2026-06-01', 'final'), (sus, 'W191', '2026-05-01', 'final'), (mer, 'W191', '2026-05-01', 'final');

  -- The dry run: only the active member, with her round count, nothing sent.
  select count(*) into n from public.season_wrapped_preview(2026) where email like '%@w191.test';
  if n <> 1 or (select rounds from public.season_wrapped_preview(2026) where email = 'act@w191.test') <> 2 then raise exception 'dry run should list only the active member, with 2 rounds'; end if;
  if exists (select 1 from notifications where user_id in (act, sus, mer)) then raise exception 'the dry run sent something'; end if;
  -- The real send: the active member only.
  perform public.send_season_wrapped(2026);
  select count(*) into sent from notifications where type = 'season_wrapped' and user_id in (act, sus, mer);
  if sent <> 1 or not exists (select 1 from notifications where type = 'season_wrapped' and user_id = act) then raise exception 'season summary went to a non-active account (sent %)', sent; end if;
  if (select already_sent from public.season_wrapped_preview(2026) where email = 'act@w191.test') is not true then raise exception 'dry run does not show it as sent'; end if;
  -- An app user who isn't a system admin can't run the dry run.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', act::text, true);
  begin perform public.season_wrapped_preview(2026); raise exception 'not refused'; exception when others then if sqlerrm = 'not refused' then raise; end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from notifications where user_id in (act, sus, mer); delete from rounds where user_id in (act, sus, mer);
  delete from profiles where id in (act, sus, mer); delete from auth.users where id in (act, sus, mer);
  raise notice 'SEASON_WRAPPED_ACTIVE_PASS active members only; dry run lists who and how many, sends nothing; admin only';
end $$;
