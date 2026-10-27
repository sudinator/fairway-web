-- 0184 (review finding 4): teams, groups and foursomes apply together or not at all; validated.
do $$
declare org uuid := '18400000-0000-0000-0000-000000000001'; oth uuid := '18400000-0000-0000-0000-000000000002';
        grp uuid := '18400000-0000-0000-0000-000000000011'; gid uuid := '18400000-0000-0000-0000-000000000021';
        p1 uuid := '18400000-0000-0000-0000-000000000031'; p2 uuid := '18400000-0000-0000-0000-000000000032';
        p3 uuid := '18400000-0000-0000-0000-000000000033'; p4 uuid := '18400000-0000-0000-0000-000000000034';
        r jsonb; ok boolean;
begin
  delete from game_players where game_id = gid; delete from games where id = gid; delete from group_members where group_id = grp; delete from groups where id = grp;
  delete from profiles where id in (org, oth); delete from auth.users where id in (org, oth);
  insert into auth.users(id,email) values (org,'o184@x.com'),(oth,'x184@x.com'); insert into profiles(id,display_name) values (org,'Org'),(oth,'Other');
  insert into groups(id,name) values (grp,'Atomic Club'); insert into group_members(group_id,user_id,email,role,status) values (grp,org,'o184@x.com','member','active'),(grp,oth,'x184@x.com','member','active');
  insert into games(id,code,name,course,game_type,status,group_id,created_by,teams,foursomes,holes_meta,course_par,allowance_pct)
    values (gid,'ATOM','Atomic','C','fourball','active',grp,org,'[{"key":"A","name":"Red"},{"key":"B","name":"Blue"}]','[]',
            (select jsonb_agg(jsonb_build_object('n',i,'par',4,'si',i)) from generate_series(1,18) i), 72, 100);
  insert into game_players(id,game_id,display_name,team,tee_group,scores) values
    (p1,gid,'P1','A',1,'[]'),(p2,gid,'P2','A',1,'[]'),(p3,gid,'P3','B',1,'[]'),(p4,gid,'P4','B',1,'[]');
  -- 0222: P4's score is entered AFTER the line-up is saved below — the app (and now the server) freezes foursomes once
  -- anyone has scored, so the line-up is saved first, as it would be in a real round.

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', org::text, true);
  -- A valid balance: P2 to B, P3 to A, groups and foursomes together.
  r := public.apply_game_structure(gid, '[{"player":"18400000-0000-0000-0000-000000000032","team":"B"},{"player":"18400000-0000-0000-0000-000000000033","team":"A"}]',
                                   '[{"player":"18400000-0000-0000-0000-000000000031","group":1}]', '[{"id":"f1","a":["x"],"b":["y"]}]');
  if (r->>'teams_changed')::int <> 2 or (r->>'foursomes_saved')::boolean is not true then raise exception 'valid structure: %', r; end if;
  -- ALL-OR-NOTHING: one bad entry (unknown team) → nothing changes, including the valid entries and the foursomes.
  begin
    perform public.apply_game_structure(gid, '[{"player":"18400000-0000-0000-0000-000000000031","team":"B"},{"player":"18400000-0000-0000-0000-000000000032","team":"Z"}]', '[]', '[{"id":"BAD"}]');
    ok := false;
  exception when others then ok := true; end;
  if not ok then raise exception 'unknown team accepted'; end if;
  execute 'reset role';
  if (select team from game_players where id = p1) <> 'A' then raise exception 'partial save: P1 moved although the batch failed'; end if;
  if (select foursomes->0->>'id' from games where id = gid) <> 'f1' then raise exception 'partial save: foursomes replaced although the batch failed'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', org::text, true);
  -- P4 now posts a score (as the app's scoring would)
  execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
  update game_players set scores = '[4,null]' where id = p4;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', org::text, true);
  -- A scored player cannot change team.
  begin perform public.apply_game_structure(gid, '[{"player":"18400000-0000-0000-0000-000000000034","team":"A"}]', '[]', null); ok := false;
  exception when others then ok := true; end;
  if not ok then raise exception 'scored player moved'; end if;
  -- Another game's player is refused.
  begin perform public.apply_game_structure(gid, '[{"player":"18400000-0000-0000-0000-000000000099","team":"A"}]', '[]', null); ok := false;
  exception when others then ok := true; end;
  if not ok then raise exception 'foreign player accepted'; end if;
  -- A member who is neither organizer nor admin is refused.
  perform set_config('request.jwt.claim.sub', oth::text, true);
  begin perform public.apply_game_structure(gid, '[]', '[]', null); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'non-organizer changed the line-up'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from game_players where game_id = gid; delete from games where id = gid; delete from group_members where group_id = grp; delete from groups where id = grp;
  delete from profiles where id in (org, oth); delete from auth.users where id in (org, oth);
  raise notice 'GAME_STRUCTURE_ATOMIC_PASS all-or-nothing; validated; organizer or club admin only';
end $$;
