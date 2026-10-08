-- Guard (audit, 201.4): no RPC exposed to app roles may have two signatures.
-- PostgREST refuses a call that matches more than one overload (PGRST203); both the app and the
-- monitor pass named arguments, so adding a defaulted parameter by CREATE OR REPLACE leaves the old
-- signature beside the new and breaks every caller. 0164 and 0165 each had to DROP the old overload
-- by hand. Extension functions (pgcrypto, citext, ...) are excluded: they are not RPCs and in
-- Supabase they live in the extensions schema.
do $$
declare bad text;
begin
  select string_agg(proname || ' (' || n || ')', ', ' order by proname) into bad from (
    select p.proname, count(*) as n
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     group by p.proname having count(*) > 1) x;
  if bad is not null then
    raise exception 'RPC overloads exposed to app roles (PGRST203 ambiguity): % — drop the old signature in the migration', bad;
  end if;
  raise notice 'NO_RPC_OVERLOADS_PASS every app-callable function has exactly one signature';
end $$;
