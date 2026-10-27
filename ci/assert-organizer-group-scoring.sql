-- assert-organizer-group-scoring.sql — 0226 (212.55): the organizer takes over any group's scoring (its scorer is notified,
-- no permission needed), holds it — nobody in the group can grab it back — and hands it back for anyone in the group.
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
declare org uuid := '22300000-0000-0000-0000-0000000000a0'; pl uuid := '22300000-0000-0000-0000-0000000000a1'; mem uuid := '22300000-0000-0000-0000-0000000000a3';
  g uuid := '22301000-0000-0000-0000-000000000001'; ended uuid := '22301000-0000-0000-0000-000000000002';
  orow uuid := '22302000-0000-0000-0000-000000000001'; prow uuid := '22302000-0000-0000-0000-000000000002'; mrow uuid := '22302000-0000-0000-0000-000000000003';
  holes jsonb := (select jsonb_agg(jsonb_build_object('n', i, 'par', 4, 'si', i)) from generate_series(1, 18) i);
begin
  -- the organizer plays in group 1; the player and a member in group 2, where the MEMBER keeps score
  perform pg_temp.as_user(org);
  perform public.create_game_complete(jsonb_build_object('id', g, 'code', '226001', 'name', 'Saturday', 'course', 'C', 'holes_meta', holes, 'course_par', 72, 'game_type', 'stableford', 'group_id', '22300000-0000-0000-0000-00000000c1b0'),
    jsonb_build_array(jsonb_build_object('id', orow, 'user_id', org, 'display_name', 'Org'), jsonb_build_object('id', prow, 'user_id', pl, 'display_name', 'Player'), jsonb_build_object('id', mrow, 'user_id', mem, 'display_name', 'Member')),
    '[]', jsonb_build_array(jsonb_build_object('player', orow, 'group', 1), jsonb_build_object('player', prow, 'group', 2), jsonb_build_object('player', mrow, 'group', 2)), null, true);
  perform pg_temp.as_maintenance();
  update public.game_players set is_marker = true where id = mrow;
  delete from public.notifications where user_id in (pl, mem);

  -- only the organizer can take over
  perform pg_temp.as_user(pl);
  if pg_temp.allowed(format('select public.organizer_take_group_scoring(%L::uuid, 2::smallint)', g)) then raise exception 'a player took over a group''s scoring'; end if;
  perform pg_temp.as_maintenance();

  -- the organizer takes over Group 2: its scorer steps down and is told; the organizer holds it
  perform pg_temp.as_user(org);
  perform public.organizer_take_group_scoring(g, 2::smallint);
  perform public.organizer_take_group_scoring(g, 2::smallint);   -- again: nothing changes
  perform pg_temp.as_maintenance();
  if (select organizer_scoring_groups from public.games where id = g) is distinct from '{2}'::smallint[] then raise exception 'the hold was not recorded once'; end if;
  if (select is_marker from public.game_players where id = mrow) then raise exception 'the old scorer is still the scorer'; end if;
  if (select count(*) from public.notifications where user_id = mem and type = 'scoring_taken_over' and message like '%took over scoring for Group 2%') <> 1 then raise exception 'the old scorer was not told (exactly once)'; end if;
  if exists (select 1 from public.notifications where user_id = pl and type = 'scoring_taken_over') then raise exception 'a non-scorer was told about the take-over'; end if;

  -- while held, nobody in the group can grab the card back
  perform pg_temp.as_user(mem);
  if pg_temp.allowed(format('select public.claim_group_marker(%L::uuid)', g)) then raise exception 'the old scorer grabbed the card back while the organizer held it'; end if;
  perform pg_temp.as_maintenance();
  -- the organizer keeps the score
  perform pg_temp.as_user(org);
  perform public.save_game_score_bundle(prow, (select scoring_version from public.games where id = g), '{"scores":[4]}'::jsonb, false);
  perform pg_temp.as_maintenance();
  if (select scores from public.game_players where id = prow) <> '[4]'::jsonb then raise exception 'the organizer''s score did not save'; end if;

  -- only the organizer hands it back; then the group's players are told, and anyone in it may keep score
  perform pg_temp.as_user(pl);
  if pg_temp.allowed(format('select public.organizer_release_group_scoring(%L::uuid, 2::smallint)', g)) then raise exception 'a player handed back the organizer''s hold'; end if;
  perform pg_temp.as_maintenance();
  perform pg_temp.as_user(org);
  perform public.organizer_release_group_scoring(g, 2::smallint);
  perform pg_temp.as_maintenance();
  if (select organizer_scoring_groups from public.games where id = g) is distinct from '{}'::smallint[] then raise exception 'the hold was not released'; end if;
  if (select count(*) from public.notifications where type = 'scoring_handed_back' and user_id in (pl, mem)) <> 2 then raise exception 'the group''s players were not both told the card is open'; end if;
  perform pg_temp.as_user(pl);
  perform public.claim_group_marker(g);
  perform pg_temp.as_maintenance();
  if not (select is_marker from public.game_players where id = prow) then raise exception 'a group member could not keep score after the hand-back'; end if;

  -- not on an ended game (the organizer corrects scores directly then)
  perform pg_temp.as_user(org);
  perform public.create_game_complete(jsonb_build_object('id', ended, 'code', '226002', 'name', 'Done', 'course', 'C', 'holes_meta', holes, 'course_par', 72, 'game_type', 'stableford', 'group_id', '22300000-0000-0000-0000-00000000c1b0'),
    jsonb_build_array(jsonb_build_object('id', '22302000-0000-0000-0000-000000000011', 'user_id', org, 'display_name', 'Org')), '[]', jsonb_build_array(jsonb_build_object('player', '22302000-0000-0000-0000-000000000011', 'group', 1)), null, true);
  perform pg_temp.as_maintenance(); update public.games set status = 'ended' where id = ended; perform pg_temp.as_user(org);
  if pg_temp.allowed(format('select public.organizer_take_group_scoring(%L::uuid, 1::smallint)', ended)) then raise exception 'the organizer took over scoring on an ended game'; end if;
  perform pg_temp.as_maintenance();
  raise notice 'ORGANIZER_GROUP_SCORING_PASS the organizer takes over any group (its scorer told, once; nobody grabs it back), scores it, hands it back (the group told; a member then keeps score); organizer only; not after the end';
end $$;
rollback;
