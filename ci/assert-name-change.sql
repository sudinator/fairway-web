-- assert-name-change.sql — 0232 (212.76 audit 4): a member's current profile changes; existing game names remain snapshots (0233).
begin;
insert into auth.users(id, email) values ('23200000-0000-0000-0000-0000000000a0', 'renamer@w.test'), ('23200000-0000-0000-0000-0000000000a1', 'other@w.test');
insert into public.profiles(id, display_name, account_status, email) values ('23200000-0000-0000-0000-0000000000a0', 'Old Name', 'active', 'renamer@w.test'), ('23200000-0000-0000-0000-0000000000a1', 'Other Member', 'active', 'other@w.test');
insert into public.groups(id, name, created_by) values ('23200000-0000-0000-0000-00000000c1b0', 'Club', '23200000-0000-0000-0000-0000000000a0');
insert into public.games(id, code, group_id, name, course, course_par, played_at, created_by, status, game_type, holes_meta)
  values ('23201000-0000-0000-0000-000000000001', '232001', '23200000-0000-0000-0000-00000000c1b0', 'Ended game', 'Oak', 72, '2026-10-01', '23200000-0000-0000-0000-0000000000a0', 'ended', 'stableford', '[]'::jsonb),
         ('23201000-0000-0000-0000-000000000002', '232002', '23200000-0000-0000-0000-00000000c1b0', 'Open game', 'Oak', 72, '2026-11-01', '23200000-0000-0000-0000-0000000000a0', 'active', 'stableford', '[]'::jsonb);
insert into public.game_players(id, game_id, user_id, display_name, is_guest) values
  ('23202000-0000-0000-0000-000000000001', '23201000-0000-0000-0000-000000000001', '23200000-0000-0000-0000-0000000000a0', 'Old Name', false),
  ('23202000-0000-0000-0000-000000000002', '23201000-0000-0000-0000-000000000002', '23200000-0000-0000-0000-0000000000a0', 'Old Name', false),
  ('23202000-0000-0000-0000-000000000003', '23201000-0000-0000-0000-000000000002', '23200000-0000-0000-0000-0000000000a1', 'Other Member', false);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23200000-0000-0000-0000-0000000000a0","role":"authenticated"}', true);
select public.set_my_display_name('New Name');
reset role;
do $$
declare n_prof text; n_games int; n_other text;
begin
  select display_name into n_prof from profiles where id = '23200000-0000-0000-0000-0000000000a0';
  select count(*) into n_games from game_players where user_id = '23200000-0000-0000-0000-0000000000a0' and display_name = 'Old Name';
  select display_name into n_other from game_players where id = '23202000-0000-0000-0000-000000000003';
  if n_prof is distinct from 'New Name' then raise exception 'the profile should carry the new name (got %)', n_prof; end if;
  if n_games <> 2 then raise exception 'existing game rows must keep their saved name (got % of 2)', n_games; end if;
  if n_other is distinct from 'Other Member' then raise exception 'another member''s row must not change (got %)', n_other; end if;
  raise notice 'NAME_CHANGE_PASS profile updated, existing game snapshots preserved; nobody else''s';
end $$;
rollback;
