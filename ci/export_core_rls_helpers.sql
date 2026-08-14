-- READ ONLY: export the exact live helper functions used by the 12 core-table RLS policies.
-- Run in the Production Supabase SQL Editor as postgres / owner.
with wanted(proname) as (
  values
    ('is_admin'),
    ('is_group_member'),
    ('is_group_admin'),
    ('is_game_member'),
    ('is_tee_group_marker'),
    ('shares_active_club')
)
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_userbyid(p.proowner) as owner_name,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig as function_config,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join wanted w on w.proname = p.proname
where n.nspname = 'public'
order by p.proname, pg_get_function_identity_arguments(p.oid);
