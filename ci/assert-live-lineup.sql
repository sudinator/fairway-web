-- 0173: the public line-up read. Correct game by token, nothing after the game ends, null for a bad
-- token, no scores or money in the payload, course tees resolved by name.
do $$
declare org uuid := '17300000-0000-0000-0000-000000000001'; grp uuid := '17300000-0000-0000-0000-000000000011';
        gid uuid := '17300000-0000-0000-0000-000000000021'; fc uuid := '17300000-0000-0000-0000-000000000031';
        tok text := 'lineup-test-token-0173'; j jsonb;
begin
  delete from scoring_devices where user_id = org;
  delete from game_players where game_id = gid; delete from games where id = gid; delete from group_courses where course_id = fc; delete from favorite_courses where id = fc;
  delete from group_members where group_id = grp; delete from groups where id = grp; delete from profiles where id = org; delete from auth.users where id = org;
  insert into auth.users(id,email) values (org,'org@x.com'); insert into profiles(id,display_name) values (org,'Organizer');
  insert into groups(id,name) values (grp,'Lineup Club');
  insert into group_members(group_id,user_id,email,role,status) values (grp,org,'org@x.com','admin','active');
  insert into favorite_courses(id,group_id,user_id,name,data) values (fc,grp,org,'Essex County Country Club',
    '{"name":"Essex County Country Club","tees":[{"name":"Blue","rating":71.2,"slope":134,"par":72}],"holes":[]}');
  insert into group_courses(group_id,course_id,added_by) values (grp,fc,org);
  insert into games(id,code,name,course,game_type,status,group_id,created_by,allowance_pct,course_par,holes_meta,share_token,foursomes,teams,played_at)
    values (gid,'LNUP','Saturday Trifecta','Essex County Country Club','trifecta','active',grp,org,90,72,
            '[{"n":1,"par":4,"si":1}]'::jsonb, tok,
            '[{"id":"f1","name":"Group 1","a":["17300000-0000-0000-0000-000000000001"],"b":[]}]'::jsonb,
            '[{"key":"A","name":"Reds"},{"key":"B","name":"Blues"}]'::jsonb, '2026-10-10');
  insert into game_players(game_id,user_id,display_name,tee_name,course_handicap,handicap_index,team,scores) values (gid,org,'Organizer','Blue',15,16.1,'A','[4]'::jsonb);

  execute 'set local role anon';
  j := public.get_live_lineup(tok);
  execute 'reset role';
  if j is null or (j->>'ended')::boolean then raise exception 'active game not served: %', j; end if;
  if j->>'name' <> 'Saturday Trifecta' or (j->>'allowance_pct')::int <> 90 then raise exception 'game fields: %', j; end if;
  if jsonb_array_length(j->'players') <> 1 or (j->'players'->0->>'course_handicap')::int <> 15 then raise exception 'players: %', j->'players'; end if;
  if (j->'players'->0) ? 'scores' then raise exception 'line-up payload leaks scores'; end if;
  if (j->'course_tees'->0->>'slope')::int <> 134 then raise exception 'course tees not resolved by name: %', j->'course_tees'; end if;
  if jsonb_array_length(j->'foursomes') <> 1 then raise exception 'foursomes missing'; end if;
  -- 0176: the MATCH date (games.played_at), not the creation time.
  if (j->>'played_on') is distinct from '2026-10-10' then raise exception 'played_on is % — must be the match date, not created_at', j->>'played_on'; end if;

  if public.get_live_lineup('no-such-token-xxxxxxxx') is not null then raise exception 'unknown token returned data'; end if;
  if public.get_live_lineup('short') is not null then raise exception 'short token returned data'; end if;

  update games set status = 'ended', ended_at = now() where id = gid;
  j := public.get_live_lineup(tok);
  if not (j->>'ended')::boolean or j ? 'players' then raise exception 'ended game still serves the line-up: %', j; end if;

  if not has_function_privilege('anon', 'public.get_live_lineup(text)', 'execute') then raise exception 'anon cannot read the line-up link'; end if;

  -- 0177: a readable slug. Minted when the organizer turns sharing on; readable prefix + 6 unguessable
  -- characters; the read accepts slug or token; the slug is cleared with the token.
  update games set status = 'active', ended_at = null where id = gid;
  -- As the organizer, from a claimed scoring device: games updates by a signed-in user are fenced
  -- by the 0162 device guard unless the request carries the device header, as the app's requests do.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', org::text, true);
  perform public.claim_scoring_device('17300000-0000-0000-0000-000000000099');
  perform set_config('request.headers', '{"x-bnn-scoring-device":"17300000-0000-0000-0000-000000000099"}', true);
  perform public.set_game_share(gid, true);
  execute 'reset role';
  select lineup_slug into tok from games where id = gid;
  if tok !~ '^essex-county-country-club-oct10-[abcdefghjkmnpqrstuvwxyz23456789]{6}$' then raise exception 'slug shape: %', tok; end if;
  j := public.get_live_lineup(tok);
  if j is null or (j->>'ended')::boolean or j->>'code' <> 'LNUP' then raise exception 'slug does not resolve: %', tok; end if;
  if public.get_live_lineup('essex-county-country-club-oct10-zzzzzz') is not null then raise exception 'a guessed slug with the wrong code resolved'; end if;
  -- renaming the game does not change a posted link (clear the JWT claim first: with a signed-in
  -- claim set, a games UPDATE is fenced by the 0162 scoring-device guard)
  perform set_config('request.jwt.claim.sub', '', true);
  update games set name = 'Renamed' where id = gid;
  if (select lineup_slug from games where id = gid) <> tok then raise exception 'slug changed on rename'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', org::text, true);
  perform set_config('request.headers', '{"x-bnn-scoring-device":"17300000-0000-0000-0000-000000000099"}', true);
  perform public.set_game_share(gid, false);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', '', true);
  if (select lineup_slug from games where id = gid) is not null then raise exception 'slug survived turning sharing off'; end if;
  if public.get_live_lineup(tok) is not null then raise exception 'revoked slug still resolves'; end if;

  delete from scoring_devices where user_id = org;
  delete from game_players where game_id = gid; delete from games where id = gid; delete from group_courses where course_id = fc; delete from favorite_courses where id = fc;
  delete from group_members where group_id = grp; delete from groups where id = grp; delete from profiles where id = org; delete from auth.users where id = org;
  raise notice 'LIVE_LINEUP_PASS token/slug read serves active games only, no scores, tees by name, dark when ended, slug minted/revoked with sharing';
end $$;
