-- assert-create-game-announce.sql — 0219 (212.40): the one-step server step's promises, on a real database.
--   1. today's Create is untouched: a game made the old way notifies each player at once, word for word as before
--   2. create_game_complete tells each member once, AFTER everything is saved, with their own setup (approved wording)
--   3. "create now, finish later": nobody is told — not even a player added later — until announce_game_players
--   4. all or nothing: a bad line-up leaves no game, no players, no notifications
--   5. permissions: signed-out callers can't; non-members can't create in the club; only the organizer can announce
begin;
insert into auth.users(id, email) values
 ('21940000-0000-0000-0000-0000000000a0', 'ann0@example.test'), ('21940000-0000-0000-0000-0000000000a1', 'ann1@example.test'),
 ('21940000-0000-0000-0000-0000000000a2', 'ann2@example.test'), ('21940000-0000-0000-0000-0000000000a3', 'ann3@example.test'),
 ('21940000-0000-0000-0000-0000000000b9', 'outsider@example.test');
insert into public.profiles(id, display_name, account_status) values
 ('21940000-0000-0000-0000-0000000000a0', 'Amit Sud', 'active'), ('21940000-0000-0000-0000-0000000000a1', 'Raj Mehta', 'active'),
 ('21940000-0000-0000-0000-0000000000a2', 'Sam Lee', 'active'), ('21940000-0000-0000-0000-0000000000a3', 'Vikram Rao', 'active'),
 ('21940000-0000-0000-0000-0000000000b9', 'Out Sider', 'active');
insert into public.groups(id, name, created_by) values ('21940000-0000-0000-0000-00000000c1b0', 'Announce Club', '21940000-0000-0000-0000-0000000000a0');
insert into public.group_members(group_id, user_id, email, role, status) values
 ('21940000-0000-0000-0000-00000000c1b0', '21940000-0000-0000-0000-0000000000a0', 'ann0@example.test', 'admin', 'active'),
 ('21940000-0000-0000-0000-00000000c1b0', '21940000-0000-0000-0000-0000000000a1', 'ann1@example.test', 'member', 'active'),
 ('21940000-0000-0000-0000-00000000c1b0', '21940000-0000-0000-0000-0000000000a2', 'ann2@example.test', 'member', 'active'),
 ('21940000-0000-0000-0000-00000000c1b0', '21940000-0000-0000-0000-0000000000a3', 'ann3@example.test', 'member', 'active');

create temp table ann_holes as select jsonb_agg(jsonb_build_object('n', n, 'par', 4, 'si', n) order by n) h from generate_series(1, 18) n;
grant select on ann_holes to authenticated;

do $$
declare
  org uuid := '21940000-0000-0000-0000-0000000000a0'; raj uuid := '21940000-0000-0000-0000-0000000000a1';
  sam uuid := '21940000-0000-0000-0000-0000000000a2'; vik uuid := '21940000-0000-0000-0000-0000000000a3';
  club uuid := '21940000-0000-0000-0000-00000000c1b0'; holes jsonb := (select h from ann_holes);
  g uuid; d text; n int; ok boolean; pr record;
  pl jsonb;
  four_teams jsonb := '[{"key":"A","name":"Reds"},{"key":"B","name":"Blues"}]';
begin
  perform set_config('request.jwt.claim.sub', org::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', org, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1. the OLD path (today's Create: insert the game, then the players) notifies each member at once, text unchanged
  insert into public.games(id, code, name, course, holes_meta, game_type, created_by, group_id)
  values ('21941000-0000-0000-0000-000000000001', '219401', 'Old Way', 'Test Course', holes, 'stableford', org, club);
  insert into public.game_players(id, game_id, user_id, display_name, tee_name, course_handicap) values
   ('21942000-0000-0000-0000-000000000001', '21941000-0000-0000-0000-000000000001', org, 'Amit Sud', 'Blue', 18),
   ('21942000-0000-0000-0000-000000000002', '21941000-0000-0000-0000-000000000001', raj, 'Raj Mehta', 'Blue', 4);
  execute 'reset role';
  select count(*) into n from notifications where type = 'game_added' and link = '/?game=219401';
  if n is distinct from 2 then raise exception 'old path: expected 2 notifications at once, got %', n; end if;
  select detail into d from notifications where user_id = raj and link = '/?game=219401';
  if d is distinct from 'Test Course · set up ' || to_char(now() at time zone 'America/New_York', 'Dy Mon FMDD') || ' · stableford · code 219401 · you play the Blue tees (CH 4)' then
    raise exception 'old path: notification detail changed: %', d; end if;
  if (select message from notifications where user_id = raj and link = '/?game=219401') is distinct from public.person_label(org) || ' added you to "Old Way". Tap to open the game.' then
    raise exception 'old path: notification message changed'; end if;
  if (select message from notifications where user_id = org and link = '/?game=219401') is distinct from 'You set up "Old Way". Tap to open the game.' then
    raise exception 'old path: organizer''s own message changed'; end if;

  -- 2. ONE STEP, four-ball: one notification each, after everything is saved, with their own setup
  pl := jsonb_build_array(
    jsonb_build_object('id', '21942000-0000-0000-0000-000000000011', 'user_id', org, 'display_name', 'Amit Sud', 'tee_name', 'Blue', 'course_handicap', 18),
    jsonb_build_object('id', '21942000-0000-0000-0000-000000000012', 'user_id', raj, 'display_name', 'Raj Mehta', 'tee_name', 'Blue', 'course_handicap', 4),
    jsonb_build_object('id', '21942000-0000-0000-0000-000000000013', 'user_id', sam, 'display_name', 'Sam Lee', 'tee_name', 'White', 'course_handicap', 22),
    jsonb_build_object('id', '21942000-0000-0000-0000-000000000014', 'user_id', vik, 'display_name', 'Vikram Rao', 'tee_name', 'Blue', 'course_handicap', 11));
  execute 'set local role authenticated';
  g := public.create_game_complete(
    jsonb_build_object('id', '21941000-0000-0000-0000-000000000002', 'code', '219402', 'name', 'Four-Ball', 'course', 'Test Course', 'holes_meta', holes,
                       'game_type', 'fourball', 'group_id', club, 'teams', four_teams, 'foursomes', '[]'::jsonb, 'allowance_pct', 85),
    pl,
    jsonb_build_array(jsonb_build_object('player', '21942000-0000-0000-0000-000000000011', 'team', 'A'), jsonb_build_object('player', '21942000-0000-0000-0000-000000000012', 'team', 'A'),
                      jsonb_build_object('player', '21942000-0000-0000-0000-000000000013', 'team', 'B'), jsonb_build_object('player', '21942000-0000-0000-0000-000000000014', 'team', 'B')),
    (select jsonb_agg(jsonb_build_object('player', e->>'id', 'group', 1)) from jsonb_array_elements(pl) e),
    jsonb_build_array(jsonb_build_object('id', 'g1', 'name', 'Group 1', 'a', jsonb_build_array(org, raj), 'b', jsonb_build_array(sam, vik))), true);
  execute 'reset role';
  if (select count(*) from notifications where link = '/?game=219402') is distinct from 4 then raise exception 'one step: expected one notification per member'; end if;
  select detail into d from notifications where user_id = org and link = '/?game=219402';
  if d is null or d not like '% · you play the Blue tees (CH 18) · Reds, with Raj Mehta, v Sam Lee & Vikram Rao · Group 1' then raise exception 'four-ball wording: %', d; end if;
  select detail into d from notifications where user_id = sam and link = '/?game=219402';
  if d is null or d not like '% · Blues, with Vikram Rao, v Amit Sud & Raj Mehta · Group 1' then raise exception 'four-ball wording (Blues): %', d; end if;
  if (select players_notified_at from games where id = g) is null then raise exception 'one step: the game should be marked announced'; end if;

  -- the other formats' wording (setup lines straight from the helper)
  update games set foursomes = null, teams = four_teams, pairings = jsonb_build_array(jsonb_build_object('a', org, 'b', sam), jsonb_build_object('a', raj, 'b', vik)), game_type = 'match' where id = g;
  if public.game_setup_line(g, '21942000-0000-0000-0000-000000000011') is distinct from 'Reds, v Sam Lee · Group 1' then raise exception 'match wording: %', public.game_setup_line(g, '21942000-0000-0000-0000-000000000011'); end if;
  update games set teams = null where id = g;
  if public.game_setup_line(g, '21942000-0000-0000-0000-000000000012') is distinct from 'v Vikram Rao · Group 1' then raise exception 'singles wording: %', public.game_setup_line(g, '21942000-0000-0000-0000-000000000012'); end if;
  update games set pairings = '[]', game_type = 'scramble', scramble_mode = 'field', foursomes = jsonb_build_array(jsonb_build_object('id', 't2', 'name', 'Team 2', 'a', jsonb_build_array(sam, vik), 'b', '[]'::jsonb)) where id = g;
  if public.game_setup_line(g, '21942000-0000-0000-0000-000000000013') is distinct from 'Team 2 with Vikram Rao · Group 1' then raise exception 'scramble wording: %', public.game_setup_line(g, '21942000-0000-0000-0000-000000000013'); end if;
  update games set foursomes = null, game_type = 'stableford' where id = g;
  if public.game_setup_line(g, '21942000-0000-0000-0000-000000000011') is distinct from 'Group 1 with Raj, Sam and Vikram' then raise exception 'stableford wording: %', public.game_setup_line(g, '21942000-0000-0000-0000-000000000011'); end if;

  -- 3. FINISH LATER: nobody is told — not even a player added afterwards — until the announcement; then once each
  execute 'set local role authenticated';
  g := public.create_game_complete(
    jsonb_build_object('id', '21941000-0000-0000-0000-000000000003', 'code', '219403', 'name', 'Later', 'course', 'Test Course', 'holes_meta', holes, 'game_type', 'stableford', 'group_id', club),
    jsonb_build_array(jsonb_build_object('id', '21942000-0000-0000-0000-000000000021', 'user_id', org, 'display_name', 'Amit Sud'),
                      jsonb_build_object('id', '21942000-0000-0000-0000-000000000022', 'user_id', raj, 'display_name', 'Raj Mehta')), '[]', '[]', null, false);
  insert into public.game_players(id, game_id, user_id, display_name) values ('21942000-0000-0000-0000-000000000023', g, sam, 'Sam Lee');
  execute 'reset role';
  if (select count(*) from notifications where link = '/?game=219403') is distinct from 0 then raise exception 'finish later: someone was told early'; end if;
  if (select players_notified_at from games where id = g) is not null then raise exception 'finish later: the game should be NOT YET announced'; end if;
  execute 'set local role authenticated';
  n := public.announce_game_players(g);
  if n is distinct from 3 then raise exception 'announce: expected 3 members told (incl. the late one), got %', n; end if;
  if public.announce_game_players(g) is distinct from 0 then raise exception 'announce twice: must not repeat'; end if;
  execute 'reset role';
  if (select count(*) from notifications where link = '/?game=219403') is distinct from 3 then raise exception 'announce: expected exactly 3 notifications'; end if;

  -- 4. ALL OR NOTHING: an unknown team key fails the whole call — no game, no players, no notifications
  execute 'set local role authenticated';
  begin
    perform public.create_game_complete(
      jsonb_build_object('id', '21941000-0000-0000-0000-000000000004', 'code', '219404', 'name', 'Broken', 'course', 'Test Course', 'holes_meta', holes, 'game_type', 'fourball', 'group_id', club, 'teams', four_teams),
      jsonb_build_array(jsonb_build_object('id', '21942000-0000-0000-0000-000000000031', 'user_id', raj, 'display_name', 'Raj Mehta')),
      jsonb_build_array(jsonb_build_object('player', '21942000-0000-0000-0000-000000000031', 'team', 'Z')), '[]', null, true);
    ok := false;
  exception when others then ok := sqlerrm like '%unknown team%';
  end;
  execute 'reset role';
  if not ok then raise exception 'all or nothing: a bad line-up should be refused'; end if;
  if exists (select 1 from games where id = '21941000-0000-0000-0000-000000000004') or exists (select 1 from game_players where id = '21942000-0000-0000-0000-000000000031')
     or exists (select 1 from notifications where link = '/?game=219404') then raise exception 'all or nothing: something was left behind'; end if;
  -- a typo in a field name is refused, never silently dropped
  execute 'set local role authenticated';
  begin perform public.create_game_complete(jsonb_build_object('code', '219405', 'nmae', 'x', 'group_id', club), '[]'::jsonb); ok := false;
  exception when others then ok := sqlerrm like '%unknown fields: nmae%'; end;
  execute 'reset role';
  if not ok then raise exception 'a misspelt field must be refused'; end if;

  -- 5. PERMISSIONS
  if has_function_privilege('anon', 'public.create_game_complete(jsonb,jsonb,jsonb,jsonb,jsonb,boolean)', 'execute') then raise exception 'anon can create games'; end if;
  if has_function_privilege('anon', 'public.announce_game_players(uuid)', 'execute') then raise exception 'anon can announce'; end if;
  if has_function_privilege('authenticated', 'public.game_setup_line(uuid,uuid)', 'execute') or has_function_privilege('authenticated', 'public.game_added_note(uuid,uuid)', 'execute') then
    raise exception 'internal helpers are callable by members'; end if;
  perform set_config('request.jwt.claim.sub', '21940000-0000-0000-0000-0000000000b9', true);
  perform set_config('request.jwt.claims', '{"sub":"21940000-0000-0000-0000-0000000000b9","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.create_game_complete(jsonb_build_object('code', '219406', 'name', 'Intruder', 'course', 'C', 'holes_meta', holes, 'game_type', 'stableford', 'group_id', club), '[]'::jsonb); ok := false;
  exception when others then ok := true; end;
  if not ok then raise exception 'a non-member created a game in the club'; end if;
  begin perform public.announce_game_players('21941000-0000-0000-0000-000000000002'); ok := false;
  exception when others then ok := sqlerrm like '%only the organizer%'; end;
  execute 'reset role';
  if not ok then raise exception 'a stranger announced someone else''s game'; end if;

  raise notice 'CREATE_GAME_ANNOUNCE_PASS old Create unchanged; one step tells each member once with their setup (four-ball, match, singles, scramble, stableford); finish later tells no one until announced, then once; all or nothing; permissions hold';
end $$;
rollback;
