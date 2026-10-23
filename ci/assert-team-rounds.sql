-- 0213 (212.7): team rounds (scramble / alternate shot) count as played — Season Wrapped and the team-round email.
begin;
do $$
declare yr int := extract(year from now())::int;
        m1 uuid := '21300000-0000-0000-0000-000000000001'; m2 uuid := '21300000-0000-0000-0000-000000000002';
        m3 uuid := '21300000-0000-0000-0000-000000000003'; m4 uuid := '21300000-0000-0000-0000-000000000004';
        m5 uuid := '21300000-0000-0000-0000-000000000005';
        gs uuid := '21300000-0000-0000-0000-0000000000a1'; ga uuid := '21300000-0000-0000-0000-0000000000a2';
        n int; ok boolean;
begin
  insert into auth.users(id, email) select x, x::text || '@tr213.test' from unnest(array[m1, m2, m3, m4, m5]) x;
  insert into profiles(id, display_name, email, account_status, round_emails) select x, 'TR ' || right(x::text, 1), x::text || '@tr213.test', 'active', true from unnest(array[m1, m2, m3, m4, m5]) x;
  -- a finished scramble: team a scored 9 holes, team b only 5
  insert into games(id, code, name, course, holes_meta, game_type, status, created_by, played_at, ended_at, foursomes)
  values (gs, '213213', 'TR scramble', 'Oak', '[]', 'scramble', 'ended', m1, now() - interval '1 day', current_date - 1,
          jsonb_build_array(jsonb_build_object('id', 't1', 'name', 'Team 1', 'a', jsonb_build_array(m1, m2), 'b', '[]'::jsonb),
                            jsonb_build_object('id', 't2', 'name', 'Team 2', 'a', jsonb_build_array(m3, m4), 'b', '[]'::jsonb)));
  insert into game_players(game_id, user_id, display_name) select gs, x, 'TR' from unnest(array[m1, m2, m3, m4]) x;
  insert into game_alt_shot_scores(game_id, foursome_id, side, hole_index, strokes) select gs, 't1', 'a', i, 4 from generate_series(0, 8) i;
  insert into game_alt_shot_scores(game_id, foursome_id, side, hole_index, strokes) select gs, 't2', 'a', i, 4 from generate_series(0, 4) i;
  -- an older alternate-shot game: no side rows, the scores on the player's own card
  insert into games(id, code, name, course, holes_meta, game_type, status, created_by, played_at, foursomes)
  values (ga, '213214', 'TR alt', 'Elm', (select jsonb_agg(jsonb_build_object('n', i, 'par', 4, 'si', i)) from generate_series(1, 18) i), 'alt_shot', 'ended', m5, now() - interval '30 days',
          jsonb_build_array(jsonb_build_object('id', 'g1', 'name', 'G', 'a', jsonb_build_array(m5), 'b', '[]'::jsonb)));
  insert into game_players(game_id, user_id, display_name, scores) values (ga, m5, 'TR5', '[4,4,4,4,4,4,4,4,4,4,null,null,null,null,null,null,null,null]');

  select count(*) into n from team_rounds_in_year(yr) t where t.user_id in (m1, m2);
  if n <> 2 then raise exception 'the 9-hole scramble team should count 2 team rounds, got %', n; end if;
  if exists (select 1 from team_rounds_in_year(yr) t where t.user_id in (m3, m4)) then raise exception 'a 5-hole team counted as a round'; end if;
  if not exists (select 1 from team_rounds_in_year(yr) t where t.user_id = m5 and t.game_id = ga) then raise exception 'an older alternate-shot game (scores on the player card) did not count'; end if;
  -- Season Wrapped: a member whose only golf was a scramble is in the preview
  if not exists (select 1 from season_wrapped_preview(yr) w where w.email = m1::text || '@tr213.test') then raise exception 'Season Wrapped preview misses a scramble-only member'; end if;
  -- the team-round email: due once, never twice
  insert into app_settings(key, value) values ('round_emails', '{"recipients":"everyone"}') on conflict (key) do update set value = excluded.value;
  if not exists (select 1 from due_team_round_emails(100) d where d.game_id = gs and d.user_id = m1) then raise exception 'the team-round email is not due'; end if;
  perform record_team_round_email(gs, m1, 'sent', null);
  if exists (select 1 from due_team_round_emails(100) d where d.game_id = gs and d.user_id = m1) then raise exception 'the team-round email would be sent twice'; end if;
  -- server only
  if has_function_privilege('authenticated', 'public.due_team_round_emails(integer)', 'execute') or has_function_privilege('authenticated', 'public.team_rounds_in_year(integer)', 'execute') then raise exception 'app users can call the server-only team-round functions'; end if;
  raise notice 'TEAM_ROUNDS_PASS 9+ holes count (5 don''t); older alternate shot counts; Season Wrapped includes scramble-only members; the team-round email is due once, server only';
end $$;
rollback;
