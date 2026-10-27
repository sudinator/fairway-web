-- assert-group-changes-after-scores.sql — 0221 (212.47): once scoring has started the server refuses the group
-- changes the app's setup rules refuse; a late unscored player may still join an active group; reset frees it again.
-- Moves go through set_tee_group / set_tee_groups / apply_game_structure, as the app's do.
begin;
insert into auth.users(id, email) values
 ('22100000-0000-0000-0000-0000000000a0', 'o@g.test'), ('22100000-0000-0000-0000-0000000000a1', 'p1@g.test'),
 ('22100000-0000-0000-0000-0000000000a2', 'p2@g.test'), ('22100000-0000-0000-0000-0000000000a3', 'p3@g.test'),
 ('22100000-0000-0000-0000-0000000000a4', 'p4@g.test');
insert into public.profiles(id, display_name, account_status)
select id, 'P' || right(id::text, 1), 'active' from auth.users where email like '%@g.test';
insert into public.groups(id, name, created_by) values ('22100000-0000-0000-0000-00000000c1b0', 'Group Club', '22100000-0000-0000-0000-0000000000a0');
insert into public.group_members(group_id, user_id, email, role, status)
select '22100000-0000-0000-0000-00000000c1b0', id, email, case when email like 'o@%' then 'admin' else 'member' end, 'active' from auth.users where email like '%@g.test';

-- the organizer's phone is the primary scoring device (as in the app: registered, and sent with each request)
insert into public.scoring_devices(user_id, token) values ('22100000-0000-0000-0000-0000000000a0', '22109999-0000-0000-0000-000000000001');
create or replace function pg_temp.as_org() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '22100000-0000-0000-0000-0000000000a0', true);
  perform set_config('request.jwt.claims', '{"sub":"22100000-0000-0000-0000-0000000000a0","role":"authenticated"}', true);
  perform set_config('request.headers', '{"x-bnn-scoring-device":"22109999-0000-0000-0000-000000000001"}', true);
  execute 'set local role authenticated';
end $$;
-- back to maintenance: no role AND no signed-in identity (a reset role alone keeps the identity for the transaction)
create or replace function pg_temp.as_maintenance() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.refused(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlerrm like '%frozen%' or sqlerrm like '%locked%'; end $$;

do $$
declare g uuid := '22101000-0000-0000-0000-000000000001'; s uuid := '22101000-0000-0000-0000-000000000002';
  p1 uuid := '22102000-0000-0000-0000-000000000001'; p2 uuid := '22102000-0000-0000-0000-000000000002';
  p3 uuid := '22102000-0000-0000-0000-000000000003'; p4 uuid := '22102000-0000-0000-0000-000000000004';
  late uuid := '22102000-0000-0000-0000-000000000005';
begin
  -- a Stableford game, groups 1 (p1, p2) and 2 (p3, p4); a scramble alongside
  perform pg_temp.as_org();
  perform public.create_game_complete(jsonb_build_object('id', g, 'code', '221001', 'name', 'G', 'course', 'C', 'holes_meta', '[{"n":1,"par":4,"si":1}]'::jsonb, 'game_type', 'stableford', 'group_id', '22100000-0000-0000-0000-00000000c1b0'),
    jsonb_build_array(jsonb_build_object('id', p1, 'user_id', '22100000-0000-0000-0000-0000000000a1', 'display_name', 'P1'), jsonb_build_object('id', p2, 'user_id', '22100000-0000-0000-0000-0000000000a2', 'display_name', 'P2'),
                      jsonb_build_object('id', p3, 'user_id', '22100000-0000-0000-0000-0000000000a3', 'display_name', 'P3'), jsonb_build_object('id', p4, 'user_id', '22100000-0000-0000-0000-0000000000a4', 'display_name', 'P4')),
    '[]', jsonb_build_array(jsonb_build_object('player', p1, 'group', 1), jsonb_build_object('player', p2, 'group', 1), jsonb_build_object('player', p3, 'group', 2), jsonb_build_object('player', p4, 'group', 2)), null, true);
  -- before any score: groups move freely
  perform public.set_tee_group(p2, 2::smallint);
  perform public.set_tee_group(p2, 1::smallint);
  perform pg_temp.as_maintenance();
  -- P1 posts a score; group 2 finishes and locks (as the app's scoring would)
  update public.game_players set scores = '[4]'::jsonb where id = p1;
  update public.game_players set group_locked = true where id in (p3, p4);
  perform pg_temp.as_org();
  if not pg_temp.refused(format('select public.set_tee_group(%L::uuid, 2::smallint)', p1)) then raise exception 'a player with scores was moved'; end if;
  if not pg_temp.refused(format('select public.set_tee_group(%L::uuid, 1::smallint)', p3)) then raise exception 'a player from a locked group was moved'; end if;
  if not pg_temp.refused(format('select public.set_tee_group(%L::uuid, 2::smallint)', p2)) then raise exception 'a player was moved INTO a locked group'; end if;
  if not pg_temp.refused(format('select public.apply_game_structure(%L::uuid, ''[]''::jsonb, jsonb_build_array(jsonb_build_object(''player'', %L::text, ''group'', null)), null)', g, p1)) then raise exception 'Start over cleared a scored player''s group'; end if;
  -- maintenance work (no signed-in caller) is unaffected — even moving a scored player
  perform pg_temp.as_maintenance();
  update public.game_players set tee_group = 2 where id = p1;
  update public.game_players set tee_group = 1 where id = p1;
  perform pg_temp.as_org();
  -- still allowed: an unscored player into an ACTIVE group, and a late player joining one
  perform public.set_tee_group(p2, null::smallint);
  perform public.set_tee_group(p2, 1::smallint);
  insert into public.game_players(id, game_id, user_id, display_name, tee_group) values (late, g, null, 'Late Guest', 1);
  if not pg_temp.refused(format('insert into public.game_players(id, game_id, display_name, tee_group) values (gen_random_uuid(), %L, ''Too Late'', 2)', g)) then raise exception 'a player joined a locked group'; end if;
  -- reset the scores: everything is free again
  perform public.reset_game_scores(g);
  perform public.set_tee_group(p1, 2::smallint);
  perform public.set_tee_group(p3, 1::smallint);
  perform pg_temp.as_maintenance();

  -- SCRAMBLE: once team scoring starts, every group is frozen
  perform pg_temp.as_org();
  perform public.create_game_complete(jsonb_build_object('id', s, 'code', '221002', 'name', 'S', 'course', 'C', 'holes_meta', '[{"n":1,"par":4,"si":1}]'::jsonb, 'game_type', 'scramble', 'scramble_mode', 'field', 'group_id', '22100000-0000-0000-0000-00000000c1b0'),
    jsonb_build_array(jsonb_build_object('id', '22102000-0000-0000-0000-000000000011', 'user_id', '22100000-0000-0000-0000-0000000000a1', 'display_name', 'P1'),
                      jsonb_build_object('id', '22102000-0000-0000-0000-000000000012', 'user_id', '22100000-0000-0000-0000-0000000000a2', 'display_name', 'P2')), '[]', '[]', null, true);
  perform public.set_tee_groups(s, jsonb_build_array(jsonb_build_object('player', '22102000-0000-0000-0000-000000000011', 'group', 1), jsonb_build_object('player', '22102000-0000-0000-0000-000000000012', 'group', 1)));
  perform pg_temp.as_maintenance();
  update public.games set alt_shot_scoring_started_at = now() where id = s;
  perform pg_temp.as_org();
  if not pg_temp.refused(format('select public.set_tee_group(%L::uuid, 2::smallint)', '22102000-0000-0000-0000-000000000011')) then raise exception 'a scramble group changed after team scoring started'; end if;
  perform pg_temp.as_maintenance();
  raise notice 'GROUP_CHANGES_AFTER_SCORES_PASS scored players, locked groups and started team scoring are frozen at the server; late unscored players can still join an active group; reset frees it; maintenance unaffected';
end $$;
rollback;
