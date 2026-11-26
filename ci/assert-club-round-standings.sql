-- assert-club-round-standings.sql — club_round_standings_data (0237 · 0238 · 0239).
--  0237 (212.117): fellow members' final rounds of the year, only to a member, only for members who share, never for a
--    non-member; the Profile switch is honoured.
--  0238 (212.130): the year boundary — a round timestamped late on December 31 (UTC) is in its year, not dropped and not
--    in the next; January 1 opens the next year. Boundary rows are explicit timestamptz values so the check does not
--    depend on the session's time zone (the local chain runs in America/New_York, Supabase in UTC).
--  0239 (212.131): ONE SUMMARY ROW PER ROUND, NEVER HOLES — the owner's "aggregates and ranking only". The summary's
--    arithmetic is held to lib/season-rounds summarizeRound: the fixture rounds below (the same two rounds are built in
--    lib/season-rounds.test.ts, which asserts the same literal figures), and the stroke-allocation table, generated from
--    lib/golf allocateStrokes (ci/test-rounds-summary-parity.cjs regenerates it and fails on drift).
begin;
insert into auth.users(id, email) values
  ('23700000-0000-0000-0000-0000000000a0', 'member@w.test'), ('23700000-0000-0000-0000-0000000000a1', 'sharer@w.test'),
  ('23700000-0000-0000-0000-0000000000a2', 'private@w.test'), ('23700000-0000-0000-0000-0000000000a3', 'outsider@w.test'),
  ('23700000-0000-0000-0000-0000000000a4', 'edge@w.test');
insert into public.profiles(id, display_name, account_status, email) values
  ('23700000-0000-0000-0000-0000000000a0', 'Member', 'active', 'member@w.test'), ('23700000-0000-0000-0000-0000000000a1', 'Sharer', 'active', 'sharer@w.test'),
  ('23700000-0000-0000-0000-0000000000a2', 'Private', 'active', 'private@w.test'), ('23700000-0000-0000-0000-0000000000a3', 'Outsider', 'active', 'outsider@w.test'),
  ('23700000-0000-0000-0000-0000000000a4', 'Edge', 'active', 'edge@w.test');
update public.profiles set share_rounds_with_club = false where id = '23700000-0000-0000-0000-0000000000a2';
insert into public.groups(id, name, created_by) values ('23700000-0000-0000-0000-00000000c1b0', 'Club', '23700000-0000-0000-0000-0000000000a0');
insert into public.group_members(group_id, user_id, email, role, status) values
  ('23700000-0000-0000-0000-00000000c1b0', '23700000-0000-0000-0000-0000000000a0', 'member@w.test', 'member', 'active'),
  ('23700000-0000-0000-0000-00000000c1b0', '23700000-0000-0000-0000-0000000000a1', 'sharer@w.test', 'member', 'active'),
  ('23700000-0000-0000-0000-00000000c1b0', '23700000-0000-0000-0000-0000000000a2', 'private@w.test', 'member', 'active'),
  ('23700000-0000-0000-0000-00000000c1b0', '23700000-0000-0000-0000-0000000000a4', 'edge@w.test', 'member', 'active');
-- the fixture course (the same as lib/season-rounds.test.ts): par 4, with par 3 on every third hole and par 5 on every
-- fifth (par 68); stroke index = hole number
insert into public.rounds(id, user_id, course, group_id, status, played_at, course_par, course_handicap) values
  ('23701000-0000-0000-0000-000000000001', '23700000-0000-0000-0000-0000000000a1', 'Oak', null, 'final', '2026-06-01', 68, 12),   -- Sharer: bogeys, a birdie on 1
  ('23701000-0000-0000-0000-000000000002', '23700000-0000-0000-0000-0000000000a2', 'Oak', null, 'final', '2026-06-02', 68, 10),   -- Private: level par, no putts on 5
  ('23701000-0000-0000-0000-000000000003', '23700000-0000-0000-0000-0000000000a1', 'Oak', null, 'final', '2025-06-01', 68, 12),   -- last year
  ('23701000-0000-0000-0000-000000000004', '23700000-0000-0000-0000-0000000000a1', 'Oak', null, 'in_progress', '2026-06-03', 68, 12),   -- not final
  ('23701000-0000-0000-0000-000000000005', '23700000-0000-0000-0000-0000000000a1', 'Oak', null, 'final', '2026-06-04', 68, 12),   -- 15 holes only → no summary
  ('23701000-0000-0000-0000-000000000011', '23700000-0000-0000-0000-0000000000a4', 'LastDay',   null, 'final', timestamptz '2026-12-31 23:30:00+00', 68, 10),
  ('23701000-0000-0000-0000-000000000012', '23700000-0000-0000-0000-0000000000a4', 'FirstDay',  null, 'final', timestamptz '2026-01-01 00:00:00+00', 68, 10),
  ('23701000-0000-0000-0000-000000000013', '23700000-0000-0000-0000-0000000000a4', 'NextYear',  null, 'final', timestamptz '2027-01-01 00:00:00+00', 68, 10),
  ('23701000-0000-0000-0000-000000000014', '23700000-0000-0000-0000-0000000000a4', 'PriorYear', null, 'final', timestamptz '2025-12-31 23:59:59+00', 68, 10),
  ('23701000-0000-0000-0000-000000000015', '23700000-0000-0000-0000-0000000000a4', 'DateOnly',  null, 'final', timestamptz '2026-12-31 00:00:00+00', 68, 10);
do $$
declare rid uuid; i int; par int; rel int; putts int;
begin
  for rid in select id from public.rounds where id::text like '23701000-%' loop
    for i in 1..18 loop
      if rid = '23701000-0000-0000-0000-000000000005' and i > 15 then exit; end if;
      par := case when i % 3 = 0 then 3 when i % 5 = 0 then 5 else 4 end;
      rel := case when rid = '23701000-0000-0000-0000-000000000001' then (case when i = 1 then -1 else 1 end) else 0 end;
      putts := case when rid = '23701000-0000-0000-0000-000000000002' and i = 5 then null else 2 end;
      insert into public.holes(round_id, hole_number, par, stroke_index, strokes, putts) values (rid, i, par, i, par + rel, putts);
    end loop;
  end loop;
end $$;

-- 0239: the allocation rule in SQL equals lib/golf allocateStrokes. GENERATED by ci/test-rounds-summary-parity.cjs — do
-- not edit by hand. Each row: course handicap, then strokes on the holes ranked 1..18 (hardest first).
-- BEGIN ALLOCATION TABLE
do $$
declare rows_ text[][] := array[
  array['-3',    '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-1,-1,-1'],
  array['0',     '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0'],
  array['7',     '1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0'],
  array['10.5',  '1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0'],
  array['-10.5', '0,0,0,0,0,0,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1'],
  array['17',    '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0'],
  array['18',    '1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1'],
  array['19',    '2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1'],
  array['25',    '2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1'],
  array['36',    '2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2'],
  array['40',    '3,3,3,3,2,2,2,2,2,2,2,2,2,2,2,2,2,2']
]; r int; got text;
begin
  for r in 1..array_length(rows_, 1) loop
    select string_agg(public.club_round_strokes_on_hole(k, 18, rows_[r][1]::numeric)::text, ',' order by k) into got from generate_series(1, 18) k;
    if got is distinct from rows_[r][2] then raise exception 'allocation for handicap % differs from allocateStrokes: got %, expected %', rows_[r][1], got, rows_[r][2]; end if;
  end loop;
end $$;
-- END ALLOCATION TABLE

-- a member reads: summaries only, one per complete final round of the year by a sharing member
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23700000-0000-0000-0000-0000000000a0","role":"authenticated"}', true);
do $$
declare v jsonb; s jsonb; n int; who text; courses text;
begin
  v := public.club_round_standings_data('23700000-0000-0000-0000-00000000c1b0', 2026);
  if v ? 'holes' then raise exception 'the response must not carry holes (0239)'; end if;
  if exists (select 1 from jsonb_array_elements(v->'rounds') x where x ? 'holes' or x ? 'strokes' or x ? 'hole_number') then raise exception 'a round summary must not carry hole detail'; end if;
  select count(*), string_agg(x->>'display_name', ',') into n, who from jsonb_array_elements(v->'rounds') x where x->>'display_name' <> 'Edge';
  if n is distinct from 1 or who is distinct from 'Sharer' then raise exception 'expected only the sharer''s complete 2026 final round, got % (%)', n, who; end if;
  -- Sharer's round: par 68, bogeys with a birdie on 1 → gross 84, 36 putts; the birdie on the SI-1 hole with a stroke is a net eagle;
  -- the other seventeen holes are net par (SI ≤ 12) or net bogey → no net birdies; the par-or-better run is hole 1 alone
  select x into s from jsonb_array_elements(v->'rounds') x where x->>'id' = '23701000-0000-0000-0000-000000000001';
  if (s->>'par')::int is distinct from 68 or (s->>'gross')::int is distinct from 84 or (s->>'putts')::int is distinct from 36
     or (s->>'net_birdies')::int is distinct from 0 or (s->>'net_eagles')::int is distinct from 1 or (s->>'par_streak')::int is distinct from 1
     or (s->>'course_handicap')::int is distinct from 12 or s->>'course' is distinct from 'Oak' then
    raise exception 'Sharer''s summary is wrong: %', s;
  end if;
end $$;
-- an outsider is refused
select set_config('request.jwt.claims', '{"sub":"23700000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$
begin
  perform public.club_round_standings_data('23700000-0000-0000-0000-00000000c1b0', 2026);
  raise exception 'outsider should have been refused';
exception when insufficient_privilege then null;
end $$;
-- 0238: the year boundary (Edge's rounds)
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
-- the switch: once the private member shares, their round appears — level par, no putts on hole 5 → putts null;
-- ten net birdies (a stroke on SI 1–10), a par-or-better run of 18
update public.profiles set share_rounds_with_club = true where id = '23700000-0000-0000-0000-0000000000a2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23700000-0000-0000-0000-0000000000a0","role":"authenticated"}', true);
do $$
declare v jsonb; s jsonb; n int;
begin
  v := public.club_round_standings_data('23700000-0000-0000-0000-00000000c1b0', 2026);
  select count(*) into n from jsonb_array_elements(v->'rounds') x where x->>'display_name' in ('Sharer', 'Private');
  if n is distinct from 2 then raise exception 'expected both members once both share, got %', n; end if;
  select x into s from jsonb_array_elements(v->'rounds') x where x->>'id' = '23701000-0000-0000-0000-000000000002';
  if (s->>'gross')::int is distinct from 68 or s->'putts' is distinct from 'null'::jsonb or (s->>'net_birdies')::int is distinct from 10
     or (s->>'net_eagles')::int is distinct from 0 or (s->>'par_streak')::int is distinct from 18 then
    raise exception 'Private''s summary is wrong: %', s;
  end if;
end $$;
reset role;
rollback;
