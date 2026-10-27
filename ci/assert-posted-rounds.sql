-- assert-posted-rounds.sql — 0228 (212.57): a round posted from a game can't be changed or deleted directly by its player
-- (only soft-deleted or given an analysis); personal rounds are theirs; club admins keep Manage's editing; server paths unaffected.
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
declare org uuid := '22300000-0000-0000-0000-0000000000a0'; pl uuid := '22300000-0000-0000-0000-0000000000a1'; cadm uuid := '22300000-0000-0000-0000-0000000000a2';
  g uuid := '22301000-0000-0000-0000-000000000001'; orow uuid := '22302000-0000-0000-0000-000000000001'; prow uuid := '22302000-0000-0000-0000-000000000002';
  holes jsonb := (select jsonb_agg(jsonb_build_object('n', i, 'par', 4, 'si', i)) from generate_series(1, 18) i);
  posted uuid; personal uuid; hole uuid; got boolean; bad text := ''; c record; before int;
begin
  perform pg_temp.as_user(org);
  perform public.create_game_complete(jsonb_build_object('id', g, 'code', '228001', 'name', 'G', 'course', 'C', 'holes_meta', holes, 'course_par', 72, 'game_type', 'stableford', 'group_id', '22300000-0000-0000-0000-00000000c1b0'),
    jsonb_build_array(jsonb_build_object('id', orow, 'user_id', org, 'display_name', 'Org'), jsonb_build_object('id', prow, 'user_id', pl, 'display_name', 'Player')), '[]', '[]', null, true);
  perform pg_temp.as_maintenance();
  update public.game_players set scores = (select jsonb_agg(5) from generate_series(1, 18)) where game_id = g;
  perform pg_temp.as_user(org);
  perform public.finish_game_and_post_rounds(g);   -- the server posts a round for each player (a definer path)
  perform pg_temp.as_maintenance();
  select id into posted from public.rounds where game_id = g and user_id = pl;
  if posted is null then raise exception 'no round was posted for the player'; end if;
  select id into hole from public.holes where round_id = posted order by hole_number limit 1;
  if hole is null then raise exception 'the posted round has no holes'; end if;
  -- a personal round the player logged themselves
  perform pg_temp.as_user(pl);
  insert into public.rounds(user_id, group_id, course, course_par, played_at, gross_score) values (pl, '22300000-0000-0000-0000-00000000c1b0', 'C', 72, current_date, 90) returning id into personal;
  perform pg_temp.as_maintenance();

  for c in select * from (values
    ('player changes the posted round''s total',        pl,   format('update public.rounds set gross_score = 70 where id = %L', posted),                        false),
    ('player changes the posted round''s handicap',     pl,   format('update public.rounds set course_handicap = 30 where id = %L', posted),                    false),
    ('player changes the posted round''s date',         pl,   format('update public.rounds set played_at = ''2020-01-01'' where id = %L', posted),              false),
    ('player soft-deletes the posted round',            pl,   format('update public.rounds set deleted_at = now() where id = %L', posted),                     true),
    ('player saves an analysis on the posted round',    pl,   format('update public.rounds set ai_analysis = ''nice'' where id = %L', posted),                 true),
    ('player deletes the posted round',                 pl,   format('delete from public.rounds where id = %L', posted),                                        false),
    ('player changes a posted hole score',              pl,   format('update public.holes set strokes = 2 where id = %L', hole),                               false),
    ('player adds a hole to the posted round',          pl,   format('insert into public.holes(round_id, hole_number, par, stroke_index, strokes) values (%L, 19, 4, 19, 3)', posted), false),
    ('player deletes a posted hole',                    pl,   format('delete from public.holes where id = %L', hole),                                           false),
    ('player changes their personal round''s total',    pl,   format('update public.rounds set gross_score = 88 where id = %L', personal),                     true),
    ('player deletes their personal round',             pl,   format('delete from public.rounds where id = %L', personal),                                      true),
    ('club admin edits the member''s posted round',     cadm, format('update public.rounds set course_handicap = 12, course_handicap_source = ''manual'' where id = %L', posted), true),
    ('club admin edits a posted hole',                  cadm, format('update public.holes set strokes = 4 where id = %L', hole),                               false)   -- Manage edits a round's handicap, not its holes
  ) as t(what, actor, q, want) loop
    perform pg_temp.as_user(c.actor);
    got := pg_temp.allowed(format('do $y$ declare n int; begin %s; get diagnostics n = row_count; if n = 0 then raise exception ''no row''; end if; end $y$', c.q));
    perform pg_temp.as_maintenance();
    if got is distinct from c.want then bad := bad || format(E'\n  %s was %s (expected %s)', c.what, case when got then 'ALLOWED' else 'refused' end, case when c.want then 'allowed' else 'refused' end); end if;
  end loop;
  if bad is distinct from '' then raise exception 'POSTED ROUNDS mismatch:%', bad; end if;

  -- the server path still works: the organizer corrects a score (0225) and re-posts; the player's round updates
  before := (select gross_score from public.rounds where id = posted);
  perform pg_temp.as_user(org);
  perform public.save_game_score_bundle(prow, (select scoring_version from public.games where id = g), (select jsonb_build_object('scores', jsonb_agg(4)) from generate_series(1, 18)), false);
  perform public.repost_game_rounds(g);
  perform pg_temp.as_maintenance();
  if (select gross_score from public.rounds where id = posted) is not distinct from before or (select gross_score from public.rounds where id = posted) <> 72 then
    raise exception 're-posting did not update the player''s round (% → %)', before, (select gross_score from public.rounds where id = posted);
  end if;
  raise notice 'POSTED_ROUNDS_PASS a posted round: its player can only soft-delete it or save an analysis (no totals, handicap, date, holes, or delete); personal rounds are theirs; club admins edit; the organizer''s correction + re-post updates it';
end $$;
rollback;
