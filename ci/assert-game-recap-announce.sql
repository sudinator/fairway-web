-- 0188: the old SQL announcement is gone; each completion is claimed once; re-ends announce only changes.
do $$
declare org uuid := '18800000-0000-0000-0000-000000000001'; gid uuid := '18800000-0000-0000-0000-000000000021'; ok boolean;
begin
  delete from notifications where user_id = org; delete from game_players where game_id = gid; delete from games where id = gid;
  delete from profiles where id = org; delete from auth.users where id = org;
  insert into auth.users(id,email) values (org,'o188@x.com'); insert into profiles(id,display_name) values (org,'Org');
  insert into games(id,code,name,course,game_type,status,created_by,holes_meta,course_par,allowance_pct)
    values (gid,'RCAP','Recap','C','stableford','active',org,(select jsonb_agg(jsonb_build_object('n',i,'par',4,'si',i)) from generate_series(1,18) i),72,100);
  insert into game_players(game_id,user_id,display_name,scores) values (gid,org,'Org',(select jsonb_agg(4) from generate_series(1,18)));
  if exists (select 1 from pg_trigger where tgname = 'trg_notify_game_finished') then raise exception 'old SQL announcement trigger still present'; end if;
  update games set status = 'ended' where id = gid;
  if exists (select 1 from notifications where user_id = org and type = 'game_finished') then raise exception 'SQL still announced the game'; end if;
  execute 'set local role service_role';
  if public.claim_game_recap(gid, 'sig-1') <> 'final' then raise exception 'first completion should be final'; end if;
  if public.claim_game_recap(gid, 'sig-1') <> 'same' then raise exception 'a retry must not announce again'; end if;
  if public.claim_game_recap(gid, 'sig-2') <> 'updated' then raise exception 'a changed outcome is an update'; end if;
  execute 'reset role';
  update games set status = 'active' where id = gid;
  execute 'set local role service_role';
  if public.claim_game_recap(gid, 'sig-3') <> 'not_ended' then raise exception 'an active game cannot be announced'; end if;
  execute 'reset role';
  if has_function_privilege('authenticated', 'public.claim_game_recap(uuid,text)', 'execute') then raise exception 'app role can claim announcements'; end if;
  delete from notifications where user_id = org; delete from game_players where game_id = gid; delete from games where id = gid;
  delete from profiles where id = org; delete from auth.users where id = org;
  raise notice 'GAME_RECAP_ANNOUNCE_PASS old trigger retired; final once; retries silent; changes announced as updates; service role only';
end $$;
