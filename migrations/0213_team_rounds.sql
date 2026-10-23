-- 0213_team_rounds.sql
--
-- 212.7 — TEAM ROUNDS count as played (owner, Oct 22). Scramble and alternate shot record one score per team / side,
-- never a personal round — so they were invisible to Season Wrapped (its notification, the admin preview, the club
-- totals) and got no round email. A team round is: a member in a FINISHED scramble or alternate-shot game whose team
-- or side scored 9+ holes (older alternate-shot games kept the scores on the players' own cards — those count too).
-- It counts as PLAYED; it feeds no personal statistic. The app's twin is lib/team-rounds.ts — the same rule.
--   * team_rounds_in_year(p_year) — internal helper (not callable by app users);
--   * send_season_wrapped, season_wrapped_preview, season_club_stats — personal rounds + team rounds;
--   * the team-round recap email: team_round_email_log (server only), due_team_round_emails /
--     record_team_round_email (server only) — the round email's rules: opted in, active, owner-only until opened to
--     everyone, 1 hour to 7 days after the game ends, never twice.
--
-- AUTHORIZATION: team_rounds_in_year, due_team_round_emails, record_team_round_email — SECURITY DEFINER, revoked from
-- public / anon / authenticated (server only, round_email_server_session()); team_round_email_log — RLS on, no
-- policies, no member grants. The Season Wrapped functions keep their grants.
-- TESTS: ci/assert-team-rounds.sql
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.team_rounds_in_year(p_year integer)
returns table(user_id uuid, game_id uuid, group_id uuid, played_on date)
language sql stable security definer set search_path = public as $$
  select distinct gp.user_id, g.id, g.group_id, g.played_at::date
    from games g
    join game_players gp on gp.game_id = g.id and gp.user_id is not null and not coalesce(gp.no_show, false)
    cross join lateral jsonb_array_elements(coalesce(g.foursomes, '[]'::jsonb)) f
    cross join lateral (values ('a'), ('b')) s(side)
   where g.game_type in ('scramble', 'alt_shot') and g.status = 'ended'
     and extract(year from g.played_at) = p_year
     and jsonb_typeof(f -> s.side) = 'array' and (f -> s.side) ? gp.user_id::text
     and greatest(
           (select count(*) from game_alt_shot_scores x
             where x.game_id = g.id and x.foursome_id = f ->> 'id' and x.side = s.side and x.strokes is not null and x.strokes > 0),
           -- older alternate-shot games: the side's scores on the player's own card
           case when not exists (select 1 from game_alt_shot_scores x where x.game_id = g.id and x.foursome_id = f ->> 'id' and x.side = s.side)
                then (select count(*) from jsonb_array_elements(case when jsonb_typeof(to_jsonb(gp.scores)) = 'array' then to_jsonb(gp.scores) else '[]'::jsonb end) e
                       where jsonb_typeof(e) = 'number' and (e::text)::numeric > 0)
                else 0 end
         ) >= 9
$$;
revoke all on function public.team_rounds_in_year(integer) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.send_season_wrapped(p_year integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer;
begin
  insert into notifications (user_id, message, type, link, detail)
  select u.user_id,
         'Your ' || p_year || ' season summary is ready — tap to see it.',
         'season_wrapped',
         '/?wrapped=' || p_year,
         u.n || ' round' || case when u.n = 1 then '' else 's' end || ' in ' || p_year
    from (select x.user_id, count(*) n from (
             select r.user_id from rounds r
              where extract(year from r.played_at) = p_year and coalesce(r.status,'final') = 'final' and r.deleted_at is null
             union all   -- 0213: scramble / alternate-shot team rounds count as played
             select t.user_id from public.team_rounds_in_year(p_year) t
           ) x group by x.user_id) u
    join profiles p on p.id = u.user_id and p.account_status = 'active'   -- 209.0: active members only
   where not exists (select 1 from notifications n where n.user_id = u.user_id and n.type = 'season_wrapped' and n.link = '/?wrapped=' || p_year);
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.season_wrapped_preview(p_year integer)
 RETURNS TABLE(display_name text, email text, rounds bigint, already_sent boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or (auth.uid() is null and coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon'))) then
    raise exception 'system admin only' using errcode = '42501';
  end if;
  return query
  select p.display_name, p.email, u.n,
         exists (select 1 from notifications n where n.user_id = u.user_id and n.type = 'season_wrapped' and n.link = '/?wrapped=' || p_year)
    from (select x.user_id, count(*) n from (
             select r.user_id from rounds r
              where extract(year from r.played_at) = p_year and coalesce(r.status,'final') = 'final' and r.deleted_at is null
             union all   -- 0213: scramble / alternate-shot team rounds count as played
             select t.user_id from public.team_rounds_in_year(p_year) t
           ) x group by x.user_id) u
    join profiles p on p.id = u.user_id and p.account_status = 'active'
   order by u.n desc, p.display_name;
end $function$;

CREATE OR REPLACE FUNCTION public.season_club_stats(p_year integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'name', g.name,
           'members', (select count(*) from group_members gm where gm.group_id = g.id and gm.status = 'active'),
           'total_rounds', (select count(*) from rounds r
                             where r.group_id = g.id and extract(year from r.played_at) = p_year
                               and coalesce(r.status,'final') = 'final' and r.deleted_at is null)
                         + (select count(*) from public.team_rounds_in_year(p_year) t where t.group_id = g.id),   -- 0213
           'rounds_by_member', (select coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', p.display_name, 'rounds', c.n) order by c.n desc, p.display_name), '[]'::jsonb)
                                  from (select x.user_id, count(*) n from (
                                          select r.user_id from rounds r
                                           where r.group_id = g.id and extract(year from r.played_at) = p_year
                                             and coalesce(r.status,'final') = 'final' and r.deleted_at is null
                                          union all   -- 0213
                                          select t.user_id from public.team_rounds_in_year(p_year) t where t.group_id = g.id
                                        ) x group by x.user_id) c join profiles p on p.id = c.user_id)
         ) order by g.name), '[]'::jsonb)
    from groups g
   where auth.uid() is not null
     and exists (select 1 from group_members gm where gm.group_id = g.id and gm.user_id = auth.uid() and gm.status = 'active');
$function$;

-- the team-round recap email
create table if not exists public.team_round_email_log (
  id bigserial primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  error text,
  at timestamptz not null default now()
);
create index if not exists team_round_email_log_game_user on public.team_round_email_log (game_id, user_id);
alter table public.team_round_email_log enable row level security;
revoke all on public.team_round_email_log from anon, authenticated;
-- account merges move the log with the account, as for the round-email log (account_reference_columns, 0190)
insert into public.account_reference_columns(table_name, column_name, rule, key_columns, activity, note)
values ('team_round_email_log', 'user_id', 'move', null, false, 'team-round email log')
on conflict do nothing;

create or replace function public.due_team_round_emails(p_limit integer default 20)
returns table(game_id uuid, user_id uuid, email text, display_name text)
language plpgsql stable security definer set search_path = public as $$
declare v_mode text;
begin
  if not public.round_email_server_session() then raise exception 'round emails are sent by the server' using errcode = '42501'; end if;
  select coalesce(value->>'recipients', 'owner') into v_mode from app_settings where key = 'round_emails';
  return query
  select distinct t.game_id, t.user_id, p.email, p.display_name
    from games g
    join lateral public.team_rounds_in_year(extract(year from g.played_at)::int) t on t.game_id = g.id
    join profiles p on p.id = t.user_id
   where g.game_type in ('scramble', 'alt_shot') and g.status = 'ended'
     and coalesce(g.ended_at, g.played_at) between now() - interval '7 days' and now() - interval '1 hour'
     and p.account_status = 'active' and p.round_emails and p.email is not null
     and (coalesce(v_mode, 'owner') = 'everyone' or coalesce(p.is_owner, false))
     and not exists (select 1 from team_round_email_log l where l.game_id = t.game_id and l.user_id = t.user_id and l.status in ('sent', 'skipped'))
     and not exists (select 1 from team_round_email_log l where l.game_id = t.game_id and l.user_id = t.user_id and l.at > now() - interval '1 hour')
   limit greatest(1, least(coalesce(p_limit, 20), 100));
end $$;
revoke all on function public.due_team_round_emails(integer) from public, anon, authenticated;

create or replace function public.record_team_round_email(p_game uuid, p_user uuid, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.round_email_server_session() then raise exception 'round emails are sent by the server' using errcode = '42501'; end if;
  insert into team_round_email_log(game_id, user_id, status, error) values (p_game, p_user, p_status, p_error);
end $$;
revoke all on function public.record_team_round_email(uuid, uuid, text, text) from public, anon, authenticated;

select public.record_migration('0213_team_rounds');

commit;
