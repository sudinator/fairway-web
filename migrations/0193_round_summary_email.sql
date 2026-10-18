-- 0193_round_summary_email.sql
--
-- Round-summary email (209.3). Owner decisions (Oct 2026): OPT-OUT (on for every member, off in Notification
-- settings or by the email's one-click link); ALL rounds (game and solo); sent an hour after the round, then
-- "Updated:" if the round changes later (at most hourly, for a week); ONLY THE OWNER receives it while it is
-- honed — opening it to everyone is one setting, no release.
--
--   * profiles.round_emails — the member's switch (default on). Not a privileged column: members change it.
--   * app_settings — { key: value } for app-wide switches. 'round_emails' = {"recipients": "owner" | "everyone"};
--     starts as "owner" (the profile marked is_owner — no address is written here).
--   * round_email_log — every send attempt: which round, whose, the content fingerprint, sent / failed.
--   * email_ticks — a pg_cron job adds a row every 10 minutes; a Supabase Database Webhook on its INSERT calls
--     /api/round-emails (same x-webhook-secret as push). Old ticks are pruned by the same job.
--   * due_round_emails() — SERVER ONLY: rounds finished 1 hour to 7 days ago, for members who receive them,
--     not emailed in the last hour; with the last fingerprint sent (the server compares, and sends "Updated:").
--   * record_round_email(...) — SERVER ONLY: log one attempt.
--
-- AUTHORIZATION: due_round_emails / record_round_email — service role only (EXECUTE revoked from app roles;
-- the CI check is by privilege, never by calling — 208.4). Tables: RLS on, no app access.
--
-- Idempotent; safe to re-run.

begin;

alter table public.profiles add column if not exists round_emails boolean not null default true;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
insert into public.app_settings(key, value) values ('round_emails', '{"recipients": "owner"}') on conflict (key) do nothing;

create table if not exists public.round_email_log (
  id bigserial primary key,
  round_id uuid not null,
  user_id uuid not null,
  fingerprint text,
  kind text not null check (kind in ('summary', 'update')),
  status text not null check (status in ('sent', 'failed')),
  error text,
  at timestamptz not null default now()
);
create index if not exists round_email_log_round_idx on public.round_email_log(round_id, at desc);
alter table public.round_email_log enable row level security;
revoke all on public.round_email_log from anon, authenticated;

create table if not exists public.email_ticks (id bigserial primary key, at timestamptz not null default now());
alter table public.email_ticks enable row level security;
revoke all on public.email_ticks from anon, authenticated;

-- Merges must move these rows too (0190's registry; CI fails on an unclassified account column).
insert into public.account_reference_columns(table_name, column_name, rule, key_columns, activity, note)
values ('round_email_log', 'user_id', 'move', null, false, 'email send log')
on conflict (table_name, column_name) do nothing;

create or replace function public.round_email_server_session()
returns boolean language sql stable as $$
  select coalesce(current_setting('role', true), 'none') = 'service_role'
      or (session_user in ('postgres', 'supabase_admin') and coalesce(current_setting('role', true), 'none') in ('none', 'postgres', 'supabase_admin'))
$$;

create or replace function public.due_round_emails(p_limit integer default 20)
returns table (round_id uuid, user_id uuid, email text, display_name text, game_id uuid, last_fingerprint text, ever_sent boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_mode text;
begin
  if not public.round_email_server_session() then raise exception 'round emails are sent by the server' using errcode = '42501'; end if;
  select coalesce(value->>'recipients', 'owner') into v_mode from app_settings where key = 'round_emails';
  return query
  select r.id, r.user_id, p.email, p.display_name, r.game_id,
         (select l.fingerprint from round_email_log l where l.round_id = r.id and l.status = 'sent' order by l.at desc limit 1),
         exists (select 1 from round_email_log l where l.round_id = r.id and l.status = 'sent')
    from rounds r
    join profiles p on p.id = r.user_id
   where coalesce(r.status, 'final') = 'final' and r.deleted_at is null
     and coalesce(r.finished_at, r.created_at) between now() - interval '7 days' and now() - interval '1 hour'
     and p.account_status = 'active' and p.round_emails and p.email is not null
     and (coalesce(v_mode, 'owner') = 'everyone' or coalesce(p.is_owner, false))
     and not exists (select 1 from round_email_log l where l.round_id = r.id and l.at > now() - interval '1 hour')
   order by coalesce(r.finished_at, r.created_at)
   limit greatest(1, least(coalesce(p_limit, 20), 100));
end $$;
revoke all on function public.due_round_emails(integer) from public, anon, authenticated;
grant execute on function public.due_round_emails(integer) to service_role;

create or replace function public.record_round_email(p_round uuid, p_user uuid, p_fingerprint text, p_kind text, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.round_email_server_session() then raise exception 'round emails are sent by the server' using errcode = '42501'; end if;
  insert into round_email_log(round_id, user_id, fingerprint, kind, status, error) values (p_round, p_user, p_fingerprint, p_kind, p_status, left(p_error, 500));
end $$;
revoke all on function public.record_round_email(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_round_email(uuid, uuid, text, text, text, text) to service_role;

-- The 10-minute timer. A Supabase Database Webhook on email_ticks INSERT calls /api/round-emails.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'round-email-tick';
    perform cron.schedule('round-email-tick', '*/10 * * * *',
      $job$insert into public.email_ticks default values; delete from public.email_ticks where at < now() - interval '1 day'$job$);
  end if;
end $$;

select public.record_migration('0193_round_summary_email');

commit;
