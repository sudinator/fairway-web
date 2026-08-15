-- 0136_core_rls_helpers.sql
-- Recreate the exact Production helper functions referenced by the core RLS
-- policies before the policy baseline itself is installed by 0137.
-- Source: read-only pg_proc / pg_get_functiondef export from Production on 2026-08-14.
-- AUTHORIZATION: exact Production RLS predicate helpers only; they return scoped booleans
-- from auth.uid()/membership/admin state and perform no privileged writes. Preserve the live
-- SECURITY DEFINER/search_path contract so the following RLS baseline has identical semantics.
-- Recreating all six helpers (not just historically-missing ones) makes a fresh
-- database converge on the same function bodies, volatility and SECURITY DEFINER
-- behavior as Production before those helpers are referenced by RLS policies.

create or replace function public.is_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce((select is_admin and not coalesce(banned, false)
                   from profiles where id = auth.uid()), false);
$function$;

create or replace function public.is_game_member(g uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
    select exists (select 1 from game_players where game_id = g and user_id = auth.uid());
$function$;

create or replace function public.is_group_admin(group_uuid uuid, user_uuid uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = group_uuid
      and gm.user_id = user_uuid
      and gm.status = 'active'
      and gm.role = 'admin'
  )
  and not coalesce((select banned from profiles where id = user_uuid), false);
$function$;

create or replace function public.is_group_member(group_uuid uuid, user_uuid uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = group_uuid
      and gm.user_id = user_uuid
      and gm.status = 'active'
  )
  and not coalesce((select banned from profiles where id = user_uuid), false);
$function$;

create or replace function public.is_tee_group_marker(p_game uuid, p_group smallint)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from game_players w
    where w.game_id = p_game and w.user_id = auth.uid()
      and w.is_marker = true and w.tee_group is not null and w.tee_group = p_group
  );
$function$;

create or replace function public.shares_active_club(other uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from group_members me
    join group_members them on them.group_id = me.group_id
    where me.user_id = auth.uid() and me.status = 'active'
      and them.user_id = other  and them.status = 'active'
  );
$function$;

select public.record_migration('0136_core_rls_helpers');
