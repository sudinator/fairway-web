-- Disposable fresh database only. Exercise the actual latest posting functions.
begin;
insert into auth.users(id) values
 ('16100000-0000-0000-0000-000000000001'),
 ('16100000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','16100000-0000-0000-0000-000000000001',true);
select public.claim_scoring_device('16200000-0000-0000-0000-000000000010',null,false);
select set_config('request.headers','{"x-bnn-scoring-device":"16200000-0000-0000-0000-000000000010"}',true);

do $$
declare
 uid uuid := '16100000-0000-0000-0000-000000000001';
 gid uuid; pid uuid; rid uuid; meta jsonb; vals jsonb;
 n integer; ch integer; source text; posting text; expected_ch integer;
 pl public.game_players%rowtype; g public.games%rowtype; insert_sql text;
 r public.rounds%rowtype; stamp timestamptz := '2026-09-29T12:00:00Z';
begin
 foreach posting in array array['game','group'] loop
  foreach n in array array[9,12,18] loop
   foreach source in array array['manual','derived'] loop
    foreach ch in array array[-3,0,8,13] loop
     gid := gen_random_uuid(); pid := gen_random_uuid();
     select jsonb_agg(jsonb_build_object('n',i + case when n=9 then 9 else 0 end,
                'par',case when i=n then 3 else 4 end,'si',i,'yards',400) order by i),
            jsonb_agg(5 order by i) into meta,vals from generate_series(1,n) i;
     insert into public.games(id,code,name,course,course_par,holes_meta,game_type,status,created_by)
      values(gid,left(replace(gid::text,'-',''),12),'Posting regression','Posting course',71,meta,'stroke','active',uid);
     -- Newly created game: establish the authenticated version-0 write context.
     perform public.begin_game_score_write(gid,0);
     insert into public.game_players(id,game_id,user_id,display_name,tee_name,rating,slope,handicap_index,
       course_handicap,course_handicap_source,course_handicap_set_by,course_handicap_set_at,tee_group,
       scores,putts,fairways,penalties,sand)
      values(pid,gid,uid,'Posting player','Blue',72,125,null,ch,source,
       case when source='manual' then uid end,case when source='manual' then stamp end,1,
       vals,'[]','[]','[]','[]');
     if posting='game' then perform public.post_game_rounds_internal(gid,false);
     else perform public.post_group_rounds(gid,1); end if;
     select * into r from public.rounds where game_id=gid and user_id=uid;
     if not found then raise exception 'FAIL: no round posted'; end if;
     rid:=r.id;
     expected_ch:=case when n=9 and source='derived' then round(ch/2.0)::int else ch end;
     if r.course_handicap is distinct from expected_ch or r.course_handicap_source is distinct from source
        or r.course_handicap_set_by is distinct from (case when source='manual' then uid end)
        or r.course_handicap_set_at is distinct from (case when source='manual' then stamp end) then
      raise exception 'FAIL: % n=% source=% CH=% lost handicap or audit snapshot',posting,n,source,ch;
     end if;
     if r.rating is distinct from (case when n=9 then 36 else 72 end)::numeric or r.slope <> 125
        or r.course_par <> (case when n=9 then 35 else 71 end)
        or r.gross_score <> n*5 or (select count(*) from public.holes where round_id=rid) <> n then
      raise exception 'FAIL: rating/slope/par/gross/holes changed'; end if;
     if n=9 and ((select min(hole_number) from public.holes where round_id=rid) <> 10 or
                 (select max(hole_number) from public.holes where round_id=rid) <> 18) then
      raise exception 'FAIL: back-nine hole identities lost'; end if;
     -- Execute the INSERT block extracted from the live function against a
     -- pre-existing conflict. This proves its actual conflict assignments without
     -- pretending a same-command trigger is a concurrent transaction.
     select * into pl from public.game_players where id=pid;
     select * into g from public.games where id=gid;
     insert_sql:=substring(pg_get_functiondef(case when posting='game'
       then 'public.post_game_rounds_internal(uuid,boolean)'::regprocedure
       else 'public.post_group_rounds(uuid,integer)'::regprocedure end)
       from 'insert into rounds [(].*?returning id into rid;');
     if insert_sql is null then raise exception 'FAIL: live INSERT block not found'; end if;
     insert_sql:=replace(insert_sql,'returning id into rid;','returning id;');
     insert_sql:=replace(replace(insert_sql,'pl.','($1).'),'g.','($2).');
     insert_sql:=regexp_replace(insert_sql,'\mn\M','$3','g');
     insert_sql:=regexp_replace(insert_sql,'\mparsum\M','$4','g');
     insert_sql:=regexp_replace(insert_sql,'\mrdate\M','$5','g');
     insert_sql:=regexp_replace(insert_sql,'\mp_game\M','$6','g');
     insert_sql:=regexp_replace(insert_sql,'\mgross\M','$7','g');
     update public.rounds set course_handicap=99,course_handicap_source='derived',
       course_handicap_set_by=null,course_handicap_set_at=null where id=rid;
     execute insert_sql into rid using pl,g,n,n*4-1,'2026-09-29'::date,gid,n*5;
     select * into r from public.rounds where id=rid;
     if r.course_handicap <> expected_ch or r.course_handicap_source <> source
        or r.course_handicap_set_by is distinct from (case when source='manual' then uid end)
        or r.course_handicap_set_at is distinct from (case when source='manual' then stamp end) then
      raise exception 'FAIL: live conflict assignments lost handicap/audit snapshot'; end if;
     -- Existing-row repost must preserve corrected date, identity and the source.
     update public.rounds set played_at='2026-09-20' where id=rid;
     if posting='game' then perform public.post_game_rounds_internal(gid,true);
     else perform public.post_group_rounds(gid,1); end if;
     select * into r from public.rounds where id=rid;
     if r.played_at <> '2026-09-20'::date or r.course_handicap <> expected_ch or r.course_handicap_source <> source
        or (select count(*) from public.rounds where game_id=gid) <> 1 then
      raise exception 'FAIL: repost changed date/handicap or duplicated row'; end if;
     if posting='game' and (r.finished_by is distinct from 'system:auto' or r.finished_at is null) then
      raise exception 'FAIL: automatic completion stamps lost'; end if;
     -- Changing manual -> derived must clear obsolete override audit metadata.
     update public.game_players set course_handicap=10,course_handicap_source='derived',
       course_handicap_set_by=null,course_handicap_set_at=null where id=pid;
     if posting='game' then perform public.post_game_rounds_internal(gid,false);
     else perform public.post_group_rounds(gid,1); end if;
     select * into r from public.rounds where id=rid;
     if r.course_handicap <> (case when n=9 then 5 else 10 end) or r.course_handicap_source <> 'derived'
        or r.course_handicap_set_by is not null or r.course_handicap_set_at is not null then
      raise exception 'FAIL: derived repost kept manual metadata'; end if;
     -- A different tee group must not modify an existing round.
     update public.game_players set course_handicap=30 where id=pid;
     perform public.post_group_rounds(gid,2);
     if (select course_handicap from public.rounds where id=rid) <> r.course_handicap then
      raise exception 'FAIL: posted an unrelated tee group'; end if;
    end loop;
   end loop;
  end loop;
 end loop;
 -- Formats with no individual ball, and players with no entered scores, still do not post.
 foreach source in array array['alt_shot','scramble','stroke'] loop
  gid:=gen_random_uuid();
  insert into public.games(id,code,name,course,course_par,holes_meta,game_type,status,created_by)
   values(gid,left(replace(gid::text,'-',''),12),'No post','Course',72,meta,source,'active',uid);
  -- Excluded formats still obey the score-write guard during fixture setup.
  perform public.begin_game_score_write(gid,0);
  insert into public.game_players(id,game_id,user_id,display_name,tee_group,scores)
   values(gen_random_uuid(),gid,uid,'Player',1,case when source='stroke' then '[]'::jsonb else vals end);
  perform public.post_game_rounds_internal(gid,false); perform public.post_group_rounds(gid,1);
  if exists(select 1 from public.rounds where game_id=gid) then
   raise exception 'FAIL: excluded format or unscored player posted'; end if;
 end loop;
 if has_function_privilege('authenticated','public.post_game_rounds_internal(uuid,boolean)','execute')
    or has_function_privilege('anon','public.post_group_rounds(uuid,integer)','execute')
    or not has_function_privilege('authenticated','public.post_group_rounds(uuid,integer)','execute') then
  raise exception 'FAIL: posting execute privileges changed'; end if;
end $$;
-- Call as a real authenticated outsider; parameter selection occurs before
-- switching roles, so an empty RLS SELECT cannot make this a false positive.
select set_config('bnn.test_posting_game',
 (select game_id::text from public.rounds limit 1),true);
select set_config('request.jwt.claim.sub','16100000-0000-0000-0000-000000000002',true);
select public.claim_scoring_device('16200000-0000-0000-0000-000000000010',null,false);
select set_config('request.headers','{"x-bnn-scoring-device":"16200000-0000-0000-0000-000000000010"}',true);
set local role authenticated;
select public.post_group_rounds(current_setting('bnn.test_posting_game')::uuid,1);
-- Check the actual caller's ACL directly. Do not intentionally raise/catch
-- permission errors in this large fixture transaction; that probe lost the
-- database connection in GitHub's Supabase run. The backend cause is unconfirmed.
do $$ begin
 if current_user <> 'authenticated' then
  raise exception 'FAIL: outsider test did not run as authenticated'; end if;
 if has_function_privilege(current_user,
      'public.post_game_rounds_internal(uuid,boolean)','execute') then
  raise exception 'FAIL: authenticated caller has internal posting execution'; end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.rounds where course='Posting course' and course_handicap not in (5,10)) then
  raise exception 'FAIL: outsider posted another game group'; end if;
end $$;
rollback;
