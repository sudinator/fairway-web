-- 0191_season_wrapped_active_only.sql
--
-- Season Wrapped readiness for Dec 31 (209.0), after 208.0's account statuses:
--   * send_season_wrapped notifies ACTIVE members only. A suspended member keeps their rounds (history is
--     kept), so before this they would have been sent "Your season summary is ready" — a push to someone who
--     can no longer sign in. Merged accounts have no rounds (moved by the merge); pending accounts can't play.
--   * season_wrapped_preview(year): a read-only DRY RUN — exactly who the Dec 31 job would notify, with their
--     round counts and whether they already have it. Sends nothing.
--
-- AUTHORIZATION: send_season_wrapped unchanged (service role / pg_cron only). season_wrapped_preview — SECURITY
-- DEFINER; a system admin, or a direct database session (the SQL editor), may run it.
--
-- Idempotent; safe to re-run.

begin;

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
    join profiles p on p.id = u.user_id and p.account_status = 'active'   -- 209.0: active members only
   where not exists (select 1 from notifications n where n.user_id = u.user_id and n.type = 'season_wrapped' and n.link = '/?wrapped=' || p_year);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.send_season_wrapped(integer) from public, anon, authenticated;

create or replace function public.season_wrapped_preview(p_year integer)
returns table (display_name text, email text, rounds bigint, already_sent boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or (auth.uid() is null and coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon'))) then
    raise exception 'system admin only' using errcode = '42501';
  end if;
  return query
  select p.display_name, p.email, u.n,
         exists (select 1 from notifications n where n.user_id = u.user_id and n.type = 'season_wrapped' and n.link = '/?wrapped=' || p_year)
    from (select r.user_id, count(*) n from rounds r
           where extract(year from r.played_at) = p_year and coalesce(r.status,'final') = 'final' and r.deleted_at is null
           group by r.user_id) u
    join profiles p on p.id = u.user_id and p.account_status = 'active'
   order by u.n desc, p.display_name;
end $$;
revoke all on function public.season_wrapped_preview(integer) from public, anon;
grant execute on function public.season_wrapped_preview(integer) to authenticated;

select public.record_migration('0191_season_wrapped_active_only');

commit;
