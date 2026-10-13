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
  insert into group_members(group_id,user_id,email,role,status) values (g1,a,'wa@x.com','member','active'),(g1,b,'wb@x.com','member','active'),(g2,x,'wx@x.com','member','active');
  insert into rounds(user_id,course,played_at,status) values
    (a,'Wrap CC','2026-05-01','final'),(a,'Wrap CC','2026-06-01','final'),(b,'Wrap CC','2026-07-01','final'),(x,'Wrap CC','2026-07-01','final'),
    (a,'Wrap CC','2025-05-01','final');
  insert into rounds(user_id,course,played_at,status,deleted_at) values (a,'Wrap CC','2026-08-01','final', now());  -- cancelled

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  j := public.season_club_stats(2026);
  execute 'reset role';
  if jsonb_array_length(j) <> 1 or j->0->>'name' <> 'Wrap Club' then raise exception 'caller sees only own clubs: %', j; end if;
  if (j->0->>'total_rounds')::int <> 3 then raise exception 'cancelled / other-year rounds counted: %', j->0->>'total_rounds'; end if;
  if (j->0->'rounds_by_member'->0->>'name') is distinct from 'Ann' or (j->0->'rounds_by_member'->0->>'rounds')::int <> 2 then raise exception 'per-member counts: %', j->0->'rounds_by_member'; end if;
  if (j->0->'rounds_by_member'->0) ? 'scores' then raise exception 'aggregates only'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role authenticated';
  if jsonb_array_length(public.season_club_stats(2026)) <> 0 then raise exception 'unauthenticated caller saw clubs'; end if;
  execute 'reset role';

  n := public.send_season_wrapped(2026);
  if (select count(*) from notifications where type = 'season_wrapped' and user_id in (a, b, x)) <> 3 then raise exception 'one notification per golfer with a 2026 round'; end if;
  if (select link from notifications where type = 'season_wrapped' and user_id = a) is distinct from '/?wrapped=2026' then raise exception 'deep link'; end if;
  perform public.send_season_wrapped(2026);
  if (select count(*) from notifications where type = 'season_wrapped' and user_id in (a, b, x)) <> 3 then raise exception 'not idempotent'; end if;
  if has_function_privilege('authenticated', 'public.send_season_wrapped(integer)', 'execute') then raise exception 'app role can send season notifications'; end if;

  delete from notifications where user_id in (a, b, x) and type = 'season_wrapped';
  delete from rounds where user_id in (a, b, x) and course = 'Wrap CC';
  delete from group_members where group_id in (g1, g2); delete from groups where id in (g1, g2);
  delete from profiles where id in (a, b, x); delete from auth.users where id in (a, b, x);
  raise notice 'SEASON_WRAPPED_PASS club aggregates scoped and exclude cancelled rounds; one Dec 31 notification per golfer, idempotent';
end $$;
