-- 0180: club stats are aggregates for the caller's own clubs only, excluding cancelled rounds; the
-- Dec 31 notification goes to golfers with a round that year, once.
do $$
declare a uuid := '18000000-0000-0000-0000-000000000001'; b uuid := '18000000-0000-0000-0000-000000000002';
        x uuid := '18000000-0000-0000-0000-000000000003'; g1 uuid := '18000000-0000-0000-0000-000000000011';
        g2 uuid := '18000000-0000-0000-0000-000000000012'; j jsonb; n integer;
begin
  delete from notifications where user_id in (a, b, x) and type = 'season_wrapped';
  delete from rounds where user_id in (a, b, x) and course = 'Wrap CC';
  delete from group_members where group_id in (g1, g2); delete from groups where id in (g1, g2);
  delete from profiles where id in (a, b, x); delete from auth.users where id in (a, b, x);
  insert into auth.users(id,email) values (a,'wa@x.com'),(b,'wb@x.com'),(x,'wx@x.com');
  insert into profiles(id,display_name) values (a,'Ann'),(b,'Bob'),(x,'Xavier');
  insert into groups(id,name) values (g1,'Wrap Club'),(g2,'Other Club');
  insert into group_members(group_id,user_id,email,role,status) values (g1,a,'wa@x.com','member','active'),(g1,b,'wb@x.com','member','active'),(g2,x,'wx@x.com','member','active'),(g2,a,'wa@x.com','member','active');
  -- Ann plays in BOTH clubs: two rounds posted in Wrap Club, one in Other Club, one with no club.
  insert into rounds(user_id,course,played_at,status,group_id) values
    (a,'Wrap CC','2026-05-01','final',g1),(a,'Wrap CC','2026-06-01','final',g1),(a,'Wrap CC','2026-06-15','final',g2),(a,'Wrap CC','2026-06-20','final',null),
    (b,'Wrap CC','2026-07-01','final',g1),(x,'Wrap CC','2026-07-01','final',g2),
    (a,'Wrap CC','2025-05-01','final',g1);
  insert into rounds(user_id,course,played_at,status,deleted_at,group_id) values (a,'Wrap CC','2026-08-01','final', now(), g1);  -- cancelled

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  j := public.season_club_stats(2026);
  execute 'reset role';
  if jsonb_array_length(j) <> 2 then raise exception 'Ann belongs to two clubs: %', j; end if;
  -- ordered by name: Other Club, Wrap Club
  if (j->1->>'name') <> 'Wrap Club' or (j->1->>'total_rounds')::int <> 3 then raise exception 'Wrap Club rounds (cancelled / other-year / other-club excluded): %', j->1; end if;
  if (j->1->'rounds_by_member'->0->>'name') is distinct from 'Ann' or (j->1->'rounds_by_member'->0->>'rounds')::int <> 2 then raise exception 'Ann in Wrap Club: %', j->1->'rounds_by_member'; end if;
  if (j->0->>'total_rounds')::int <> 2 then raise exception 'Other Club: rounds posted there only: %', j->0; end if;
  if (select (m->>'rounds')::int from jsonb_array_elements(j->0->'rounds_by_member') m where m->>'name' = 'Ann') is distinct from 1 then raise exception 'Ann counted once per club she played in, not per membership'; end if;
  if (j->0->'rounds_by_member'->0) ? 'scores' then raise exception 'aggregates only'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role authenticated';
  if jsonb_array_length(public.season_club_stats(2026)) <> 0 then raise exception 'unauthenticated caller saw clubs'; end if;
  perform set_config('request.jwt.claim.sub', x::text, true);
  if jsonb_array_length(public.season_club_stats(2026)) <> 1 then raise exception 'Xavier sees only his own club'; end if;
  execute 'reset role';

  n := public.send_season_wrapped(2026);
  if (select count(*) from notifications where type = 'season_wrapped' and user_id in (a, b, x)) <> 3 then raise exception 'one notification per golfer with a 2026 round'; end if;
  if (select link from notifications where type = 'season_wrapped' and user_id = a) is distinct from '/?wrapped=2026' then raise exception 'deep link'; end if;
  -- 0181 wording
  if (select message from notifications where type = 'season_wrapped' and user_id = a) is distinct from 'Your 2026 season summary is ready — tap to see it.' then raise exception 'notification wording: %', (select message from notifications where type = 'season_wrapped' and user_id = a); end if;
  perform public.send_season_wrapped(2026);
  if (select count(*) from notifications where type = 'season_wrapped' and user_id in (a, b, x)) <> 3 then raise exception 'not idempotent'; end if;
  if has_function_privilege('authenticated', 'public.send_season_wrapped(integer)', 'execute') then raise exception 'app role can send season notifications'; end if;
  -- 0181: opened years are per account; a caller marks only their own profile; repeats are no-ops.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform public.mark_season_wrapped_seen(2026);
  perform public.mark_season_wrapped_seen(2026);
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.mark_season_wrapped_seen(2026);   -- unauthenticated: nothing
  execute 'reset role';
  if (select season_wrapped_seen from profiles where id = a) is distinct from '{2026}'::integer[] then raise exception 'seen years for a: %', (select season_wrapped_seen from profiles where id = a); end if;
  if (select season_wrapped_seen from profiles where id = b) is distinct from '{}'::integer[] then raise exception 'another golfer was marked'; end if;

  delete from notifications where user_id in (a, b, x) and type = 'season_wrapped';
  delete from rounds where user_id in (a, b, x) and course = 'Wrap CC';
  delete from group_members where group_id in (g1, g2); delete from groups where id in (g1, g2);
  delete from profiles where id in (a, b, x); delete from auth.users where id in (a, b, x);
  raise notice 'SEASON_WRAPPED_PASS club aggregates scoped and exclude cancelled rounds; one Dec 31 notification per golfer, idempotent';
end $$;
