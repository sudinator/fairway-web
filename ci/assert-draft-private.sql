-- assert-draft-private.sql — 0220 (212.41): a saved DRAFT is private at the server until it is sent to its players.
begin;
insert into auth.users(id, email) values
 ('22000000-0000-0000-0000-0000000000a0', 'org@d.test'), ('22000000-0000-0000-0000-0000000000a1', 'player@d.test'),
 ('22000000-0000-0000-0000-0000000000a2', 'clubmate@d.test'), ('22000000-0000-0000-0000-0000000000a3', 'clubadmin@d.test'),
 ('22000000-0000-0000-0000-0000000000a9', 'outsider@d.test');
insert into public.profiles(id, display_name, account_status) values
 ('22000000-0000-0000-0000-0000000000a0', 'Org', 'active'), ('22000000-0000-0000-0000-0000000000a1', 'Player', 'active'),
 ('22000000-0000-0000-0000-0000000000a2', 'Clubmate', 'active'), ('22000000-0000-0000-0000-0000000000a3', 'Club Admin', 'active'),
 ('22000000-0000-0000-0000-0000000000a9', 'Outsider', 'active');
insert into public.groups(id, name, created_by) values ('22000000-0000-0000-0000-00000000c1b0', 'Draft Club', '22000000-0000-0000-0000-0000000000a3');
insert into public.group_members(group_id, user_id, email, role, status) values
 ('22000000-0000-0000-0000-00000000c1b0', '22000000-0000-0000-0000-0000000000a0', 'org@d.test', 'member', 'active'),
 ('22000000-0000-0000-0000-00000000c1b0', '22000000-0000-0000-0000-0000000000a1', 'player@d.test', 'member', 'active'),
 ('22000000-0000-0000-0000-00000000c1b0', '22000000-0000-0000-0000-0000000000a2', 'clubmate@d.test', 'member', 'active'),
 ('22000000-0000-0000-0000-00000000c1b0', '22000000-0000-0000-0000-0000000000a3', 'clubadmin@d.test', 'admin', 'active');

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.sees(u text, g uuid) returns text language plpgsql as $$
declare n_game int; n_players int;
begin
  perform pg_temp.as_user(u);
  select count(*) into n_game from public.games where id = g;
  select count(*) into n_players from public.game_players where game_id = g;
  execute 'reset role';
  return n_game || '/' || n_players;
end $$;

do $$
declare
  org text := '22000000-0000-0000-0000-0000000000a0'; player text := '22000000-0000-0000-0000-0000000000a1';
  mate text := '22000000-0000-0000-0000-0000000000a2'; adm text := '22000000-0000-0000-0000-0000000000a3';
  outsider text := '22000000-0000-0000-0000-0000000000a9';
  club uuid := '22000000-0000-0000-0000-00000000c1b0';
  draft uuid := '22001000-0000-0000-0000-000000000001'; sent uuid := '22001000-0000-0000-0000-000000000002';
  holes jsonb := '[{"n":1,"par":4,"si":1}]'; v text; ok boolean; n int;
begin
  -- the organizer saves a DRAFT (with the player in it), and creates a normal game alongside
  perform pg_temp.as_user(org);
  perform public.create_game_complete(jsonb_build_object('id', draft, 'code', '220001', 'name', 'Draft', 'course', 'C', 'holes_meta', holes, 'game_type', 'stableford', 'group_id', club),
    jsonb_build_array(jsonb_build_object('id', '22002000-0000-0000-0000-000000000001', 'user_id', org, 'display_name', 'Org'),
                      jsonb_build_object('id', '22002000-0000-0000-0000-000000000002', 'user_id', player, 'display_name', 'Player')), '[]', '[]', null, false);
  perform public.create_game_complete(jsonb_build_object('id', sent, 'code', '220002', 'name', 'Sent', 'course', 'C', 'holes_meta', holes, 'game_type', 'stableford', 'group_id', club),
    jsonb_build_array(jsonb_build_object('id', '22002000-0000-0000-0000-000000000003', 'user_id', org, 'display_name', 'Org')), '[]', '[]', null, true);
  execute 'reset role';

  -- who can see the DRAFT (game rows / player rows)
  v := pg_temp.sees(org, draft);      if v is distinct from '1/2' then raise exception 'organizer should see the draft: %', v; end if;
  -- 0223 (owner, Oct 26: "Organizer + system admins only"): a club admin who isn't the organizer doesn't see a draft
  -- either — "only I see it until I send it". (An announced club game they still see, as before — checked below.)
  v := pg_temp.sees(adm, draft);      if v is distinct from '0/0' then raise exception 'a club admin (not the organizer) should NOT see the draft: %', v; end if;
  if pg_temp.sees(adm, sent) is distinct from '1/0' then raise exception 'club admin access to an announced game changed: %', pg_temp.sees(adm, sent); end if;
  v := pg_temp.sees(player, draft);   if v is distinct from '0/0' then raise exception 'a player in the draft must not see it yet: %', v; end if;
  v := pg_temp.sees(mate, draft);     if v is distinct from '0/0' then raise exception 'a clubmate must not see the draft: %', v; end if;
  v := pg_temp.sees(outsider, draft); if v is distinct from '0/0' then raise exception 'an outsider must not see the draft: %', v; end if;
  -- signed-out visitors can't read the games table at all (no table grant) — let alone a draft
  execute 'set local role anon';
  begin
    if (select count(*) from public.games where id = draft) is distinct from 0 then raise exception 'anon sees the draft'; end if;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  -- the normal game: every existing rule unchanged (a clubmate can see a club game, as before)
  v := pg_temp.sees(mate, sent);      if v is distinct from '1/0' then raise exception 'an announced game should stay visible to the club as before (game yes, player list no): %', v; end if;

  -- nobody else can write to the draft: not join it, not edit their own row in it
  perform pg_temp.as_user(mate);
  begin insert into public.game_players(game_id, user_id, display_name) values (draft, mate::uuid, 'Clubmate'); ok := false;
  exception when others then ok := true; end;
  execute 'reset role';
  if not ok then raise exception 'a clubmate joined the draft'; end if;
  perform pg_temp.as_user(player);
  update public.game_players set tee_name = 'Red' where game_id = draft and user_id = player::uuid;
  get diagnostics n = row_count;
  execute 'reset role';
  if n is distinct from 0 then raise exception 'a player changed their row in the draft'; end if;

  -- nothing can be shared while it's a draft
  perform pg_temp.as_user(org);
  begin perform public.set_game_share(draft, true); ok := false;
  exception when others then ok := sqlerrm like '%send the game to its players before sharing%'; end;
  execute 'reset role';
  if not ok then raise exception 'a draft was shared'; end if;

  -- SEND TO PLAYERS: now it's an ordinary game — the player sees it, the club sees it, it can be shared
  perform pg_temp.as_user(org);
  perform public.announce_game_players(draft);
  if public.set_game_share(draft, true) is null then raise exception 'a sent game could not be shared'; end if;
  execute 'reset role';
  v := pg_temp.sees(player, draft);   if v is distinct from '1/2' then raise exception 'after sending, the player should see it: %', v; end if;
  v := pg_temp.sees(mate, draft);     if v is distinct from '1/0' then raise exception 'after sending, the club should see it as any game (game yes, player list no): %', v; end if;

  raise notice 'DRAFT_PRIVATE_PASS a draft is seen only by its organizer and system admins (not club admins, its players, clubmates, outsiders or anon); nobody else can join or edit it; it cannot be shared; once sent it behaves like any game';
end $$;
rollback;
