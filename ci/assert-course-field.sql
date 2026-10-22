-- 0215 (212.18): course_field_averages — averages only, enough play to stay anonymous, the club's own active members only.
begin;
do $$
declare m1 uuid := '21500000-0000-0000-0000-000000000001'; m2 uuid := '21500000-0000-0000-0000-000000000002';
        m3 uuid := '21500000-0000-0000-0000-000000000003'; sus uuid := '21500000-0000-0000-0000-000000000004';
        out uuid := '21500000-0000-0000-0000-000000000005';
        ga uuid := '21500000-0000-0000-0000-0000000000c1'; gb uuid := '21500000-0000-0000-0000-0000000000c2';
        r uuid; k int; u uuid; v jsonb; ok boolean;
begin
  insert into auth.users(id, email) select x, x::text || '@cf.test' from unnest(array[m1, m2, m3, sus, out]) x;
  insert into profiles(id, display_name, email, account_status) values (m1, 'M1', 'm1@cf.test', 'active'), (m2, 'M2', 'm2@cf.test', 'active'),
    (m3, 'M3', 'm3@cf.test', 'active'), (sus, 'Sus', 'sus@cf.test', 'suspended'), (out, 'Out', 'out@cf.test', 'active');
  insert into groups(id, name, status, created_by) values (ga, 'CF Club', 'active', m1), (gb, 'CF Other', 'active', out);
  insert into group_members(group_id, user_id, email, role, status) values (ga, m1, 'm1@cf.test', 'admin', 'active'), (ga, m2, 'm2@cf.test', 'member', 'active'),
    (ga, m3, 'm3@cf.test', 'member', 'active'), (ga, sus, 'sus@cf.test', 'member', 'active'), (gb, out, 'out@cf.test', 'admin', 'active');
  -- 6 rounds at "Oak Hollow" by 3 members (hole 1: 5 on a par 4 every time → +1.00); 4 rounds at "Elm" by 2 members
  for k in 1..6 loop
    u := (array[m1, m2, m3])[1 + (k % 3)];
    insert into rounds(id, user_id, group_id, course, played_at, status) values (gen_random_uuid(), u, ga, case when k % 2 = 0 then 'Oak Hollow' else ' oak  hollow' end, now() - (k || ' days')::interval, 'final') returning id into r;
    insert into holes(round_id, hole_number, par, stroke_index, strokes, penalties) select r, h, 4, h, case when h = 1 then 5 else 4 end, 0 from generate_series(1, 18) h;
  end loop;
  for k in 1..4 loop
    insert into rounds(id, user_id, group_id, course, played_at, status) values (gen_random_uuid(), (array[m1, m2])[1 + (k % 2)], ga, 'Elm', now() - (k || ' days')::interval, 'final') returning id into r;
    insert into holes(round_id, hole_number, par, stroke_index, strokes, penalties) select r, h, 4, h, 4, 0 from generate_series(1, 18) h;
  end loop;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', m1::text, true);
  v := public.course_field_averages(ga, 'OAK HOLLOW');
  if not (v ->> 'enough')::boolean or (v ->> 'rounds')::int <> 6 or (v ->> 'players')::int <> 3 then raise exception 'Oak Hollow should have enough play (6 rounds, 3 members, spelling-insensitive): %', v; end if;
  if (v -> 'holes' -> 0 ->> 'avg_to_par')::numeric <> 1.00 or jsonb_array_length(v -> 'holes') <> 18 then raise exception 'hole averages wrong: %', v -> 'holes' -> 0; end if;
  if v::text ~ 'M1|M2|M3|21500000' then raise exception 'course averages leaked a member: %', v; end if;
  v := public.course_field_averages(ga, 'Elm');
  if (v ->> 'enough')::boolean or jsonb_array_length(v -> 'holes') <> 0 then raise exception 'Elm (2 members) must return nothing: %', v; end if;
  -- another club's member, and a suspended member, are refused
  perform set_config('request.jwt.claim.sub', out::text, true);
  begin perform public.course_field_averages(ga, 'Oak Hollow'); ok := false; exception when others then ok := sqlstate = '42501'; end;
  if not ok then raise exception 'a member of another club read this club''s course averages'; end if;
  perform set_config('request.jwt.claim.sub', sus::text, true);
  begin perform public.course_field_averages(ga, 'Oak Hollow'); ok := false; exception when others then ok := sqlstate = '42501'; end;
  if not ok then raise exception 'a suspended member read course averages'; end if;
  execute 'reset role';
  if has_function_privilege('anon', 'public.course_field_averages(uuid, text)', 'execute') then raise exception 'signed-out visitors can call course_field_averages'; end if;
  raise notice 'COURSE_FIELD_PASS averages only (no member data); 5 rounds / 3 members or nothing; another club and a suspended member refused; not callable signed out';
end $$;
rollback;
