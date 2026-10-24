-- 0218 (212.36): the public live feed carries the skins setting, so the live page scores skins as the app does.
begin;
insert into auth.users(id, email) values ('21800000-0000-0000-0000-000000000001', 'live218@test.test');
insert into public.profiles(id, display_name, account_status) values ('21800000-0000-0000-0000-000000000001', 'Org 218', 'active');
insert into public.games(id, code, name, course, holes_meta, game_type, status, created_by, skins_mode, share_token) values
 ('21800000-0000-0000-0000-0000000000a1', '218218', 'Skins halved', 'C', '[{"n":1,"par":4,"si":1}]', 'skins', 'active', '21800000-0000-0000-0000-000000000001', 'split', 'live218-token-0123456789'),
 ('21800000-0000-0000-0000-0000000000a2', '218219', 'Skins carry', 'C', '[{"n":1,"par":4,"si":1}]', 'skins', 'active', '21800000-0000-0000-0000-000000000001', 'carryover', 'live219-token-0123456789');
do $$
declare r jsonb; s jsonb;
begin
  execute 'set local role anon';   -- the public share page reads as anon
  r := public.get_live_scorecard('live218-token-0123456789');
  s := public.get_live_scorecard('live219-token-0123456789');
  execute 'reset role';
  if r is null or r -> 'game' ->> 'skins_mode' is distinct from 'split' then raise exception 'the live feed lacks skins_mode = split: %', r -> 'game'; end if;
  if s -> 'game' ->> 'skins_mode' is distinct from 'carryover' then raise exception 'the live feed lacks skins_mode = carryover'; end if;
  -- nothing else went missing: the settings the page already used are all still there
  if not (r -> 'game' ? 'team_score_mode' and r -> 'game' ? 'allowance_pct' and r -> 'game' ? 'game_type' and r ? 'pairings' and r ? 'foursomes' and r ? 'players') then
    raise exception 'the live feed lost a field it used to carry: %', r;
  end if;
  if public.get_live_scorecard('short') is not null then raise exception 'a short token returned a game'; end if;
  raise notice 'LIVE_SKINS_PASS the public live feed carries skins_mode (split and carryover), every field it carried before, and still refuses bad tokens';
end $$;
rollback;
