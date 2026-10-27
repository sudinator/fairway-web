-- 0194 (209.4): a guest's scores can be changed by the people playing with them — not by any club member.
-- 0224 (212.53): the write used is a SCORING field (scored_by) — a guest's handicap is the organizer's alone now.
do $$
declare org uuid := '19400000-0000-0000-0000-000000000001'; a uuid := '19400000-0000-0000-0000-000000000002';
        b uuid := '19400000-0000-0000-0000-000000000003'; outsider uuid := '19400000-0000-0000-0000-000000000004';
        g uuid := '19400000-0000-0000-0000-000000000011'; gm uuid := '19400000-0000-0000-0000-000000000021';
        guest uuid := '19400000-0000-0000-0000-000000000031'; loose uuid := '19400000-0000-0000-0000-000000000032';
        n int;
begin
  delete from game_players where game_id = gm; delete from games where id = gm; delete from group_members where group_id = g; delete from groups where id = g;
  delete from profiles where id in (org, a, b, outsider); delete from auth.users where id in (org, a, b, outsider);
  insert into auth.users(id, email) values (org, 'org@g194.test'), (a, 'a@g194.test'), (b, 'b@g194.test'), (outsider, 'o@g194.test');
  insert into profiles(id, display_name, email, account_status) values (org, 'Org', 'org@g194.test', 'active'), (a, 'Ann', 'a@g194.test', 'active'), (b, 'Bob', 'b@g194.test', 'active'), (outsider, 'Otto', 'o@g194.test', 'active');
  insert into groups(id, name, status) values (g, 'Club 194', 'active');
  insert into group_members(group_id, user_id, email, role, status) values (g, org, 'org@g194.test', 'admin', 'active'), (g, a, 'a@g194.test', 'member', 'active'), (g, b, 'b@g194.test', 'member', 'active'), (g, outsider, 'o@g194.test', 'member', 'active');
  insert into games(id, code, name, course, holes_meta, group_id, created_by) values (gm, '194194', 'G194', 'C', '[]', g, org);
  insert into game_players(game_id, user_id, display_name, tee_group) values (gm, org, 'Org', 1), (gm, a, 'Ann', 1), (gm, b, 'Bob', 2);
  insert into game_players(id, game_id, user_id, display_name, is_guest, tee_group) values (guest, gm, null, 'Gus', true, 1), (loose, gm, null, 'Lou', true, null);

  -- The row rule is the same for every detail of a guest's entry; it is exercised through the guest's course
  -- handicap, which the score-only safeguards (0162 primary device, 0163 reset fence — each tested on its own)
  -- don't cover, so this shows WHO the rule lets change a guest, directly.
  execute 'set local role authenticated';
  -- a player in the guest's tee group: yes
  perform set_config('request.jwt.claim.sub', a::text, true);
  update game_players set scored_by = auth.uid() where id = guest; get diagnostics n = row_count;
  if n <> 1 then raise exception 'a player in the guest''s tee group could not score the guest'; end if;
  -- a player in another tee group: no
  perform set_config('request.jwt.claim.sub', b::text, true);
  update game_players set scored_by = auth.uid() where id = guest; get diagnostics n = row_count;
  if n <> 0 then raise exception 'a player in another tee group scored the guest'; end if;
  -- a club member not in the game: no (the gap 0194 closes)
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  update game_players set scored_by = auth.uid() where id = guest; get diagnostics n = row_count;
  if n <> 0 then raise exception 'a club member who is not in the game scored a guest'; end if;
  update game_players set scored_by = auth.uid() where id = loose; get diagnostics n = row_count;
  if n <> 0 then raise exception 'a club member who is not in the game scored a guest with no tee group'; end if;
  -- a guest with no tee group: any player in the game
  perform set_config('request.jwt.claim.sub', b::text, true);
  update game_players set scored_by = auth.uid() where id = loose; get diagnostics n = row_count;
  if n <> 1 then raise exception 'a player in the game could not score a guest with no tee group'; end if;
  -- the organizer: yes (their own rule)
  perform set_config('request.jwt.claim.sub', org::text, true);
  update game_players set scored_by = auth.uid() where id = guest; get diagnostics n = row_count;
  if n <> 1 then raise exception 'the organizer could not score a guest'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if (select scored_by from game_players where id = guest) is distinct from org then raise exception 'unexpected guest value'; end if;

  delete from game_players where game_id = gm; delete from games where id = gm; delete from group_members where group_id = g; delete from groups where id = g;
  delete from profiles where id in (org, a, b, outsider); delete from auth.users where id in (org, a, b, outsider);
  raise notice 'GUEST_SCORING_PASS guests scored by their tee group (any player when no group), organizer; not by other groups or club members outside the game';
end $$;
