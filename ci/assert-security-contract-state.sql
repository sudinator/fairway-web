-- 0214 (212.8): security_contract_state() exists, reports every section, and is server-only.
do $$
declare s jsonb := public.security_contract_state(); k text;
begin
  foreach k in array array['rls_off', 'policies', 'table_grants', 'definer_execute', 'definer_no_search_path', 'writable_without_guard'] loop
    if not (s ? k) then raise exception 'security_contract_state() lacks %', k; end if;
  end loop;
  if jsonb_typeof(s -> 'policies') <> 'object' or (select count(*) from jsonb_object_keys(s -> 'policies')) < 100 then raise exception 'security_contract_state() reports too few policies'; end if;
  if has_function_privilege('authenticated', 'public.security_contract_state()', 'execute') or has_function_privilege('anon', 'public.security_contract_state()', 'execute') then
    raise exception 'app users can call security_contract_state()';
  end if;
  if not has_function_privilege('service_role', 'public.security_contract_state()', 'execute') then raise exception 'the server cannot call security_contract_state()'; end if;
  raise notice 'SECURITY_CONTRACT_STATE_PASS every section reported; server only';
end $$;
