-- 208.4: functions BNN keeps away from app users stay away from them — checked by PRIVILEGE, never by calling.
-- Calling a function an app role lacks EXECUTE on crashes Supabase's PostgreSQL 17.6 images up to 17.6.1.111
-- (supautils bug — supabase/postgres#2112, #2366; fixed in 17.6.1.121). A test that "tries it and expects a
-- refusal" would restart the database; this one asks the catalogue instead.
do $$
declare bad text;
begin
  select string_agg(f, ', ') into bad from (values
    ('public.merge_accounts_as(uuid,uuid,uuid,text)'),
    ('public.account_merge_preview_for(uuid,uuid,uuid)'),
    ('public.end_user_sessions(uuid)'),
    ('public.notify_signup_approvers(uuid,text,text)'),
    ('public.find_duplicate_member(uuid)'),
    ('public.valid_invite(text)'),
    ('public.remind_pending_signups()'),
    ('public.claim_game_recap(uuid,text)')
  ) v(f)
  where to_regprocedure(f) is not null
    and (has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute'));
  if bad is not null then raise exception 'app users can call server-only functions: %', bad; end if;
  raise notice 'NO_APP_CALL_TO_SERVER_ONLY_PASS server-only functions are not executable by anon or authenticated';
end $$;
