-- assert-score-owner.sql — 0227 (212.56): WHO may change a player's score, at the server, matches the app — the row's owner only
-- (organizer's hold → group scorer → whole-game scorer → own card); everyone may enter their OWN stats; guests by their group.
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
  g uuid := '22301000-0000-0000-0000-000000000001';
  orow uuid := '22302000-0000-0000-0000-000000000001'; prow uuid := '22302000-0000-0000-0000-000000000002'; mrow uuid := '22302000-0000-0000-0000-000000000003';
  guest2 uuid := '22302000-0000-0000-0000-000000000004'; guest1 uuid := '22302000-0000-0000-0000-000000000005';
  holes jsonb := (select jsonb_agg(jsonb_build_object('n', i, 'par', 4, 'si', i)) from generate_series(1, 18) i);
  v int; got boolean; bad text := ''; c record; phase text;
begin
  perform pg_temp.as_user(org);
  perform public.create_game_complete(jsonb_build_object('id', g, 'code', '227001', 'name', 'G', 'course', 'C', 'holes_meta', holes, 'course_par', 72, 'game_type', 'fourball', 'group_id', '22300000-0000-0000-0000-00000000c1b0',
      'teams', '[{"key":"A","name":"Reds"},{"key":"B","name":"Blues"}]'::jsonb),
    jsonb_build_array(jsonb_build_object('id', orow, 'user_id', org, 'display_name', 'Org'), jsonb_build_object('id', prow, 'user_id', pl, 'display_name', 'Player'), jsonb_build_object('id', mrow, 'user_id', mem, 'display_name', 'Member')),
    jsonb_build_array(jsonb_build_object('player', orow, 'team', 'A'), jsonb_build_object('player', prow, 'team', 'B'), jsonb_build_object('player', mrow, 'team', 'B')),
    jsonb_build_array(jsonb_build_object('player', orow, 'group', 1), jsonb_build_object('player', prow, 'group', 2), jsonb_build_object('player', mrow, 'group', 2)), null, true);
  perform pg_temp.as_maintenance();
  insert into public.game_players(id, game_id, display_name, is_guest, tee_group, team) values (guest2, g, 'Guest Two', true, 2, 'A'), (guest1, g, 'Guest One', true, 1, 'B');
  v := (select scoring_version from public.games where id = g);

  -- each case: (phase, what, actor, row, stats-only?, patch, expected). Phases set up who keeps score:
  --   A  the MEMBER keeps score for group 2; group 1 (the organizer's) has no scorer; no whole-game scorer
  --   B  the ORGANIZER has taken over group 2
  --   C  the PLAYER keeps score for the whole game (no group scorers)
  --   D  nobody keeps score anywhere
  for c in select * from (values
    ('A', 'non-scorer saves own score',                 pl,  prow,   false, '{"scores":[4]}',                 false),
    ('A', 'non-scorer saves own stats (stats route)',   pl,  prow,   true,  '{"putts":[2],"fairways":[true]}', true),
    ('A', 'non-scorer saves own stats (full route)',    pl,  prow,   false, '{"putts":[2],"sand":[0]}',        true),
    ('A', 'group scorer saves the player''s score',     mem, prow,   false, '{"scores":[4]}',                 true),
    ('A', 'group scorer saves own score',               mem, mrow,   false, '{"scores":[5]}',                 true),
    ('A', 'non-scorer saves the group''s guest',        pl,  guest2, false, '{"scores":[6]}',                 false),
    ('A', 'group scorer saves the group''s guest',      mem, guest2, false, '{"scores":[6]}',                 true),
    ('A', 'organizer saves a score another scorer owns', org, prow,  false, '{"scores":[3]}',                 false),
    ('A', 'organizer saves own score (no scorer)',      org, orow,   false, '{"scores":[4]}',                 true),
    ('A', 'player saves the organizer''s score',        pl,  orow,   false, '{"scores":[9]}',                 false),
    ('A', 'organizer saves own group''s guest',         org, guest1, false, '{"scores":[5]}',                 true),
    ('A', 'scorer of another group saves that guest',   mem, guest1, false, '{"scores":[5]}',                 false),
    ('B', 'organizer saves a score in the held group',  org, prow,   false, '{"scores":[3]}',                 true),
    ('B', 'old scorer saves a score in the held group', mem, prow,   false, '{"scores":[4]}',                 false),
    ('B', 'old scorer saves own stats',                 mem, mrow,   true,  '{"putts":[1]}',                  true),
    ('C', 'whole-game scorer saves the organizer''s score', pl, orow, false, '{"scores":[4]}',                true),
    ('C', 'organizer saves own score (someone keeps score)', org, orow, false, '{"scores":[4]}',             false),
    ('D', 'player saves own score',                     pl,  prow,   false, '{"scores":[4]}',                 true),
    ('D', 'player saves the guest in their group',      pl,  guest2, false, '{"scores":[6]}',                 true),
    ('D', 'player saves a guest in another group',      pl,  guest1, false, '{"scores":[6]}',                 false),
    ('D', 'player saves another member''s score',       pl,  mrow,   false, '{"scores":[4]}',                 false)
  ) as t(phase, what, actor, prow_id, stats_only, patch, want) order by phase loop
    if c.phase is distinct from phase then
      phase := c.phase; perform pg_temp.as_maintenance();
      update public.game_players set is_marker = false where game_id = g; update public.games set marker_user_id = null, organizer_scoring_groups = '{}' where id = g;
      if phase = 'A' then update public.game_players set is_marker = true where id = mrow;
      elsif phase = 'B' then update public.games set organizer_scoring_groups = '{2}' where id = g;
      elsif phase = 'C' then update public.games set marker_user_id = pl where id = g;
      end if;
    end if;
    perform pg_temp.as_user(c.actor);
    got := pg_temp.allowed(format('select public.save_game_score_bundle(%L::uuid, %s, %L::jsonb, %L)', c.prow_id, v, c.patch, c.stats_only));
    perform pg_temp.as_maintenance();
    if got is distinct from c.want then bad := bad || format(E'\n  %s: %s was %s (expected %s)', c.phase, c.what, case when got then 'ALLOWED' else 'refused' end, case when c.want then 'allowed' else 'refused' end); end if;
  end loop;
  if bad is distinct from '' then raise exception 'SCORE OWNER mismatch:%', bad; end if;
  raise notice 'SCORE_OWNER_PASS 21 attempts: a row''s score changes only through its owner (organizer''s hold, group scorer, whole-game scorer, own card; guests by their group); stats stay the player''s own';
end $$;
rollback;
