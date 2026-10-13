-- 0182: every public table has RLS; the reconciliation leftovers are gone; the inventory is
-- service-role only and reports names and flags, never data.
do $$
declare j jsonb; bad text;
begin
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;
  if bad is not null then raise exception 'public table(s) with RLS off: %', bad; end if;
  if to_regclass('public.course_id_reconciliation_tmp') is not null or to_regclass('public.course_id_pre_reconciliation_snapshot') is not null then
    raise exception 'reconciliation leftover tables still present';
  end if;
  execute 'set local role service_role';
  j := public.security_posture();
  execute 'reset role';
  if jsonb_array_length(j) < 20 or exists (select 1 from jsonb_array_elements(j) e where (e->>'rls')::boolean is not true) then raise exception 'posture: %', left(j::text, 200); end if;
  if has_function_privilege('authenticated', 'public.security_posture()', 'execute') or has_function_privilege('anon', 'public.security_posture()', 'execute') then raise exception 'app roles can read the security inventory'; end if;
  raise notice 'SECURITY_POSTURE_PASS every public table has RLS; leftovers dropped; inventory service-role only';
end $$;
