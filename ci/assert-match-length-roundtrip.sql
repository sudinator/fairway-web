-- FRESH-DB ONLY: execute the complete organizer match-length lifecycle against
-- the real 0149 RPC. Every change is rolled back.

begin;

insert into auth.users(id) values
  ('49000000-0000-0000-0000-000000000001'),
  ('49000000-0000-0000-0000-000000000002');

insert into public.games(
  id, code, name, course, course_par, holes_meta, game_type, status,
  pairings, teams, foursomes, created_by
) values (
  '49000000-0000-0000-0000-000000000010', '149999', 'Length round trip',
  'Test Eighteen', 72,
  (select jsonb_agg(jsonb_build_object('n', n, 'par', 4, 'si', n) order by n)
     from generate_series(1, 9) n),
  'fourball', 'active',
  '[{"a":"p1","b":"p3"}]'::jsonb,
  '[{"key":"A","name":"Violet"},{"key":"B","name":"Burgundy"}]'::jsonb,
  '[{"id":"f1","name":"Group 1","a":["p1","p2"],"b":["p3","p4"]}]'::jsonb,
  '49000000-0000-0000-0000-000000000001'
);

insert into public.game_players(
  id, game_id, user_id, display_name, handicap_index, rating, slope,
  tee_name, course_handicap, scores, putts, fairways, penalties, sand, team, tee_group
) values
  ('49000000-0000-0000-0000-000000000101','49000000-0000-0000-0000-000000000010','49000000-0000-0000-0000-000000000001','Player One',10,72,113,'Blue',10,'[null,null,null,null,null,null,null,null,null]','[null,null,null,null,null,null,null,null,null]','[null,null,null,null,null,null,null,null,null]','[null,null,null,null,null,null,null,null,null]','[null,null,null,null,null,null,null,null,null]','A',1),
  ('49000000-0000-0000-0000-000000000102','49000000-0000-0000-0000-000000000010','49000000-0000-0000-0000-000000000002','Player Two',12,72,113,'Blue',12,'[null,null,null,null,null,null,null,null,null]','[null,null,null,null,null,null,null,null,null]','[null,null,null,null,null,null,null,null,null]','[null,null,null,null,null,null,null,null,null]','[null,null,null,null,null,null,null,null,null]','B',1);

set local role authenticated;
select set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"49000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

-- A different authenticated player cannot mutate the organizer's game.
select set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"49000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
do $$
declare denied boolean := false;
begin
  begin
    perform public.change_game_match_length_before_scoring(
      '49000000-0000-0000-0000-000000000010',
      (select jsonb_agg(jsonb_build_object('n', n, 'par', 4, 'si', n) order by n)
         from generate_series(1, 18) n)
    );
  exception when others then
    denied := position('Only the game organizer' in sqlerrm) > 0;
  end;
  if not denied then raise exception 'Non-organizer unexpectedly changed match length'; end if;
end $$;
select set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"49000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

-- Front nine → 18.
select public.change_game_match_length_before_scoring(
  '49000000-0000-0000-0000-000000000010',
  (select jsonb_agg(jsonb_build_object('n', n, 'par', 4, 'si', n) order by n)
     from generate_series(1, 18) n)
);

do $$
declare g public.games%rowtype; p public.game_players%rowtype;
begin
  select * into g from public.games where id = '49000000-0000-0000-0000-000000000010';
  select * into p from public.game_players where id = '49000000-0000-0000-0000-000000000101';
  if jsonb_array_length(g.holes_meta) <> 18 or jsonb_array_length(p.scores) <> 18 then
    raise exception 'Front nine to 18 did not resize the positional arrays';
  end if;
  if p.tee_name <> 'Blue' or p.course_handicap <> 10 or p.team <> 'A' or p.tee_group <> 1 then
    raise exception 'Length change damaged player setup';
  end if;
  if jsonb_array_length(g.teams) <> 2 or jsonb_array_length(g.foursomes) <> 1 or jsonb_array_length(g.pairings) <> 1 then
    raise exception 'Length change damaged competitive setup';
  end if;
end $$;

-- 18 → Back nine, preserving real hole numbers 10–18.
select public.change_game_match_length_before_scoring(
  '49000000-0000-0000-0000-000000000010',
  (select jsonb_agg(jsonb_build_object('n', n, 'par', 4, 'si', n) order by n)
     from generate_series(10, 18) n)
);

do $$
declare first_hole integer; last_hole integer; n integer;
begin
  select (holes_meta->0->>'n')::integer,
         (holes_meta->8->>'n')::integer
    into first_hole, last_hole
    from public.games where id = '49000000-0000-0000-0000-000000000010';
  select jsonb_array_length(scores) into n from public.game_players
   where id = '49000000-0000-0000-0000-000000000101';
  if first_hole <> 10 or last_hole <> 18 or n <> 9 then
    raise exception 'Back-nine round trip lost hole identity or array size';
  end if;
end $$;

-- Once a score exists the same RPC must reject the change.
update public.game_players
   set scores = '[5,null,null,null,null,null,null,null,null]'::jsonb
 where id = '49000000-0000-0000-0000-000000000101';

do $$
declare denied boolean := false;
begin
  begin
    perform public.change_game_match_length_before_scoring(
      '49000000-0000-0000-0000-000000000010',
      (select jsonb_agg(jsonb_build_object('n', n, 'par', 4, 'si', n) order by n)
         from generate_series(1, 18) n)
    );
  exception when others then
    denied := position('locked once scoring begins' in sqlerrm) > 0;
  end;
  if not denied then raise exception 'Scored game unexpectedly changed length'; end if;
end $$;

-- Reset restores editability, then Back nine → 18 succeeds.
select public.reset_game_scores('49000000-0000-0000-0000-000000000010');
select public.change_game_match_length_before_scoring(
  '49000000-0000-0000-0000-000000000010',
  (select jsonb_agg(jsonb_build_object('n', n, 'par', 4, 'si', n) order by n)
     from generate_series(1, 18) n)
);

do $$
begin
  if (select jsonb_array_length(holes_meta) from public.games where id = '49000000-0000-0000-0000-000000000010') <> 18 then
    raise exception 'Reset did not restore length editability';
  end if;
end $$;

rollback;
