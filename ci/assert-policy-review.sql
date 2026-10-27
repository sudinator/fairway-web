-- 0207 (211.5): guests, badges, the activity log by meaning, and club deletions recorded by the database.
do $$
declare adm uuid := '20700000-0000-0000-0000-0000000000a1'; p1 uuid := '20700000-0000-0000-0000-0000000000a2';
        p2 uuid := '20700000-0000-0000-0000-0000000000a3'; o uuid := '20700000-0000-0000-0000-0000000000a4';
        ga uuid := '20700000-0000-0000-0000-0000000000c1'; gb uuid := '20700000-0000-0000-0000-0000000000c2'; gc uuid := '20700000-0000-0000-0000-0000000000c3';
        gm uuid := '20700000-0000-0000-0000-0000000000d1'; guest uuid := '20700000-0000-0000-0000-0000000000e1';
        n int; ok boolean;
  procedure_as text;
begin
  delete from activity_log where actor_id in (adm, p1, p2, o); delete from member_badges where user_id in (adm, p1, p2, o);
  delete from game_players where game_id = gm; delete from games where id = gm;
  delete from group_members where group_id in (ga, gb, gc); delete from groups where id in (ga, gb, gc);
  delete from scoring_devices where user_id in (adm, p1, p2, o);
  delete from profiles where id in (adm, p1, p2, o); delete from auth.users where id in (adm, p1, p2, o);
  insert into auth.users(id, email) values (adm, 'a@r207.test'), (p1, 'p1@r207.test'), (p2, 'p2@r207.test'), (o, 'o@r207.test');
  insert into profiles(id, display_name, email, account_status) values (adm, 'Admin A', 'a@r207.test', 'active'), (p1, 'P1', 'p1@r207.test', 'active'), (p2, 'P2', 'p2@r207.test', 'active'), (o, 'Outsider', 'o@r207.test', 'active');
  insert into groups(id, name, status, created_by) values (ga, 'Club A', 'active', adm), (gb, 'Club B', 'active', o), (gc, 'Club C', 'active', adm);
  insert into group_members(group_id, user_id, email, role, status) values (ga, adm, 'a@r207.test', 'admin', 'active'), (ga, p1, 'p1@r207.test', 'member', 'active'),
    (ga, p2, 'p2@r207.test', 'member', 'active'), (ga, o, 'o@r207.test', 'member', 'active'), (gb, o, 'o@r207.test', 'admin', 'active'), (gc, adm, 'a@r207.test', 'admin', 'active');
  insert into games(id, code, name, course, holes_meta, group_id, status, created_by) values (gm, '207207', 'G207', 'C', '[]', ga, 'active', adm);
  insert into game_players(game_id, user_id, display_name, tee_group) values (gm, adm, 'Admin A', 1), (gm, p1, 'P1', 1), (gm, p2, 'P2', 2);
  insert into game_players(id, game_id, user_id, display_name, is_guest, tee_group) values (guest, gm, null, 'Gus', true, 1);
  insert into member_badges(user_id, badge_key) values (p1, 'eagle');

  execute 'set local role authenticated';
  -- 1. guests: another group's player and a club member not in the game can't remove or add; the guest's group can
  perform set_config('request.jwt.claim.sub', p2::text, true);
  delete from game_players where id = guest; get diagnostics n = row_count;
  if n <> 0 then raise exception 'a player in another tee group removed the guest'; end if;
  perform set_config('request.jwt.claim.sub', o::text, true);
  execute 'reset role'; perform public.claim_scoring_device('20700000-0000-0000-0000-0000000000f4'); execute 'set local role authenticated';
  perform set_config('request.headers', '{"x-bnn-scoring-device":"20700000-0000-0000-0000-0000000000f4"}', true);
  delete from game_players where id = guest; get diagnostics n = row_count;
  if n <> 0 then raise exception 'a club member not in the game removed the guest'; end if;
  begin insert into game_players(game_id, user_id, display_name, is_guest, tee_group) values (gm, null, 'Sneaky', true, 1); ok := false; exception when others then ok := sqlerrm like '%row-level security%'; end;
  if not ok then raise exception 'a club member not in the game added a guest'; end if;
  perform set_config('request.jwt.claim.sub', p1::text, true);
  execute 'reset role'; perform public.claim_scoring_device('20700000-0000-0000-0000-0000000000f2'); execute 'set local role authenticated';
  perform set_config('request.headers', '{"x-bnn-scoring-device":"20700000-0000-0000-0000-0000000000f2"}', true);
  insert into game_players(game_id, user_id, display_name, is_guest, tee_group) values (gm, null, 'Second Guest', true, 1);
  delete from game_players where game_id = gm and display_name = 'Second Guest'; get diagnostics n = row_count;
  if n <> 1 then raise exception 'a player in the guest''s group could not remove their guest'; end if;
  execute 'reset role';
  update games set status = 'ended' where id = gm;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', p1::text, true);
  perform set_config('request.headers', '{"x-bnn-scoring-device":"20700000-0000-0000-0000-0000000000f2"}', true);
  delete from game_players where id = guest; get diagnostics n = row_count;
  if n <> 0 then raise exception 'a player removed a guest after the game ended'; end if;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  execute 'reset role'; perform public.claim_scoring_device('20700000-0000-0000-0000-0000000000f1'); execute 'set local role authenticated';
  perform set_config('request.headers', '{"x-bnn-scoring-device":"20700000-0000-0000-0000-0000000000f1"}', true);

  -- 0222 (owner, Oct 26: rule 1): an ENDED game can't be changed — not even by the organizer — until it is reopened
  begin delete from game_players where id = guest; ok := false; exception when others then ok := sqlerrm like '%has ended%'; end;
  if not ok then raise exception 'the organizer removed a guest from an ENDED game (it must be reopened first)'; end if;
  execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
  update games set status = 'active' where id = gm;   -- reopened
  perform set_config('request.jwt.claim.sub', adm::text, true); execute 'set local role authenticated';
  delete from game_players where id = guest; get diagnostics n = row_count;
  if n <> 1 then raise exception 'the organizer could not remove a guest once the game was reopened'; end if;
  -- 2. badges: read your own, never create one
  perform set_config('request.jwt.claim.sub', p1::text, true);
  if (select count(*) from member_badges where user_id = p1) <> 1 then raise exception 'a member cannot read their own badge'; end if;
  begin insert into member_badges(user_id, badge_key) values (p1, 'hole_in_one'); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a member awarded themselves a badge'; end if;
  -- 0208: the player card is the server's — a member can't write their own (it feeds the sandbagger check)
  begin insert into player_cards(user_id, idx, rounds) values (p1, 18, 20); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a member wrote their own player card'; end if;
  -- 3. the activity log, by meaning
  begin insert into activity_log(actor_id, action, summary) values (p1, 'group_approved', 'forged'); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a member logged a system-admin act'; end if;
  insert into activity_log(actor_id, action, summary) values (p1, 'round_completed', 'my round');
  begin insert into activity_log(actor_id, action, summary, group_id, target_user_id) values (p1, 'role_changed', 'forged', ga, p2); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a plain member logged a role change'; end if;
  insert into activity_log(actor_id, action, summary, group_id, target_user_id) values (p1, 'member_added', 'joined by invite', ga, p1);
  perform set_config('request.jwt.claim.sub', adm::text, true);
  insert into activity_log(actor_id, action, summary, group_id, target_user_id) values (adm, 'role_changed', 'made P1 admin', ga, p1);
  begin insert into activity_log(actor_id, action, summary, group_id, target_user_id) values (adm, 'role_changed', 'forged', gb, o); ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'a club admin logged a role change in another club'; end if;
  -- 4. a club deletion is recorded by the database
  delete from groups where id = gc;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if not exists (select 1 from activity_log where actor_id = adm and action = 'club_deleted' and summary like '%Club C%') then raise exception 'the club deletion was not recorded'; end if;

  delete from activity_log where actor_id in (adm, p1, p2, o); delete from member_badges where user_id in (adm, p1, p2, o);
  delete from game_players where game_id = gm; delete from games where id = gm;
  delete from group_members where group_id in (ga, gb, gc); delete from groups where id in (ga, gb, gc);
  delete from profiles where id in (adm, p1, p2, o); delete from auth.users where id in (adm, p1, p2, o);
  raise notice 'POLICY_REVIEW_PASS guests only by their group (not after the end; the organizer once reopened); badges read-only; activity by meaning; club deletions recorded';
end $$;
