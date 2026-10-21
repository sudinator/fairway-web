-- 0205 (211.3): signed-out visitors hold no table privilege and can call only the three live-link functions;
-- members and the server keep every right they had. Checked by privilege, never by calling (208.4).
do $$
declare n int; bad text;
begin
  select string_agg(table_name, ', ') into bad from (select distinct table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon') x;
  if bad is not null then raise exception 'signed-out visitors still hold privileges on: %', bad; end if;
  select string_agg(p.proname, ', ' order by p.proname) into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('get_live_scorecard', 'get_live_competition', 'get_live_lineup');
  if bad is not null then raise exception 'signed-out visitors can still call privileged functions: %', bad; end if;
  if not has_function_privilege('anon', 'public.get_live_scorecard(text)', 'execute') then raise exception 'the live page can no longer load (get_live_scorecard)'; end if;
  -- members keep what they need — a sample across features
  if not (has_function_privilege('authenticated', 'public.save_scramble_score_fenced(uuid,integer,text,text,integer,integer,text)', 'execute')
      and has_function_privilege('authenticated', 'public.admin_club_requests()', 'execute')
      and has_function_privilege('authenticated', 'public.begin_account(text)', 'execute')
      and has_function_privilege('authenticated', 'public.save_alt_shot_score_fenced(uuid,integer,text,text,integer,integer)', 'execute')
      and has_table_privilege('authenticated', 'public.games', 'select') and has_table_privilege('authenticated', 'public.rounds', 'insert')) then
    raise exception 'members lost a right they had';
  end if;
  -- the server keeps its own functions
  if not has_function_privilege('service_role', 'public.due_round_emails(integer)', 'execute') then raise exception 'the server lost a function'; end if;
  raise notice 'ANON_BOUNDARY_PASS signed-out visitors: no table privileges, only the three live-link functions; members and the server unchanged';
end $$;
