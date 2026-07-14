-- 0100_admin_sandbaggers_club.sql
-- Open the Sandbaggers check to CLUB admins (not just master admin), scoped to their own club.
-- Supersedes 0099's no-arg version: admin_sandbaggers now takes p_group and returns flagged
-- members of THAT club, callable by an admin of that group OR a master admin. Same rule as before:
-- only players with >= 18 posted rounds are judged, flagged at >= 20% relative gap between the
-- entered (GHIN) index and the app's scoring-computed index (player_cards.idx).
-- (If 0099 was never run, this is all you need; if it was, this replaces it.)
drop function if exists public.admin_sandbaggers();
drop function if exists public.admin_sandbaggers(uuid);
create or replace function public.admin_sandbaggers(p_group uuid)
returns table (user_id uuid, name text, entered numeric, calc numeric, rounds int, diff_pct int, direction text)
language plpgsql security definer set search_path = public as $function$
begin
  if not (public.is_admin() or public.is_group_admin(p_group, auth.uid())) then
    raise exception 'club admins only';
  end if;
  return query
    select p.id,
           coalesce(p.display_name, p.email, '(no name)') as name,
           p.handicap_index::numeric as entered,
           pc.idx as calc,
           pc.rounds,
           round(100.0 * abs(p.handicap_index - pc.idx) / pc.idx)::int as diff_pct,
           case when p.handicap_index > pc.idx then 'entered_high' else 'entered_low' end as direction
    from group_members gm
    join profiles p on p.id = gm.user_id
    join player_cards pc on pc.user_id = p.id
    where gm.group_id = p_group and gm.status = 'active'
      and coalesce(p.is_test, false) = false
      and coalesce(p.deactivated, false) = false
      and p.handicap_index is not null
      and pc.idx is not null and pc.idx > 0
      and pc.rounds >= 18
      and abs(p.handicap_index - pc.idx) / pc.idx >= 0.20
    order by abs(p.handicap_index - pc.idx) / pc.idx desc;
end;
$function$;
grant execute on function public.admin_sandbaggers(uuid) to authenticated;
