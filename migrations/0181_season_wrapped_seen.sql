-- 0181_season_wrapped_seen.sql
--
-- Season Wrapped follow-ups (205.2):
--   * profiles.season_wrapped_seen: the years whose summary the golfer has OPENED. The Dashboard
--     banner hides for a year once it is in this list — on every device, since it is per account —
--     and the summary lives on under Rounds. mark_season_wrapped_seen(year) adds a year for the
--     caller only.
--   * season_club_stats: counts rounds PLAYED IN each club (rounds.group_id), not every round by anyone
--     who is a member. 0180 counted a member's rounds once per club they belonged to, so a golfer in
--     four clubs showed the same 26 rounds in all four (found on real data before release).
--   * send_season_wrapped: the notification now reads "Your <year> season summary is ready — tap to
--     see it." (owner: "your season is ready" did not make sense). Behaviour otherwise as 0180.
--
-- AUTHORIZATION:
--   * season_club_stats: unchanged gate (authenticated; caller's active clubs; aggregates only).
--   * mark_season_wrapped_seen: SECURITY DEFINER, authenticated; writes only auth.uid()'s profile.
--   * send_season_wrapped: unchanged — no grant to app roles (cron / service only).
--
-- Idempotent; safe to re-run.

begin;

alter table public.profiles add column if not exists season_wrapped_seen integer[] not null default '{}';

create or replace function public.mark_season_wrapped_seen(p_year integer)
returns void language sql volatile security definer set search_path = public as $$
  update profiles set season_wrapped_seen = array(select distinct unnest(season_wrapped_seen || p_year) order by 1)
   where id = auth.uid() and auth.uid() is not null and p_year between 2000 and 2999
     and not (p_year = any(season_wrapped_seen));
$$;
revoke all on function public.mark_season_wrapped_seen(integer) from public, anon;
grant execute on function public.mark_season_wrapped_seen(integer) to authenticated;

create or replace function public.season_club_stats(p_year integer)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'name', g.name,
           'members', (select count(*) from group_members gm where gm.group_id = g.id and gm.status = 'active'),
           'total_rounds', (select count(*) from rounds r
                             where r.group_id = g.id and extract(year from r.played_at) = p_year
                               and coalesce(r.status,'final') = 'final' and r.deleted_at is null),
           'rounds_by_member', (select coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', p.display_name, 'rounds', c.n) order by c.n desc, p.display_name), '[]'::jsonb)
                                  from (select r.user_id, count(*) n from rounds r
                                         where r.group_id = g.id and extract(year from r.played_at) = p_year
                                           and coalesce(r.status,'final') = 'final' and r.deleted_at is null
                                         group by r.user_id) c join profiles p on p.id = c.user_id)
         ) order by g.name), '[]'::jsonb)
    from groups g
   where auth.uid() is not null
     and exists (select 1 from group_members gm where gm.group_id = g.id and gm.user_id = auth.uid() and gm.status = 'active');
$$;
revoke all on function public.season_club_stats(integer) from public, anon;
grant execute on function public.season_club_stats(integer) to authenticated;

create or replace function public.send_season_wrapped(p_year integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into notifications (user_id, message, type, link, detail)
  select u.user_id,
         'Your ' || p_year || ' season summary is ready — tap to see it.',
         'season_wrapped',
         '/?wrapped=' || p_year,
         u.n || ' round' || case when u.n = 1 then '' else 's' end || ' in ' || p_year
    from (select r.user_id, count(*) n from rounds r
           where extract(year from r.played_at) = p_year and coalesce(r.status,'final') = 'final' and r.deleted_at is null
           group by r.user_id) u
   where not exists (select 1 from notifications n where n.user_id = u.user_id and n.type = 'season_wrapped' and n.link = '/?wrapped=' || p_year);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.send_season_wrapped(integer) from public, anon, authenticated;

select public.record_migration('0181_season_wrapped_seen');

commit;
