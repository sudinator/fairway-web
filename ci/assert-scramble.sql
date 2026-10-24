-- 0203 (211.0): scramble team scores — saved through the fence, with alternate shot's permission rules.
begin;
insert into auth.users(id, email) values
 ('20300000-0000-0000-0000-000000000001','a1@sc203.test'), ('20300000-0000-0000-0000-000000000002','a2@sc203.test'),
 ('20300000-0000-0000-0000-000000000003','a3@sc203.test'), ('20300000-0000-0000-0000-000000000004','b1@sc203.test'),
 ('20300000-0000-0000-0000-000000000005','b2@sc203.test'), ('20300000-0000-0000-0000-000000000006','b3@sc203.test'),
 ('20300000-0000-0000-0000-000000000007','b4@sc203.test');
insert into public.profiles(id, display_name, account_status) select id, email, 'active' from auth.users where email like '%@sc203.test';
insert into public.games(id, code, name, course, holes_meta, game_type, status, created_by, scramble_team_size, scramble_mode, scramble_handicap, foursomes) values
 ('20300000-0000-0000-0000-0000000000a1', '203203', 'Scramble', 'C', '[]', 'scramble', 'active', '20300000-0000-0000-0000-000000000001', 4, 'field', 'usga',
  '[{"id":"g1","name":"Group 1","a":["20300000-0000-0000-0000-000000000001","20300000-0000-0000-0000-000000000002","20300000-0000-0000-0000-000000000003"],"b":["20300000-0000-0000-0000-000000000004","20300000-0000-0000-0000-000000000005","20300000-0000-0000-0000-000000000006","20300000-0000-0000-0000-000000000007"]},{"id":"g2","name":"Solo","a":["20300000-0000-0000-0000-000000000001"],"b":[]}]'),
 ('20300000-0000-0000-0000-0000000000a2', '203204', 'Alt', 'C', '[]', 'alt_shot', 'active', '20300000-0000-0000-0000-000000000001', null, null, null,
  '[{"id":"g1","name":"G","a":["20300000-0000-0000-0000-000000000001","20300000-0000-0000-0000-000000000002"],"b":[]}]');
insert into public.game_players(game_id, user_id, display_name) select '20300000-0000-0000-0000-0000000000a1', id, email from auth.users where email like '%@sc203.test';
insert into public.game_players(game_id, user_id, display_name) values ('20300000-0000-0000-0000-0000000000a2', '20300000-0000-0000-0000-000000000001', 'a1');

do $$
declare gid uuid := '20300000-0000-0000-0000-0000000000a1'; a1 text := '20300000-0000-0000-0000-000000000001'; a2 text := '20300000-0000-0000-0000-000000000002';
        b1 text := '20300000-0000-0000-0000-000000000004'; b4 text := '20300000-0000-0000-0000-000000000007'; ok boolean;
begin
  -- a team member (team a, 3 players) saves a score and their drive
  perform set_config('request.jwt.claim.sub', a2, true);
  perform public.claim_scoring_device('20300000-0000-0000-0000-0000000000d2');
  perform set_config('request.headers', '{"x-bnn-scoring-device":"20300000-0000-0000-0000-0000000000d2"}', true);
  execute 'set local role authenticated';
  perform public.save_scramble_score_fenced(gid, 0, 'g1', 'a', 0, 4, a1);
  execute 'reset role';
  if (select strokes::text || '/' || drive_key from game_alt_shot_scores where game_id = gid and foursome_id = 'g1' and side = 'a' and hole_index = 0) is distinct from '4/' || a1 then
    raise exception 'the team score and drive were not saved';
  end if;
  -- the 4-player team (b) scores too
  perform set_config('request.jwt.claim.sub', b1, true);
  perform public.claim_scoring_device('20300000-0000-0000-0000-0000000000d4');
  perform set_config('request.headers', '{"x-bnn-scoring-device":"20300000-0000-0000-0000-0000000000d4"}', true);
  execute 'set local role authenticated';
  perform public.save_scramble_score_fenced(gid, 0, 'g1', 'b', 0, 3, b4);
  -- a drive by someone not on the team is refused
  begin perform public.save_scramble_score_fenced(gid, 0, 'g1', 'b', 1, 4, a1); ok := false; exception when others then ok := sqlerrm like '%isn''t on this team%'; end;
  if not ok then raise exception 'a drive by someone on the other team was accepted'; end if;
  -- a player on the other team can't score this team
  begin perform public.save_scramble_score_fenced(gid, 0, 'g1', 'a', 1, 4, null); ok := false; exception when others then ok := sqlerrm like '%not allowed to score this scramble team%'; end;
  if not ok then raise exception 'a player scored the other team'; end if;
  -- a 1-player "team" is refused
  begin perform public.save_scramble_score_fenced(gid, 0, 'g2', 'a', 0, 4, null); ok := false; exception when others then ok := sqlerrm like '%2 to 4 players%'; end;
  if not ok then raise exception 'a one-player scramble team was accepted'; end if;
  execute 'reset role';
  -- 0209: a one-player team is accepted when the game is set up for teammates outside the app
  update public.games set scramble_team_size = 1 where id = gid;
  perform set_config('request.jwt.claim.sub', a1, true);
  perform public.claim_scoring_device('20300000-0000-0000-0000-0000000000d1');
  perform set_config('request.headers', '{"x-bnn-scoring-device":"20300000-0000-0000-0000-0000000000d1"}', true);
  execute 'set local role authenticated';
  perform public.save_scramble_score_fenced(gid, 0, 'g2', 'a', 0, 5, null);
  execute 'reset role';
  if (select strokes from game_alt_shot_scores where game_id = gid and foursome_id = 'g2' and hole_index = 0) is distinct from 5 then raise exception 'a one-player team could not score in a teammates-outside-the-app game'; end if;
  update public.games set scramble_team_size = 4 where id = gid;
  -- 0210: the "agreed" handicap method is a valid setting; an unknown one isn't
  update public.games set scramble_handicap = 'agreed' where id = gid;
  begin update public.games set scramble_handicap = 'made-up' where id = gid; ok := false; exception when check_violation then ok := true; end;
  if not ok then raise exception 'an unknown scramble handicap method was accepted'; end if;
  update public.games set scramble_handicap = 'usga' where id = gid;
  update public.games set scramble_allowance = '{"4": [30, 20, 15, 10]}' where id = gid;
  begin update public.games set scramble_allowance = '[1,2]' where id = gid; ok := false; exception when check_violation then ok := true; end;
  if not ok then raise exception 'a malformed allowance was accepted'; end if;
  -- 0211: both public feeds carry the scramble settings
  if pg_get_functiondef('public.get_live_lineup(text)'::regprocedure) not like '%scramble_allowance%' or pg_get_functiondef('public.get_live_scorecard(text)'::regprocedure) not like '%scramble_team_size%' then
    raise exception 'the line-up or live feed lacks the scramble settings';
  end if;
  -- only scramble games (as that alternate-shot game's organizer, who passes the fence — so the format check decides)
  perform set_config('request.jwt.claim.sub', a1, true);
  perform public.claim_scoring_device('20300000-0000-0000-0000-0000000000d1');
  perform set_config('request.headers', '{"x-bnn-scoring-device":"20300000-0000-0000-0000-0000000000d1"}', true);
  execute 'set local role authenticated';
  begin perform public.save_scramble_score_fenced('20300000-0000-0000-0000-0000000000a2', 0, 'g1', 'a', 0, 4, null); ok := false; exception when others then ok := sqlerrm like '%only valid for a Scramble%'; end;
  execute 'reset role';
  if not ok then raise exception 'scramble scoring worked on an alternate-shot game'; end if;
  -- the inner function can't be called directly (only through the fence) — checked by privilege
  if has_function_privilege('authenticated', 'public.save_scramble_side_score(uuid,text,text,integer,integer,text)', 'execute') then raise exception 'app users can skip the fence'; end if;
  raise notice 'SCRAMBLE_PASS team scores and drives saved through the fence; 3- and 4-player teams; one-player teams only when set up that way; foreign drives, other teams, one-player teams and non-scramble games refused';
end $$;
-- 0212: a Ryder Cup scramble session — team v team, no team larger than the session's size
do $$
declare cg uuid := '20300000-0000-0000-0000-0000000000c9'; cp uuid := '20300000-0000-0000-0000-0000000000f9'; gm uuid := '20300000-0000-0000-0000-0000000000a9';
        o uuid := '20300000-0000-0000-0000-000000000001'; ok boolean;
begin
  insert into public.groups(id, name, status, created_by) values (cg, 'Cup Club 212', 'active', o);
  insert into public.competitions(id, group_id, name, start_date, created_by, team_a_name, team_b_name) values (cp, cg, 'Cup 212', current_date, o, 'Reds', 'Blues');
  insert into public.games(id, code, name, course, holes_meta, game_type, status, created_by, group_id, scramble_mode, scramble_team_size, teams, foursomes) values
    (gm, '212212', 'Cup scramble', 'C', '[]', 'scramble', 'active', o, cg, 'match', 2, '[{"key":"A","name":"Reds"},{"key":"B","name":"Blues"}]', '[]');
  insert into public.competition_sessions(competition_id, name, format, session_order, play_date, scramble_team_size, game_id) values (cp, 'Saturday scramble', 'scramble', 1, current_date, 2, gm);
  -- 2 v 2 is fine
  update public.games set foursomes = '[{"id":"m1","name":"Match 1","a":["x1","x2"],"b":["y1","y2"]}]' where id = gm;
  -- a team of 3 in a session of 2 is refused
  begin update public.games set foursomes = '[{"id":"m1","name":"Match 1","a":["x1","x2","x3"],"b":["y1","y2"]}]' where id = gm; ok := false;
  exception when others then ok := sqlerrm like '%2 players each%'; end;
  if not ok then raise exception 'a 3-player team was accepted in a Ryder Cup scramble session of 2'; end if;
  -- a Cup scramble is team v team
  begin update public.games set scramble_mode = 'field' where id = gm; ok := false; exception when others then ok := sqlerrm like '%team v team%'; end;
  if not ok then raise exception 'a Ryder Cup scramble was switched to one leaderboard'; end if;
  raise notice 'CUP_SCRAMBLE_PASS a Cup scramble session: 2 v 2 accepted; a team of 3 and leaderboard mode refused';
end $$;
-- 212.34 (owner, Oct 23): small teams share a tee group so ONE scorer keeps one card for every team in it. No migration:
-- 0203/0209 already let a tee group's marker score any team in their group. Proven here, both ways.
do $$
declare gx uuid := '20300000-0000-0000-0000-0000000000b7'; o text := '20300000-0000-0000-0000-000000000001';
        b1 text := '20300000-0000-0000-0000-000000000004'; b2 text := '20300000-0000-0000-0000-000000000005';
        b3 text := '20300000-0000-0000-0000-000000000006'; b4 text := '20300000-0000-0000-0000-000000000007'; ok boolean;
begin
  insert into public.games(id, code, name, course, holes_meta, game_type, status, created_by, scramble_team_size, scramble_mode, scramble_handicap, foursomes) values
   (gx, '212340', 'Scramble pairs', 'C', '[]', 'scramble', 'active', o::uuid, 2, 'field', 'usga',
    jsonb_build_array(jsonb_build_object('id','t1','name','Team 1','a',jsonb_build_array(b1,b2),'b','[]'::jsonb,'tee',1),
                      jsonb_build_object('id','t2','name','Team 2','a',jsonb_build_array(b3,b4),'b','[]'::jsonb,'tee',2)));
  insert into public.game_players(game_id, user_id, display_name, tee_group, is_marker) values
   (gx, b1::uuid, 'b1', 1, true), (gx, b2::uuid, 'b2', 1, false), (gx, b3::uuid, 'b3', 2, true), (gx, b4::uuid, 'b4', 2, false);
  perform set_config('request.jwt.claim.sub', b1, true);   -- b1's device from the 0203 block above (one primary device each)
  perform public.claim_scoring_device('20300000-0000-0000-0000-0000000000d4');
  perform set_config('request.headers', '{"x-bnn-scoring-device":"20300000-0000-0000-0000-0000000000d4"}', true);
  execute 'set local role authenticated';
  -- one team per group (how teams were grouped before 212.34): group 1's marker cannot score Team 2
  begin perform public.save_scramble_score_fenced(gx, 0, 't2', 'a', 0, 4, null); ok := false; exception when others then ok := sqlerrm like '%not allowed to score this scramble team%'; if not ok then raise exception 'unexpected refusal: %', sqlerrm; end if; end;
  if not ok then raise exception 'a marker scored a team in another group'; end if;
  execute 'reset role';
  -- the two teams now share group 1 (and group 2's marker steps down): group 1's marker scores BOTH teams
  update public.game_players set tee_group = 1, is_marker = false where game_id = gx and user_id in (b3::uuid, b4::uuid);
  execute 'set local role authenticated';
  perform public.save_scramble_score_fenced(gx, 0, 't1', 'a', 0, 4, null);
  perform public.save_scramble_score_fenced(gx, 0, 't2', 'a', 0, 5, null);
  execute 'reset role';
  if (select string_agg(foursome_id || '=' || strokes, ',' order by foursome_id) from game_alt_shot_scores where game_id = gx and hole_index = 0) is distinct from 't1=4,t2=5' then
    raise exception 'the group marker could not score both teams in the group';
  end if;
  -- someone in the group who isn't the marker still can't score the other team
  perform set_config('request.jwt.claim.sub', b2, true);
  perform public.claim_scoring_device('20300000-0000-0000-0000-0000000000e2');
  perform set_config('request.headers', '{"x-bnn-scoring-device":"20300000-0000-0000-0000-0000000000e2"}', true);
  execute 'set local role authenticated';
  begin perform public.save_scramble_score_fenced(gx, 0, 't2', 'a', 1, 4, null); ok := false; exception when others then ok := sqlerrm like '%not allowed to score this scramble team%'; end;
  execute 'reset role';
  if not ok then raise exception 'a non-marker scored the other team in their group'; end if;
  raise notice 'SCRAMBLE_SHARED_GROUP_PASS a group marker scores every team in the group; not a team in another group; a non-marker scores only their own team';
end $$;
rollback;
