-- 0216 (212.19): the hand-made invite functions and clear_my_notifications are gone; the one-time link uses the
-- migration-built function, still admins only.
do $$
begin
  if to_regprocedure('public.create_group_invite(uuid,text,integer)') is not null or to_regprocedure('public.redeem_group_invite(text)') is not null
     or to_regprocedure('public.clear_my_notifications()') is not null then
    raise exception 'a retired function still exists';
  end if;
  if to_regprocedure('public.create_group_invite_multi(uuid,text,integer,integer)') is null then raise exception 'create_group_invite_multi is missing'; end if;
  if pg_get_functiondef('public.create_group_invite_multi(uuid,text,integer,integer)'::regprocedure) not like '%is_group_admin%' then
    raise exception 'create_group_invite_multi no longer checks for a club admin';
  end if;
  raise notice 'RETIRED_FUNCTIONS_PASS the three retired functions are gone; one-time links use create_group_invite_multi (admins only)';
end $$;
