-- assert-deleted-game-truth.sql — 0242 (212.135): a deleted game is told apart from a hidden one; the Profile learns each
-- game's state only for games the member was in; admin_reopen_game refuses a missing game instead of "succeeding";
-- the admin actions record the device that made them. Anon has nothing (checked by privilege — never a role switch).
begin;
insert into auth.users(id, email) values
  ('24200000-0000-0000-0000-0000000000a1', 'admin@w.test'), ('24200000-0000-0000-0000-0000000000a2', 'member@w.test'), ('24200000-0000-0000-0000-0000000000a3', 'outsider@w.test');
insert into public.profiles(id, display_name, account_status, email, is_admin) values
  ('24200000-0000-0000-0000-0000000000a1', 'Admin', 'active', 'admin@w.test', true), ('24200000-0000-0000-0000-0000000000a2', 'Member', 'active', 'member@w.test', false),
  ('24200000-0000-0000-0000-0000000000a3', 'Outsider', 'active', 'outsider@w.test', false);
insert into public.scoring_devices(user_id, token) values ('24200000-0000-0000-0000-0000000000a1', '24200000-0000-0000-0000-00000000d001');
insert into public.games(id, code, name, course, created_by, status, game_type, course_par, holes_meta) values
  ('24201000-0000-0000-0000-000000000001', '242001', 'Ended game', 'C', '24200000-0000-0000-0000-0000000000a2', 'ended', 'stableford', 72, '[]'::jsonb),
  ('24201000-0000-0000-0000-000000000002', '242002', 'Active game', 'C', '24200000-0000-0000-0000-0000000000a2', 'active', 'stableford', 72, '[]'::jsonb),
  ('24201000-0000-0000-0000-000000000003', '242003', 'Not my game', 'C', '24200000-0000-0000-0000-0000000000a3', 'active', 'stableford', 72, '[]'::jsonb);
insert into public.game_players(game_id, user_id, display_name) values
  ('24201000-0000-0000-0000-000000000001', '24200000-0000-0000-0000-0000000000a2', 'Member'),
  ('24201000-0000-0000-0000-000000000002', '24200000-0000-0000-0000-0000000000a2', 'Member'),
  ('24201000-0000-0000-0000-000000000003', '24200000-0000-0000-0000-0000000000a3', 'Outsider');
-- the member asks
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24200000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '24200000-0000-0000-0000-0000000000a2', true);
do $$
declare n int; st text;
begin
  if not public.game_exists('24201000-0000-0000-0000-000000000001') then raise exception 'an existing game must exist'; end if;
  if not public.game_exists('24201000-0000-0000-0000-000000000003') then raise exception 'game_exists answers for any id the caller holds (one bit; not membership)'; end if;
  if public.game_exists('24201000-0000-0000-0000-0000000000ff') then raise exception 'a missing game must not exist'; end if;
  select count(*) into n from public.games_states(array['24201000-0000-0000-0000-000000000001', '24201000-0000-0000-0000-000000000002', '24201000-0000-0000-0000-000000000003', '24201000-0000-0000-0000-0000000000ff']::uuid[]);
  if n is distinct from 3 then raise exception 'games_states returns every existing game asked about (expected 3, got %)', n; end if;
  select count(*) into n from public.games_states(array['24201000-0000-0000-0000-000000000001', '24201000-0000-0000-0000-000000000002', '24201000-0000-0000-0000-000000000003']::uuid[]) where status = 'not_member';
  if n is distinct from 1 then raise exception 'a game the member is not in reads not_member, nothing more (expected 1, got %)', n; end if;
  select status into st from public.games_states(array['24201000-0000-0000-0000-000000000001']::uuid[]);
  if st is distinct from 'ended' then raise exception 'games_states must report the status (got %)', st; end if;
end $$;
reset role;
-- the admin reopens and deletes, from a known device; a missing game is refused, not "reopened"
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24200000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '24200000-0000-0000-0000-0000000000a1', true);
select set_config('request.headers', '{"x-bnn-scoring-device":"24200000-0000-0000-0000-00000000d001","x-bnn-device-id":"24200000-0000-0000-0000-0000000000ee","x-bnn-device-name":"iPhone - home-screen app"}', true);
do $$
declare denied boolean := false; st text; dev jsonb; n int;
begin
  begin perform public.admin_reopen_game('24201000-0000-0000-0000-0000000000ff'); exception when no_data_found then denied := true; end;
  if not denied then raise exception 'reopening a missing game must raise Game not found'; end if;
  select count(*) into n from public.activity_log where summary ilike '%reopened%' and actor_id = '24200000-0000-0000-0000-0000000000a1';
  if n is distinct from 0 then raise exception 'a refused reopen must not be logged as done'; end if;
  perform public.admin_reopen_game('24201000-0000-0000-0000-000000000001');
  select status into st from public.games where id = '24201000-0000-0000-0000-000000000001';
  if st is distinct from 'active' then raise exception 'reopen must set the game active (got %)', st; end if;
  select details->'device' into dev from public.activity_log where summary ilike '%reopened game "Ended game"%' order by created_at desc limit 1;
  if dev->>'token' is distinct from '24200000-0000-0000-0000-00000000d001' or dev->>'id' is distinct from '24200000-0000-0000-0000-0000000000ee' or dev->>'name' is distinct from 'iPhone - home-screen app' then raise exception 'the reopen must record the device that did it — token, id and name (got %)', dev; end if;
  perform public.admin_delete_game('24201000-0000-0000-0000-000000000001');
  if public.game_exists('24201000-0000-0000-0000-000000000001') then raise exception 'the deleted game must be gone'; end if;
  select details->'device' into dev from public.activity_log where summary ilike '%deleted game "Ended game"%' order by created_at desc limit 1;
  if dev->>'token' is distinct from '24200000-0000-0000-0000-00000000d001' or dev->>'name' is distinct from 'iPhone - home-screen app' then raise exception 'the delete must record the device that did it (got %)', dev; end if;
  denied := false;
  begin perform public.admin_delete_game('24201000-0000-0000-0000-000000000001'); exception when no_data_found then denied := true; end;
  if not denied then raise exception 'deleting an already-deleted game must raise Game not found'; end if;
  -- (owner) EVERY activity row carries the device: a plain client insert with no details, one with other details, and
  -- one that already names a device (kept as sent)
  insert into public.activity_log (actor_id, actor_name, action, summary) values ('24200000-0000-0000-0000-0000000000a1', 'Admin', 'game_created', 'stamp test 1');
  insert into public.activity_log (actor_id, actor_name, action, summary, details) values ('24200000-0000-0000-0000-0000000000a1', 'Admin', 'game_created', 'stamp test 2', '{"game_id":"x"}');
  insert into public.activity_log (actor_id, actor_name, action, summary, details) values ('24200000-0000-0000-0000-0000000000a1', 'Admin', 'game_created', 'stamp test 3', '{"device":{"id":"client-said","name":"Mac - Safari"}}');
  select details->'device' into dev from public.activity_log where summary = 'stamp test 1';
  if dev->>'id' is distinct from '24200000-0000-0000-0000-0000000000ee' or dev->>'name' is distinct from 'iPhone - home-screen app' then raise exception 'a client-written row with no details must be stamped with the device (got %)', dev; end if;
  select details into dev from public.activity_log where summary = 'stamp test 2';
  if dev->>'game_id' is distinct from 'x' or dev->'device'->>'id' is distinct from '24200000-0000-0000-0000-0000000000ee' then raise exception 'a row with other details keeps them and gains the device (got %)', dev; end if;
  select details->'device' into dev from public.activity_log where summary = 'stamp test 3';
  if dev->>'id' is distinct from 'client-said' then raise exception 'a device the row already names is kept (got %)', dev; end if;
end $$;
reset role;
-- no request (a scheduled job): no device, not a fabricated one
select set_config('request.headers', '', true);
do $$ declare dev jsonb; begin
  insert into public.activity_log (actor_id, actor_name, action, summary) values ('24200000-0000-0000-0000-0000000000a1', 'Admin', 'game_created', 'stamp test 4');
  select details into dev from public.activity_log where summary = 'stamp test 4';
  if dev is not null then raise exception 'a row written outside a request must carry no device (got %)', dev; end if;
end $$;
reset role;
-- a member is refused the admin actions; anon has nothing (by privilege)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24200000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '24200000-0000-0000-0000-0000000000a2', true);
do $$ declare denied boolean := false; begin
  begin perform public.admin_reopen_game('24201000-0000-0000-0000-000000000002'); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a member must not reopen a game'; end if;
end $$;
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.game_exists(uuid)', 'execute') or has_function_privilege('anon', 'public.games_states(uuid[])', 'execute') then raise exception 'anon must not call the game-state functions'; end if;
  if has_function_privilege('authenticated', 'public.request_device()', 'execute') or has_function_privilege('authenticated', 'public.activity_log_stamp_device()', 'execute') then raise exception 'members must not call the device helpers directly'; end if;
end $$;
rollback;
