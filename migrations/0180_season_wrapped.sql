-- 0180_season_wrapped.sql
--
-- Season Wrapped (205.0): the year-end summary is computed in the app from the golfer's own rounds
-- and games (the same rounds the Dashboard loads), so the only server pieces are:
--
--   * season_club_stats(year): aggregates for each club the caller is an ACTIVE member of — member
--     count, rounds played that year, rounds per member (name + count). Other members' rounds are not
--     readable from the app (RLS, by design); this returns counts only, never scores. Cancelled rounds
--     (deleted_at) and unfinished ones are excluded, matching the Dashboard.
--   * send_season_wrapped(year): one 'season_wrapped' notification to every golfer with at least one
--     finished, non-cancelled round that year, linking to /?wrapped=<year>. Idempotent: a golfer who
--     already has that year's notification is skipped, so a re-run never doubles up.
--   * a pg_cron job at 14:00 UTC on Dec 31 (09:00 Eastern, standard time) calling it for the current
--     year.
--
-- AUTHORIZATION:
--   * season_club_stats: SECURITY DEFINER, authenticated only; scoped by auth.uid() to clubs the
--     caller is an active member of; returns aggregates only.
--   * send_season_wrapped: SECURITY DEFINER; no grant to app roles (cron / service only).
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.season_club_stats(p_year integer)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'name', g.name,
           'members', (select count(*) from group_members gm where gm.group_id = g.id and gm.status = 'active'),
           'total_rounds', (select count(*) from rounds r join group_members gm on gm.user_id = r.user_id and gm.group_id = g.id and gm.status = 'active'
                             where extract(year from r.played_at) = p_year and coalesce(r.status,'final') = 'final' and r.deleted_at is null),
           'rounds_by_member', (select coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', p.display_name, 'rounds', c.n) order by c.n desc, p.display_name), '[]'::jsonb)
                                  from (select r.user_id, count(*) n from rounds r join group_members gm on gm.user_id = r.user_id and gm.group_id = g.id and gm.status = 'active'
                                         where extract(year from r.played_at) = p_year and coalesce(r.status,'final') = 'final' and r.deleted_at is null
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
         'Your ' || p_year || ' season is ready — tap to see it.',
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

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'season-wrapped';
    perform cron.schedule('season-wrapped', '0 14 31 12 *', $job$ select public.send_season_wrapped(extract(year from now())::int); $job$);
  end if;
end $$;

select public.record_migration('0180_season_wrapped');

commit;
