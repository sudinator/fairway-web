-- 0101_admin_sandbaggers_system_only.sql
-- Roll back 0100's club-scoping. Sandbaggers is a System-admin (master) tool again: master admin
-- only, app-wide across all players. Same rule: only players with >= 18 posted rounds are judged,
-- flagged at >= 20% relative gap between the entered (GHIN) index and the app's scoring index.
-- (Supersedes 0099 and 0100 — run this and ignore those.)
drop function if exists public.admin_sandbaggers(uuid);
drop function if exists public.admin_sandbaggers();
create or replace function public.admin_sandbaggers()
returns table (user_id uuid, name text, entered numeric, calc numeric, rounds int, diff_pct int, direction text)
language plpgsql security definer set search_path = public as $function$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
    select p.id,
           coalesce(p.display_name, p.email, '(no name)') as name,
           p.handicap_index::numeric as entered,
           pc.idx as calc,
           pc.rounds,
           round(100.0 * abs(p.handicap_index - pc.idx) / pc.idx)::int as diff_pct,
           case when p.handicap_index > pc.idx then 'entered_high' else 'entered_low' end as direction
    from profiles p
    join player_cards pc on pc.user_id = p.id
    where coalesce(p.is_test, false) = false
      and coalesce(p.deactivated, false) = false
      and p.handicap_index is not null
      and pc.idx is not null and pc.idx > 0
      and pc.rounds >= 18
      and abs(p.handicap_index - pc.idx) / pc.idx >= 0.20
    order by abs(p.handicap_index - pc.idx) / pc.idx desc;
end;
$function$;
grant execute on function public.admin_sandbaggers() to authenticated;
