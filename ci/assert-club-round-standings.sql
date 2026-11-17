-- assert-club-round-standings.sql — 0237 (212.117): club_round_standings_data returns fellow members' final rounds with
-- holes only to a member, only for members who share, never for a non-member, and honours the Profile switch.
begin;
insert into auth.users(id, email) values
  ('23700000-0000-0000-0000-0000000000a0', 'member@w.test'), ('23700000-0000-0000-0000-0000000000a1', 'sharer@w.test'),
  ('23700000-0000-0000-0000-0000000000a2', 'private@w.test'), ('23700000-0000-0000-0000-0000000000a3', 'outsider@w.test');
insert into public.profiles(id, display_name, account_status, email) values
  ('23700000-0000-0000-0000-0000000000a0', 'Member', 'active', 'member@w.test'), ('23700000-0000-0000-0000-0000000000a1', 'Sharer', 'active', 'sharer@w.test'),
  ('23700000-0000-0000-0000-0000000000a2', 'Private', 'active', 'private@w.test'), ('23700000-0000-0000-0000-0000000000a3', 'Outsider', 'active', 'outsider@w.test');
update public.profiles set share_rounds_with_club = false where id = '23700000-0000-0000-0000-0000000000a2';
insert into public.groups(id, name, created_by) values ('23700000-0000-0000-0000-00000000c1b0', 'Club', '23700000-0000-0000-0000-0000000000a0');
insert into public.group_members(group_id, user_id, email, role, status) values
  ('23700000-0000-0000-0000-00000000c1b0', '23700000-0000-0000-0000-0000000000a0', 'member@w.test', 'member', 'active'),
  ('23700000-0000-0000-0000-00000000c1b0', '23700000-0000-0000-0000-0000000000a1', 'sharer@w.test', 'member', 'active'),
  ('23700000-0000-0000-0000-00000000c1b0', '23700000-0000-0000-0000-0000000000a2', 'private@w.test', 'member', 'active');
insert into public.rounds(id, user_id, course, group_id, status, played_at, course_par, course_handicap) values
  ('23701000-0000-0000-0000-000000000001', '23700000-0000-0000-0000-0000000000a1', 'Oak', null, 'final', '2026-06-01', 72, 10),
  ('23701000-0000-0000-0000-000000000002', '23700000-0000-0000-0000-0000000000a2', 'Oak', null, 'final', '2026-06-02', 72, 10),
  ('23701000-0000-0000-0000-000000000003', '23700000-0000-0000-0000-0000000000a1', 'Oak', null, 'final', '2025-06-01', 72, 10),
  ('23701000-0000-0000-0000-000000000004', '23700000-0000-0000-0000-0000000000a1', 'Oak', null, 'in_progress', '2026-06-03', 72, 10);
insert into public.holes(id, round_id, hole_number, par, stroke_index, strokes, putts) values
  ('23702000-0000-0000-0000-000000000001', '23701000-0000-0000-0000-000000000001', 1, 4, 1, 5, 2),
  ('23702000-0000-0000-0000-000000000002', '23701000-0000-0000-0000-000000000002', 1, 4, 1, 4, 2);
-- a member reads: the sharer's 2026 final round and its hole; not the private member's, not last year's, not the open one
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23700000-0000-0000-0000-0000000000a0","role":"authenticated"}', true);
do $$
declare v jsonb; n_rounds int; n_holes int; who text;
begin
  v := public.club_round_standings_data('23700000-0000-0000-0000-00000000c1b0', 2026);
  n_rounds := jsonb_array_length(v->'rounds'); n_holes := jsonb_array_length(v->'holes');
  select string_agg(x->>'display_name', ',') into who from jsonb_array_elements(v->'rounds') x;
  if n_rounds <> 1 or who <> 'Sharer' then raise exception 'expected only the sharer''s 2026 final round, got % (%)', n_rounds, who; end if;
  if n_holes <> 1 or (v->'holes'->0->>'strokes')::int <> 5 then raise exception 'expected the sharer''s hole, got %', n_holes; end if;
end $$;
-- an outsider is refused
select set_config('request.jwt.claims', '{"sub":"23700000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$
begin
  perform public.club_round_standings_data('23700000-0000-0000-0000-00000000c1b0', 2026);
  raise exception 'outsider should have been refused';
exception when insufficient_privilege then null;
end $$;
reset role;
-- the switch: once the private member shares, their round appears
update public.profiles set share_rounds_with_club = true where id = '23700000-0000-0000-0000-0000000000a2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23700000-0000-0000-0000-0000000000a0","role":"authenticated"}', true);
do $$
declare v jsonb;
begin
  v := public.club_round_standings_data('23700000-0000-0000-0000-00000000c1b0', 2026);
  if jsonb_array_length(v->'rounds') <> 2 then raise exception 'expected both members once both share, got %', jsonb_array_length(v->'rounds'); end if;
end $$;
reset role;
rollback;
