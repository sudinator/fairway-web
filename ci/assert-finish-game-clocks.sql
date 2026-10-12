-- 0179: the organizer can end a game while a round clock is still running (BN163 regression).
do $$
declare org uuid := '17900000-0000-0000-0000-000000000001'; grp uuid := '17900000-0000-0000-0000-000000000011';
        gid uuid := '17900000-0000-0000-0000-000000000021'; dev uuid := '17900000-0000-0000-0000-000000000099';
begin
  delete from game_players where game_id = gid; delete from games where id = gid; delete from scoring_devices where user_id = org;
  delete from group_members where group_id = grp; delete from groups where id = grp; delete from profiles where id = org; delete from auth.users where id = org;
  insert into auth.users(id,email) values (org,'org179@x.com'); insert into profiles(id,display_name) values (org,'Organizer');
  insert into groups(id,name) values (grp,'Clock Club');
  insert into group_members(group_id,user_id,email,role,status) values (grp,org,'org179@x.com','admin','active');
  insert into games(id,code,name,course,game_type,status,group_id,created_by,allowance_pct,course_par,holes_meta,played_at)
    values (gid,'CLCK','Nine and in','Clock Course','stableford','active',grp,org,100,72,
            (select jsonb_agg(jsonb_build_object('n',i,'par',4,'si',i)) from generate_series(1,18) i), '2026-10-13');
  -- a player who started the clock and scored nine holes
  insert into game_players(game_id,user_id,display_name,tee_name,course_handicap,handicap_index,scores,clock_start)
    values (gid,org,'Organizer','Blue',10,10,'[4,4,4,4,4,4,4,4,4,null,null,null,null,null,null,null,null,null]'::jsonb, now() - interval '2 hours');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', org::text, true);
  perform public.claim_scoring_device(dev);
  perform set_config('request.headers', ('{"x-bnn-scoring-device":"' || dev || '"}'), true);
  perform public.finish_game_and_post_rounds(gid);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', '', true);

  if (select status from games where id = gid) is distinct from 'ended' then raise exception 'game not ended'; end if;
  if (select clock_end from game_players where game_id = gid and user_id = org) is null then raise exception 'open clock not closed at end'; end if;

  delete from rounds where user_id = org and course = 'Clock Course';
  delete from game_players where game_id = gid; delete from games where id = gid; delete from scoring_devices where user_id = org;
  delete from group_members where group_id = grp; delete from groups where id = grp; delete from profiles where id = org; delete from auth.users where id = org;
  raise notice 'FINISH_GAME_CLOCKS_PASS ending a game closes a running clock without tripping the reset fence';
end $$;
