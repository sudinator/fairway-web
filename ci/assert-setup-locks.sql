-- assert-setup-locks.sql — 0222 (212.49): the server refuses every setup change the app's rules refuse (rules 1–11),
-- and scores that arrive after a game has ended (BN164). What stays allowed is checked too.
begin;
insert into auth.users(id, email) values
 ('22200000-0000-0000-0000-0000000000a0', 'o@l.test'), ('22200000-0000-0000-0000-0000000000a1', 'p1@l.test'),
 ('22200000-0000-0000-0000-0000000000a2', 'p2@l.test'), ('22200000-0000-0000-0000-0000000000a3', 'p3@l.test'),
 ('22200000-0000-0000-0000-0000000000a4', 'p4@l.test');
insert into public.profiles(id, display_name, account_status) select id, 'P' || right(id::text, 1), 'active' from auth.users where email like '%@l.test';
insert into public.groups(id, name, created_by) values ('22200000-0000-0000-0000-00000000c1b0', 'Lock Club', '22200000-0000-0000-0000-0000000000a0');
insert into public.group_members(group_id, user_id, email, role, status)
select '22200000-0000-0000-0000-00000000c1b0', id, email, 'member', 'active' from auth.users where email like '%@l.test';
insert into public.scoring_devices(user_id, token) values ('22200000-0000-0000-0000-0000000000a0', '22209999-0000-0000-0000-000000000001'),
  ('22200000-0000-0000-0000-0000000000a1', '22209999-0000-0000-0000-000000000002');
create or replace function pg_temp.as_p1() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '22200000-0000-0000-0000-0000000000a1', true);
  perform set_config('request.jwt.claims', '{"sub":"22200000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  perform set_config('request.headers', '{"x-bnn-scoring-device":"22209999-0000-0000-0000-000000000002"}', true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.as_org() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '22200000-0000-0000-0000-0000000000a0', true);
  perform set_config('request.jwt.claims', '{"sub":"22200000-0000-0000-0000-0000000000a0","role":"authenticated"}', true);
  perform set_config('request.headers', '{"x-bnn-scoring-device":"22209999-0000-0000-0000-000000000001"}', true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.as_maintenance() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '', true); perform set_config('request.headers', '', true);
end $$;
-- run as the organizer: did the server refuse it (with the expected words)?
create or replace function pg_temp.refused(q text, words text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlerrm ilike '%' || words || '%'; end $$;
create or replace function pg_temp.refused_code(q text, code text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate = code; end $$;

do $$
declare
  o uuid := '22200000-0000-0000-0000-0000000000a0'; u1 uuid := '22200000-0000-0000-0000-0000000000a1'; u2 uuid := '22200000-0000-0000-0000-0000000000a2'; u3 uuid := '22200000-0000-0000-0000-0000000000a3';
  fb uuid := '22201000-0000-0000-0000-000000000001'; sf uuid := '22201000-0000-0000-0000-000000000002'; sc uuid := '22201000-0000-0000-0000-000000000003';
  holes jsonb := (select jsonb_agg(jsonb_build_object('n', i, 'par', 4, 'si', i)) from generate_series(1, 18) i);
  four jsonb := '[{"id":"g1","name":"Group 1","a":["22200000-0000-0000-0000-0000000000a0","22200000-0000-0000-0000-0000000000a1"],"b":["22200000-0000-0000-0000-0000000000a2","22200000-0000-0000-0000-0000000000a3"]}]';
  pl jsonb := jsonb_build_array(
    jsonb_build_object('id', '22202000-0000-0000-0000-000000000001', 'user_id', o, 'display_name', 'Org'), jsonb_build_object('id', '22202000-0000-0000-0000-000000000002', 'user_id', u1, 'display_name', 'P1'),
    jsonb_build_object('id', '22202000-0000-0000-0000-000000000003', 'user_id', u2, 'display_name', 'P2'), jsonb_build_object('id', '22202000-0000-0000-0000-000000000004', 'user_id', u3, 'display_name', 'P3'));
begin
  -- a FOUR-BALL (teams + a 2 v 2 foursome) and a STABLEFORD, created as the organizer
  perform pg_temp.as_org();
  perform public.create_game_complete(jsonb_build_object('id', fb, 'code', '222001', 'name', 'FB', 'course', 'C', 'holes_meta', holes, 'course_par', 72, 'game_type', 'fourball', 'group_id', '22200000-0000-0000-0000-00000000c1b0',
      'teams', '[{"key":"A","name":"Reds"},{"key":"B","name":"Blues"}]'::jsonb), pl,
    jsonb_build_array(jsonb_build_object('player', '22202000-0000-0000-0000-000000000001', 'team', 'A'), jsonb_build_object('player', '22202000-0000-0000-0000-000000000002', 'team', 'A'),
                      jsonb_build_object('player', '22202000-0000-0000-0000-000000000003', 'team', 'B'), jsonb_build_object('player', '22202000-0000-0000-0000-000000000004', 'team', 'B')),
    (select jsonb_agg(jsonb_build_object('player', e->>'id', 'group', 1)) from jsonb_array_elements(pl) e), four, true);
  perform public.create_game_complete(jsonb_build_object('id', sf, 'code', '222002', 'name', 'SF', 'course', 'C', 'holes_meta', holes, 'course_par', 72, 'game_type', 'stableford', 'group_id', '22200000-0000-0000-0000-00000000c1b0'),
    (select jsonb_agg(jsonb_set(e, '{id}', to_jsonb(replace(e->>'id', '22202000', '22203000')))) from jsonb_array_elements(pl) e), '[]', '[]', null, true);
  perform public.create_game_complete(jsonb_build_object('id', sc, 'code', '222003', 'name', 'SC', 'course', 'C', 'holes_meta', holes, 'course_par', 72, 'game_type', 'scramble', 'scramble_mode', 'field', 'group_id', '22200000-0000-0000-0000-00000000c1b0'),
    (select jsonb_agg(jsonb_set(e, '{id}', to_jsonb(replace(e->>'id', '22202000', '22204000')))) from jsonb_array_elements(pl) e), '[]', '[]',
    '[{"id":"t1","name":"Team 1","a":["22200000-0000-0000-0000-0000000000a0","22200000-0000-0000-0000-0000000000a1"],"b":[]},{"id":"t2","name":"Team 2","a":["22200000-0000-0000-0000-0000000000a2","22200000-0000-0000-0000-0000000000a3"],"b":[]}]'::jsonb, true);
  -- BEFORE scores everything can change (then put it back)
  update public.games set course = 'C2', allowance_pct = 90 where id = fb;
  update public.games set course = 'C', allowance_pct = 100 where id = fb;

  -- P1 scores in both games (as the app's scoring would)
  perform pg_temp.as_maintenance();
  update public.game_players set scores = '[4]'::jsonb where id in ('22202000-0000-0000-0000-000000000002', '22203000-0000-0000-0000-000000000002');
  perform pg_temp.as_org();
  -- 2, 3
  if not pg_temp.refused(format('update public.games set course = %L where id = %L', 'Other', fb), 'locked once scoring begins') then raise exception 'rule 2: course changed after scoring'; end if;
  if not pg_temp.refused(format('update public.games set holes_meta = %L::jsonb where id = %L', (select jsonb_agg(jsonb_build_object('n', i, 'par', 4, 'si', i)) from generate_series(1, 9) i), fb), 'locked once scoring begins') then raise exception 'rule 3: holes changed after scoring'; end if;
  -- 4: team ↔ individual refused; within the family allowed
  if not pg_temp.refused(format('update public.games set game_type = %L where id = %L', 'stableford', fb), 'switch between team and individual') then raise exception 'rule 4: four-ball became Stableford after scoring'; end if;
  update public.games set game_type = 'trifecta' where id = fb;
  update public.games set game_type = 'fourball' where id = fb;
  update public.games set game_type = 'stroke' where id = sf;
  update public.games set game_type = 'stableford' where id = sf;
  -- 5, 6: the team structure is locked — names and colours are not
  if not pg_temp.refused(format('update public.games set teams = null where id = %L', fb), 'team structure is locked') then raise exception 'rule 5/6: teams removed after scoring'; end if;
  update public.games set teams = '[{"key":"A","name":"Crimson","color":"red"},{"key":"B","name":"Navy"}]'::jsonb where id = fb;
  -- 7, 8: matchups and foursomes frozen (incl. first drivers / trifecta singles) — a foursome's display name is not
  if not pg_temp.refused(format('update public.games set pairings = %L::jsonb where id = %L', '[{"a":"22200000-0000-0000-0000-0000000000a0","b":"22200000-0000-0000-0000-0000000000a2"}]', fb), 'Matchups are frozen') then raise exception 'rule 7: matchups changed after scoring'; end if;
  if not pg_temp.refused(format('update public.games set foursomes = jsonb_set(foursomes, %L, %L) where id = %L', '{0,a_first}', '"22200000-0000-0000-0000-0000000000a1"', fb), 'Foursomes are frozen') then raise exception 'rule 8: foursomes changed after scoring'; end if;
  update public.games set foursomes = jsonb_set(foursomes, '{0,name}', '"Match 1"') where id = fb;
  -- 9: no player added to a team format; an individual format may add one (the app confirms it)
  if not pg_temp.refused(format('insert into public.game_players(game_id, display_name) values (%L, %L)', fb, 'Late'), 'after scoring starts in a match or team') then raise exception 'rule 9: a player joined a four-ball after scoring'; end if;
  insert into public.game_players(game_id, display_name, is_guest) values (sf, 'Late Guest', true);
  -- 10: a player with scores can't be removed; one without can
  if not pg_temp.refused(format('delete from public.game_players where id = %L', '22203000-0000-0000-0000-000000000002'), 'Mark them No-show') then raise exception 'rule 10: a scored player was removed'; end if;
  delete from public.game_players where game_id = sf and display_name = 'Late Guest';
  -- 11: a scored player's team can't change directly
  if not pg_temp.refused(format('update public.game_players set team = %L where id = %L', 'B', '22202000-0000-0000-0000-000000000002'), 'Team membership is frozen') then raise exception 'rule 11: a scored player changed team'; end if;
  -- confirm-level changes stay allowed after scoring: allowance, handicap, no-show
  update public.games set allowance_pct = 85 where id = fb;
  update public.game_players set handicap_index = 9.9, no_show = false where id = '22202000-0000-0000-0000-000000000003';

  -- 1: the game ENDS
  perform public.save_scramble_score_fenced(sc, (select scoring_version from public.games where id = sc), 't1', 'a', 0, 4, null);   -- the scramble's team scoring has started (the app's route)
  perform pg_temp.as_maintenance(); update public.games set status = 'ended' where id in (fb, sf, sc); perform pg_temp.as_org();
  if not pg_temp.refused(format('update public.games set allowance_pct = 100 where id = %L', fb), 'has ended') then raise exception 'rule 1: a setting changed on an ended game'; end if;
  if not pg_temp.refused(format('update public.game_players set handicap_index = 1 where id = %L', '22202000-0000-0000-0000-000000000003'), 'has ended') then raise exception 'rule 1: a handicap changed on an ended game'; end if;
  if not pg_temp.refused(format('insert into public.game_players(game_id, display_name, is_guest) values (%L, %L, true)', sf, 'After'), 'has ended') then raise exception 'rule 1: a player added to an ended game'; end if;
  if not pg_temp.refused(format('delete from public.game_players where id = %L', '22203000-0000-0000-0000-000000000004'), 'has ended') then raise exception 'rule 1: a player removed from an ended game'; end if;
  -- the name, date, team names stay editable
  update public.games set name = 'FB renamed', teams = '[{"key":"A","name":"Reds"},{"key":"B","name":"Blues"}]'::jsonb where id = fb;
  -- LATE SCORES from a PLAYER's phone (offline when the organizer ended the game) are refused with BN164 — on their own
  -- card (sent the way the phone sends it) and on their scramble team's score
  perform pg_temp.as_p1();
  if not pg_temp.refused_code(format('select public.save_game_score_bundle(%L::uuid, %s, %L::jsonb, false)', '22203000-0000-0000-0000-000000000002', (select scoring_version from public.games where id = sf), '{"scores":[4,5]}'), 'BN164') then raise exception 'a player''s late score was accepted on an ended game'; end if;
  if not pg_temp.refused_code(format('select public.save_scramble_score_fenced(%L::uuid, %s, %L, %L, 1, 3, null)', sc, (select scoring_version from public.games where id = sc), 't1', 'a'), 'BN164') then raise exception 'a player''s late team score was accepted on an ended scramble'; end if;
  perform pg_temp.as_org();
  -- 0225 (owner, Oct 27): the ORGANIZER corrects an ended game's scores — any card, any team — without reopening; noted
  -- for the re-post; setup on the ended game stays locked (checked above)
  perform public.save_game_score_bundle('22203000-0000-0000-0000-000000000002'::uuid, (select scoring_version from public.games where id = sf), '{"scores":[3]}'::jsonb, false);
  perform public.save_game_score_bundle('22203000-0000-0000-0000-000000000003'::uuid, (select scoring_version from public.games where id = sf), '{"scores":[6],"putts":[2]}'::jsonb, false);
  perform public.save_scramble_score_fenced(sc, (select scoring_version from public.games where id = sc), 't1', 'a', 1, 3, null);
  perform pg_temp.as_maintenance();
  if (select scores from public.game_players where id = '22203000-0000-0000-0000-000000000002') <> '[3]'::jsonb then raise exception 'the organizer''s correction did not save'; end if;
  if (select scores_corrected_at from public.games where id = sf) is null or (select scores_corrected_at from public.games where id = sc) is null then raise exception 'a correction was not noted for the re-post'; end if;
  if not exists (select 1 from public.score_audit where game_player_id = '22203000-0000-0000-0000-000000000002' and changed_by = '22200000-0000-0000-0000-0000000000a0') then raise exception 'the correction was not logged'; end if;
  -- the re-post: the organizer only, and it records when
  perform pg_temp.as_p1();
  if not pg_temp.refused(format('select public.repost_game_rounds(%L::uuid)', sf), 'only the organizer') then raise exception 'a player re-posted the rounds'; end if;
  perform pg_temp.as_org();
  perform public.repost_game_rounds(sf);
  perform pg_temp.as_maintenance();
  if (select rounds_reposted_at from public.games where id = sf) is null or (select rounds_reposted_at < scores_corrected_at from public.games where id = sf) then raise exception 'the re-post was not recorded after the correction'; end if;
  perform pg_temp.as_org();
  -- the organizer resets the scores: clearing is allowed, and the game reopens
  perform public.reset_game_scores(fb);
  if (select status from public.games where id = fb) = 'ended' then raise exception 'reset did not reopen the game'; end if;
  -- deleting a whole game (every player) is still possible, scores and all
  perform pg_temp.as_maintenance(); update public.game_players set scores = '[4]'::jsonb where id = '22202000-0000-0000-0000-000000000002'; perform pg_temp.as_org();
  delete from public.game_players where game_id = fb;
  -- maintenance work is unaffected
  perform pg_temp.as_maintenance();
  update public.games set allowance_pct = 50 where id = sf;
  raise notice 'SETUP_LOCKS_PASS rules 1–11 refused at the server; confirm-level changes, team names, within-family formats, resets and whole-game deletes allowed; a player''s late scores refused (BN164); the organizer corrects an ended game, logged, re-posted on request';
end $$;
rollback;
