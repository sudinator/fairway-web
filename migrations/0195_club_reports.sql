-- 0195_club_reports.sql
--
-- Publishing the club report (210.1). Owner decisions (Oct 2026): two reports a year — July 1 (January–June)
-- and October 1 (July–September); the whole year is Season Wrapped. Each club's report is posted on the club
-- page, pushed to its members, and emailed to them — with its own "Club report emails" switch (on by default)
-- and a one-click turn-off. ONLY THE OWNER receives the emails at first; "everyone" is one setting.
--
--   * profiles.club_report_emails — the member's switch (default on).
--   * club_reports — one FROZEN report per club per period (snapshot = the report as published). Members of the
--     club can read it; nothing in the app writes it.
--   * club_report_email_log — every send attempt.
--   * queue_club_reports(period_key, label, from, to) — SERVER/cron: one row (snapshot pending) for each active
--     club with finished games in the period. The 10-minute email tick (0193 webhook) then builds the snapshot
--     with the app's shared code (lib/club-report), posts it, notifies members, and sends the emails.
--   * pg_cron: July 1 and October 1, 13:00 UTC (9 am Eastern).
--
-- AUTHORIZATION: queue_club_reports / due_club_report_emails / save_club_report / record_club_report_email —
-- server only (EXECUTE revoked from app roles; checked by privilege, never by calling — 208.4). club_reports
-- readable by the club's members (and system admins).
--
-- Idempotent; safe to re-run.

begin;

alter table public.profiles add column if not exists club_report_emails boolean not null default true;
insert into public.app_settings(key, value) values ('club_reports', '{"recipients": "owner"}') on conflict (key) do nothing;

create table if not exists public.club_reports (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  period_key text not null,
  period_label text not null,
  period_from date not null,
  period_to date not null,
  snapshot jsonb,
  published_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (group_id, period_key)
);
alter table public.club_reports enable row level security;
revoke all on public.club_reports from anon, authenticated;
grant select on public.club_reports to authenticated;
drop policy if exists club_reports_members_read on public.club_reports;
create policy club_reports_members_read on public.club_reports for select to authenticated
  using (snapshot is not null and (public.is_admin() or public.is_group_member(group_id, auth.uid())));

create table if not exists public.club_report_email_log (
  id bigserial primary key,
  report_id uuid not null references public.club_reports(id) on delete cascade,
  user_id uuid not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  at timestamptz not null default now()
);
create index if not exists club_report_email_log_idx on public.club_report_email_log(report_id, user_id);
alter table public.club_report_email_log enable row level security;
revoke all on public.club_report_email_log from anon, authenticated;

insert into public.account_reference_columns(table_name, column_name, rule, key_columns, activity, note)
values ('club_report_email_log', 'user_id', 'move', null, false, 'club report email log')
on conflict (table_name, column_name) do nothing;

-- Queue one report per active club with finished games in the period (snapshot built by the server).
create or replace function public.queue_club_reports(p_key text, p_label text, p_from date, p_to date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.round_email_server_session() then raise exception 'club reports are queued by the server' using errcode = '42501'; end if;
  insert into club_reports(group_id, period_key, period_label, period_from, period_to)
  select g.id, p_key, p_label, p_from, p_to from groups g
   where g.status = 'active'
     and exists (select 1 from games x where x.group_id = g.id and x.status = 'ended' and x.played_at::date between p_from and p_to)
  on conflict (group_id, period_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.queue_club_reports(text, text, date, date) from public, anon, authenticated;
grant execute on function public.queue_club_reports(text, text, date, date) to service_role;

-- Save the built snapshot and notify the club's members (once).
create or replace function public.save_club_report(p_report uuid, p_snapshot jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.round_email_server_session() then raise exception 'club reports are saved by the server' using errcode = '42501'; end if;
  select * into r from club_reports where id = p_report for update;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
  update club_reports set snapshot = p_snapshot, published_at = coalesce(published_at, now()) where id = p_report;
  if r.notified_at is null then
    insert into notifications(user_id, group_id, type, message, link)
    select gm.user_id, r.group_id, 'club_report', 'Your club''s report for ' || r.period_label || ' is ready — tap to see it.', '/?tab=manage&manage=groups'
      from group_members gm join profiles p on p.id = gm.user_id
     where gm.group_id = r.group_id and gm.status = 'active' and gm.user_id is not null and p.account_status = 'active';
    update club_reports set notified_at = now() where id = p_report;
  end if;
end $$;
revoke all on function public.save_club_report(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_club_report(uuid, jsonb) to service_role;

-- Who still needs the email: the club's active members who receive club report emails (owner only while it's honed).
create or replace function public.due_club_report_emails(p_limit integer default 20)
returns table (report_id uuid, user_id uuid, email text, display_name text, group_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_mode text;
begin
  if not public.round_email_server_session() then raise exception 'club report emails are sent by the server' using errcode = '42501'; end if;
  select coalesce(value->>'recipients', 'owner') into v_mode from app_settings where key = 'club_reports';
  return query
  select r.id, p.id, p.email, p.display_name, r.group_id
    from club_reports r
    join profiles p on p.account_status = 'active' and p.club_report_emails and p.email is not null
   where r.snapshot is not null and r.published_at > now() - interval '14 days'
     and (
       (coalesce(v_mode, 'owner') = 'everyone' and exists (select 1 from group_members gm where gm.group_id = r.group_id and gm.user_id = p.id and gm.status = 'active'))
       or (coalesce(v_mode, 'owner') <> 'everyone' and coalesce(p.is_owner, false))
     )
     and not exists (select 1 from club_report_email_log l where l.report_id = r.id and l.user_id = p.id and (l.status = 'sent' or l.at > now() - interval '1 hour'))
   order by r.published_at
   limit greatest(1, least(coalesce(p_limit, 20), 100));
end $$;
revoke all on function public.due_club_report_emails(integer) from public, anon, authenticated;
grant execute on function public.due_club_report_emails(integer) to service_role;

create or replace function public.record_club_report_email(p_report uuid, p_user uuid, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.round_email_server_session() then raise exception 'club report emails are sent by the server' using errcode = '42501'; end if;
  insert into club_report_email_log(report_id, user_id, status, error) values (p_report, p_user, p_status, left(p_error, 500));
end $$;
revoke all on function public.record_club_report_email(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_club_report_email(uuid, uuid, text, text) to service_role;

-- July 1 (January–June) and October 1 (July–September), 13:00 UTC = 9 am Eastern.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('club-report-h1', 'club-report-q3');
    perform cron.schedule('club-report-h1', '0 13 1 7 *',
      $job$select public.queue_club_reports(extract(year from now())::int || '-H1', 'January–June ' || extract(year from now())::int, make_date(extract(year from now())::int, 1, 1), make_date(extract(year from now())::int, 6, 30))$job$);
    perform cron.schedule('club-report-q3', '0 13 1 10 *',
      $job$select public.queue_club_reports(extract(year from now())::int || '-Q3', 'July–September ' || extract(year from now())::int, make_date(extract(year from now())::int, 7, 1), make_date(extract(year from now())::int, 9, 30))$job$);
  end if;
end $$;

select public.record_migration('0195_club_reports');

commit;
