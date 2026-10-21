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
  raise notice 'SCRAMBLE_PASS team scores and drives saved through the fence; 3- and 4-player teams; foreign drives, other teams, one-player teams and non-scramble games refused';
end $$;
rollback;
