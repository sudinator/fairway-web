-- assert-club-round-standings.sql — 0237 (212.117): club_round_standings_data returns fellow members' final rounds with
-- holes only to a member, only for members who share, never for a non-member, and honours the Profile switch.
-- 0238 (212.130): the year boundary — a round timestamped late on December 31 (UTC) is in its year, not dropped and not
-- in the next; January 1 opens the next year. Boundary rows are explicit timestamptz values so the check does not
-- depend on the session's time zone (the local chain runs in America/New_York, Supabase in UTC).
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
-- 0238: the year boundary. Edge (sharing) has four rounds around New Year, as explicit UTC instants.
insert into auth.users(id, email) values ('23700000-0000-0000-0000-0000000000a4', 'edge@w.test');
insert into public.profiles(id, display_name, account_status, email) values ('23700000-0000-0000-0000-0000000000a4', 'Edge', 'active', 'edge@w.test');
insert into public.group_members(group_id, user_id, email, role, status) values
  ('23700000-0000-0000-0000-00000000c1b0', '23700000-0000-0000-0000-0000000000a4', 'edge@w.test', 'member', 'active');
insert into public.rounds(id, user_id, course, group_id, status, played_at, course_par, course_handicap) values
  ('23701000-0000-0000-0000-000000000011', '23700000-0000-0000-0000-0000000000a4', 'LastDay',     null, 'final', timestamptz '2026-12-31 23:30:00+00', 72, 10),
  ('23701000-0000-0000-0000-000000000012', '23700000-0000-0000-0000-0000000000a4', 'FirstDay',    null, 'final', timestamptz '2026-01-01 00:00:00+00', 72, 10),
  ('23701000-0000-0000-0000-000000000013', '23700000-0000-0000-0000-0000000000a4', 'NextYear',    null, 'final', timestamptz '2027-01-01 00:00:00+00', 72, 10),
  ('23701000-0000-0000-0000-000000000014', '23700000-0000-0000-0000-0000000000a4', 'PriorYear',   null, 'final', timestamptz '2025-12-31 23:59:59+00', 72, 10),
  ('23701000-0000-0000-0000-000000000015', '23700000-0000-0000-0000-0000000000a4', 'DateOnly',    null, 'final', timestamptz '2026-12-31 00:00:00+00', 72, 10);
-- a member reads: the sharer's 2026 final round and its hole; not the private member's, not last year's, not the open one
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23700000-0000-0000-0000-0000000000a0","role":"authenticated"}', true);
do $$
declare v jsonb; n_rounds int; n_holes int; who text;
begin
  v := public.club_round_standings_data('23700000-0000-0000-0000-00000000c1b0', 2026);
  -- (Edge's boundary rounds, 0238, are checked separately below)
  select count(*), string_agg(x->>'display_name', ',') into n_rounds, who from jsonb_array_elements(v->'rounds') x where x->>'display_name' <> 'Edge';
  select count(*) into n_holes from jsonb_array_elements(v->'holes') h where (h->>'round_id') in ('23701000-0000-0000-0000-000000000001', '23701000-0000-0000-0000-000000000002');
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
-- 0238: the year boundary (Edge's rows are inserted with the fixture above, before the member role is assumed)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23700000-0000-0000-0000-0000000000a0","role":"authenticated"}', true);
do $$
declare v jsonb; courses text;
begin
  v := public.club_round_standings_data('23700000-0000-0000-0000-00000000c1b0', 2026);
  select string_agg(x->>'course', ',' order by x->>'course') into courses from jsonb_array_elements(v->'rounds') x where x->>'display_name' = 'Edge';
  if courses is distinct from 'DateOnly,FirstDay,LastDay' then raise exception '2026 should hold Edge''s DateOnly, FirstDay and LastDay rounds, got %', courses; end if;
  v := public.club_round_standings_data('23700000-0000-0000-0000-00000000c1b0', 2027);
  select string_agg(x->>'course', ',' order by x->>'course') into courses from jsonb_array_elements(v->'rounds') x where x->>'display_name' = 'Edge';
  if courses is distinct from 'NextYear' then raise exception '2027 should hold only Edge''s NextYear round, got %', courses; end if;
  v := public.club_round_standings_data('23700000-0000-0000-0000-00000000c1b0', 2025);
  select string_agg(x->>'course', ',' order by x->>'course') into courses from jsonb_array_elements(v->'rounds') x where x->>'display_name' = 'Edge';
  if courses is distinct from 'PriorYear' then raise exception '2025 should hold only Edge''s PriorYear round, got %', courses; end if;
end $$;
reset role;
-- the switch: once the private member shares, their round appears
update public.profiles set share_rounds_with_club = true where id = '23700000-0000-0000-0000-0000000000a2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23700000-0000-0000-0000-0000000000a0","role":"authenticated"}', true);
do $$
declare v jsonb; n int;
begin
  v := public.club_round_standings_data('23700000-0000-0000-0000-00000000c1b0', 2026);
  select count(*) into n from jsonb_array_elements(v->'rounds') x where x->>'display_name' in ('Sharer', 'Private');
  if n is distinct from 2 then raise exception 'expected both members once both share, got %', n; end if;
end $$;
reset role;
rollback;
