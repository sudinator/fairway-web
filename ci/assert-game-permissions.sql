-- assert-game-permissions.sql — 0223 (212.52): WHO can do what to a game, at the server, matches the app (owner,
-- Oct 26: "Organizer + system admins only (match the app)"; "audit 'who can do what' and add it to the sync check").
-- Six people try each game action: the organizer (created it, playing), a player in the game, a club admin NOT in the
-- game, a club member not in it, an outsider, and a system admin. Every attempt is rolled back, so each starts clean.
-- A REGISTER at the end lists every game function signed-in members can call; a new one fails this test until it is
-- classified here (and tested), so permissions can't drift from the app unnoticed.
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
declare
  org uuid := '22300000-0000-0000-0000-0000000000a0'; pl uuid := '22300000-0000-0000-0000-0000000000a1';
  people uuid[] := array['22300000-0000-0000-0000-0000000000a0','22300000-0000-0000-0000-0000000000a1','22300000-0000-0000-0000-0000000000a2',
                         '22300000-0000-0000-0000-0000000000a3','22300000-0000-0000-0000-0000000000a4','22300000-0000-0000-0000-0000000000a5']::uuid[];
  names text[] := array['organizer', 'player', 'club admin (not in game)', 'club member (not in game)', 'outsider', 'system admin'];
  g uuid := '22301000-0000-0000-0000-000000000001'; d uuid := '22301000-0000-0000-0000-000000000002';
  prow uuid := '22302000-0000-0000-0000-000000000002';
  holes jsonb := (select jsonb_agg(jsonb_build_object('n', i, 'par', 4, 'si', i)) from generate_series(1, 18) i);
  -- action → the SQL, and who may do it: O = organizer only (system admins use their admin tools); OS = organizer or system admin
  act record; i int; got boolean; want boolean; bad text := '';
begin
  perform pg_temp.as_user(org);
  perform public.create_game_complete(jsonb_build_object('id', g, 'code', '223001', 'name', 'G', 'course', 'C', 'holes_meta', holes, 'course_par', 72, 'game_type', 'stableford', 'group_id', '22300000-0000-0000-0000-00000000c1b0'),
    jsonb_build_array(jsonb_build_object('id', '22302000-0000-0000-0000-000000000001', 'user_id', org, 'display_name', 'Org'), jsonb_build_object('id', prow, 'user_id', pl, 'display_name', 'Player')),
    '[]', '[]', null, true);
  perform public.create_game_complete(jsonb_build_object('id', d, 'code', '223002', 'name', 'D', 'course', 'C', 'holes_meta', holes, 'course_par', 72, 'game_type', 'stableford', 'group_id', '22300000-0000-0000-0000-00000000c1b0'),
    jsonb_build_array(jsonb_build_object('id', '22302000-0000-0000-0000-000000000011', 'user_id', org, 'display_name', 'Org'), jsonb_build_object('id', '22302000-0000-0000-0000-000000000012', 'user_id', pl, 'display_name', 'Player')),
    '[]', '[]', null, false);   -- a saved DRAFT
  perform pg_temp.as_maintenance();

  for act in select * from (values
    ('save the line-up',            'OS', format('select public.apply_game_structure(%L::uuid, ''[]''::jsonb, jsonb_build_array(jsonb_build_object(''player'', %L::text, ''group'', 2)), null)', g, prow)),
    ('save groups',                 'OS', format('select public.set_tee_groups(%L::uuid, jsonb_build_array(jsonb_build_object(''player'', %L::text, ''group'', 2)))', g, prow)),
    ('send a draft to its players', 'OS', format('select public.announce_game_players(%L::uuid)', d)),
    ('see a draft',                 'OS', format('do $x$ begin if not exists (select 1 from public.games where id = %L) then raise exception ''hidden''; end if; end $x$', d)),
    ('set a player''s bets',        'OS', format('select public.set_player_bets(%L::uuid, false)', prow)),
    ('create a side contest',       'OS', format('select public.create_game_contest(%L::uuid, ''ctp'', ''CTP'', ''{3}''::int[], ''ft_in'', ''low'')', g)),
    ('move a player''s group',      'O',  format('select public.set_tee_group(%L::uuid, 2::smallint)', prow)),
    ('share the links',             'O',  format('select public.set_game_share(%L::uuid, true)', g)),
    ('change the date',             'O',  format('select public.set_game_played_date(%L::uuid, ''2026-10-20''::date)', g)),
    ('change the course',           'O',  format('select public.change_game_course_before_scoring(%L::uuid, ''Other'', 72, %L::jsonb)', g, holes)),
    ('reset the scores',            'O',  format('select public.reset_game_scores(%L::uuid)', g)),
    ('end the game',                'O',  format('select public.finish_game_and_post_rounds(%L::uuid)', g)),
    ('delete the game',             'O',  format('select public.delete_game(%L::uuid, false)', g))
  ) as a(what, who, q) loop
    for i in 1 .. 6 loop
      perform pg_temp.as_user(people[i]);
      got := pg_temp.allowed(act.q);
      perform pg_temp.as_maintenance();
      want := i = 1 or (i = 6 and act.who = 'OS');
      if got is distinct from want then bad := bad || format(E'\n  %s: %s was %s (expected %s)', act.what, names[i], case when got then 'ALLOWED' else 'refused' end, case when want then 'allowed' else 'refused' end); end if;
    end loop;
  end loop;
  if bad is distinct from '' then raise exception 'WHO-CAN-DO-WHAT mismatch:%', bad; end if;

  -- THE REGISTER: every game function signed-in members can call is classified (and, if it changes setup, tested above)
  select string_agg(p.proname, ', ' order by p.proname) into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')
     and pg_get_function_identity_arguments(p.oid) ~* '(p_game|p_game_id|p_player|p_contest)\M'
     and p.proname not in (
       -- organizer (or system admin) — tested above
       'apply_game_structure', 'set_tee_groups', 'announce_game_players', 'set_player_bets', 'create_game_contest', 'set_tee_group',
       'set_game_share', 'set_game_played_date', 'change_game_course_before_scoring', 'reset_game_scores', 'finish_game_and_post_rounds',
       'delete_game', 'finish_game', 'change_game_match_length_before_scoring', 'delete_game_contest', 'update_game_contest',
       'link_tee_time_game', 'delete_competition_session_game', 'create_game_complete', 'post_game_rounds',
       -- system admin tools (is_admin inside)
       'admin_delete_game', 'admin_delete_stale_game', 'admin_end_game', 'admin_reassign_organizer', 'admin_reopen_game', 'admin_reset_game', 'admin_score_audit',
       -- scoring roles: a player's own card, a group's marker (covered by the scoring and recovery tests)
       'save_game_score_bundle', 'save_hole_scores', 'save_hole_stats', 'save_alt_shot_score_fenced', 'save_scramble_score_fenced', 'save_alt_shot_side_score',
       'begin_game_score_write', 'claim_group_marker', 'release_group_marker', 'set_group_marker', 'claim_marker', 'release_marker', 'join_group_to_marker',
       'set_my_scorer', 'disband_group_scoring', 'finish_tee_group', 'finish_tee_group_and_post', 'post_group_rounds', 'log_contest_entry', 'void_contest_entry',
       -- read-only answers
       'can_see_game', 'is_game_organizer', 'is_tee_group_marker', 'plays_with_guest', 'game_announced_or_mine', 'ensure_game_event',
       -- the club's Money tab (club admins manage money; not game setup)
       'save_bet_expense_atomic', 'delete_bet_expense_atomic');
  if bad is not null then raise exception 'UNCLASSIFIED game functions (decide who may call them, test it, and list them here): %', bad; end if;
  raise notice 'GAME_PERMISSIONS_PASS 13 actions x 6 people match the app (organizer; system admin for the six setup rules; a club admin not in the game can''t); every game function is classified';
end $$;
rollback;
