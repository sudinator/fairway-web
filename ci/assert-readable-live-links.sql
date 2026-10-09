-- 0178: the live scorecard and the competition page resolve by readable slug as well as by token;
-- the slug is minted/cleared with sharing; a short name still yields a slug the readers accept.
do $$
declare org uuid := '17800000-0000-0000-0000-000000000001'; grp uuid := '17800000-0000-0000-0000-000000000011';
        gid uuid := '17800000-0000-0000-0000-000000000021'; cid uuid := '17800000-0000-0000-0000-000000000031';
        slug text; j jsonb;
begin
  delete from game_players where game_id = gid; delete from games where id = gid; delete from competitions where id = cid;
  delete from scoring_devices where user_id = org;
  delete from group_members where group_id = grp; delete from groups where id = grp; delete from profiles where id = org; delete from auth.users where id = org;
  insert into auth.users(id,email) values (org,'org178@x.com'); insert into profiles(id,display_name,is_admin) values (org,'Organizer',true);
  insert into groups(id,name) values (grp,'Links Club');
  insert into group_members(group_id,user_id,email,role,status) values (grp,org,'org178@x.com','admin','active');
  -- a ONE-letter course name: the slug must still be >= 16 characters
  insert into games(id,code,name,course,game_type,status,group_id,created_by,allowance_pct,course_par,holes_meta,played_at)
    values (gid,'LNKS','Short','X','stableford','active',grp,org,100,72,'[{"n":1,"par":4,"si":1}]'::jsonb,'2026-10-10');
  insert into game_players(game_id,user_id,display_name,tee_name,course_handicap,handicap_index,scores) values (gid,org,'Organizer','Blue',10,10,'[4]'::jsonb);
  insert into competitions(id,name,start_date,group_id,created_by) values (cid,'Fall Ryder Cup','2026-10-10',grp,org);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', org::text, true);
  perform public.claim_scoring_device('17800000-0000-0000-0000-000000000099');
  perform set_config('request.headers', '{"x-bnn-scoring-device":"17800000-0000-0000-0000-000000000099"}', true);
  perform public.set_game_share(gid, true);
  perform public.set_competition_share(cid, true);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', '', true);

  select lineup_slug into slug from games where id = gid;
  if slug is null or length(slug) < 16 or slug !~ '^x-oct10-' then raise exception 'game slug: %', slug; end if;
  j := public.get_live_scorecard(slug);
  if j is null then raise exception 'live scorecard does not resolve by slug'; end if;
  if public.get_live_scorecard((select share_token from games where id = gid)) is null then raise exception 'live scorecard no longer resolves by token'; end if;

  select share_slug into slug from competitions where id = cid;
  if slug !~ '^fall-ryder-cup-oct10-[abcdefghjkmnpqrstuvwxyz23456789]{6}$' then raise exception 'competition slug: %', slug; end if;
  j := public.get_live_competition(slug);
  if j is null then raise exception 'competition page does not resolve by slug'; end if;
  if public.get_live_competition('fall-ryder-cup-oct10-zzzzzz') is not null then raise exception 'guessed competition slug resolved'; end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', org::text, true);
  perform public.set_competition_share(cid, false);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if (select share_slug from competitions where id = cid) is not null then raise exception 'competition slug survived revoke'; end if;
  if public.get_live_competition(slug) is not null then raise exception 'revoked competition slug still resolves'; end if;

  delete from game_players where game_id = gid; delete from games where id = gid; delete from competitions where id = cid;
  delete from scoring_devices where user_id = org;
  delete from group_members where group_id = grp; delete from groups where id = grp; delete from profiles where id = org; delete from auth.users where id = org;
  raise notice 'READABLE_LIVE_LINKS_PASS scorecard and competition resolve by slug and token; minted/revoked with sharing; short names padded';
end $$;
