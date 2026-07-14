-- 0099_admin_sandbaggers.sql
-- Admin "Sandbaggers" check: flag players whose ENTERED (GHIN/self-reported) index doesn't
-- reconcile with the index the app computes from their scoring. Because a short record skews the
-- computed index materially, this ONLY evaluates players with >= 18 posted rounds — below that the
-- entered index (GHIN) is trusted as-is and no flag is raised. Threshold is relative (20% of the
-- app-computed index), since a 2-stroke gap means very different things at scratch vs. a 20 index.
--   entered 10 vs computed 8  ->  |10-8|/8 = 25%  ->  flagged ("index looks high" = classic sandbag)
-- Reads player_cards.idx (the same running WHS index the app shows) so it matches app behavior.
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
