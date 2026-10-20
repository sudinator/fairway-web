-- 0198 (210.7): round emails never disappear silently; a recap announcement can always be retried.
do $$
declare own uuid := '19800000-0000-0000-0000-000000000001'; m uuid := '19800000-0000-0000-0000-000000000002';
        r_ok uuid := '19800000-0000-0000-0000-000000000011'; r_none uuid := '19800000-0000-0000-0000-000000000012'; r_skip uuid := '19800000-0000-0000-0000-000000000013';
        gm uuid := '19800000-0000-0000-0000-000000000021'; v text; ok boolean;
        good jsonb; bad jsonb;
begin
  delete from notifications where user_id in (own, m); delete from round_email_log where user_id in (own, m);
  delete from holes where round_id in (r_ok, r_none, r_skip); delete from rounds where user_id in (own, m); delete from games where id = gm;
  delete from profiles where id in (own, m); delete from auth.users where id in (own, m);
  insert into auth.users(id, email) values (own, 'o@e198.test'), (m, 'm@e198.test');
  insert into profiles(id, display_name, email, is_owner, account_status, round_emails) values (own, 'Owner', 'o@e198.test', true, 'active', true), (m, 'Member', 'm@e198.test', false, 'active', true);
  insert into rounds(id, user_id, course, played_at, status, finished_at) values
    (r_ok, own, 'E198', current_date, 'final', now() - interval '2 hours'), (r_none, own, 'E198', current_date, 'final', now() - interval '2 hours'),
    (r_skip, own, 'E198', current_date, 'final', now() - interval '2 hours');
  insert into holes(round_id, hole_number, par, strokes) values (r_ok, 1, 4, 4), (r_skip, 1, 4, 5);
  update app_settings set value = '{"recipients": "owner"}' where key = 'round_emails';

  -- point 5: a round with no hole data isn't picked; a skipped round is never picked again
  if exists (select 1 from public.due_round_emails(50) where round_id = r_none) then raise exception 'a round with no hole data was picked'; end if;
  if not exists (select 1 from public.due_round_emails(50) where round_id = r_ok) then raise exception 'a normal round was not picked'; end if;
  perform public.record_round_email(r_skip, own, null, 'summary', 'skipped', 'no hole-by-hole scores to summarise');
  update round_email_log set at = now() - interval '2 days' where round_id = r_skip;
  if exists (select 1 from public.due_round_emails(50) where round_id = r_skip) then raise exception 'a skipped round was picked again'; end if;

  -- point 6: the announcement and the notifications, together
  insert into games(id, code, name, course, holes_meta, status, played_at, created_by) values (gm, '198198', 'G198', 'C', '[]', 'ended', current_date, own);
  good := jsonb_build_array(jsonb_build_object('user_id', m, 'type', 'game_finished', 'message', 'G198 is final', 'link', '/'));
  bad  := jsonb_build_array(jsonb_build_object('user_id', m, 'type', 'game_finished', 'message', null, 'link', '/'));   -- refused: no message
  execute 'set local role service_role';
  begin v := public.announce_game_recap(gm, 'sig-1', bad, bad); ok := false; exception when others then ok := true; end;
  execute 'reset role';
  if not ok then raise exception 'a failed notification insert did not fail the announcement'; end if;
  if (select recap_signature from games where id = gm) is not null then raise exception 'a failed announcement was still recorded — a retry would be lost'; end if;
  execute 'set local role service_role';
  v := public.announce_game_recap(gm, 'sig-1', good, good);
  execute 'reset role';
  if v is distinct from 'final' then raise exception 'the retry did not announce (got %)', v; end if;
  if (select count(*) from notifications where user_id = m and type = 'game_finished') <> 1 then raise exception 'the retry did not deliver the notification'; end if;
  execute 'set local role service_role';
  v := public.announce_game_recap(gm, 'sig-1', good, good);
  execute 'reset role';
  if v is distinct from 'same' or (select count(*) from notifications where user_id = m and type = 'game_finished') <> 1 then raise exception 'the same result was announced twice'; end if;
  if has_function_privilege('authenticated', 'public.announce_game_recap(uuid,text,jsonb,jsonb)', 'execute') then raise exception 'app users can announce'; end if;

  delete from notifications where user_id in (own, m); delete from round_email_log where user_id in (own, m);
  delete from holes where round_id in (r_ok, r_none, r_skip); delete from rounds where user_id in (own, m); delete from games where id = gm;
  delete from profiles where id in (own, m); delete from auth.users where id in (own, m);
  raise notice 'EMAIL_ANNOUNCE_PASS no-hole rounds not picked; skipped never repicked; a failed announcement is undone and the retry delivers; no double announcement; server only';
end $$;
