-- 0172_push_delivery_log.sql
--
-- "Have I ever been sent a push?" had no answer in the app.
--
-- /api/push (the Supabase Database Webhook target) decided and sent, and kept nothing. When the
-- owner asked why his enrolled phone had received no pushes, the only honest reply was a SQL
-- query guessing whether a push-eligible notification had existed. This table records every
-- webhook call: the notification, the recipient, the type, what the preference decided
-- (push / inapp / off), how many endpoints were tried, how many succeeded and failed, and a short
-- result note. Test pushes (/api/push/test) land here too, marked as such.
--
-- AUTHORIZATION: written by the server with the service role only. admin_push_delivery_log is the
-- is_admin() reader; my_push_delivery_log returns the caller's own rows so the Notification
-- settings screen can show "your last pushes" to the person they were sent to.
--
-- Idempotent; safe to re-run.

begin;

create table if not exists public.push_delivery_log (
  id               bigserial primary key,
  at               timestamptz not null default now(),
  notification_id  uuid,
  user_id          uuid not null,
  type             text,
  delivery         text not null,            -- push | inapp | off | test
  endpoints        integer not null default 0,
  sent             integer not null default 0,
  failed           integer not null default 0,
  result           text
);
create index if not exists push_delivery_log_user_at on public.push_delivery_log (user_id, at desc);
create index if not exists push_delivery_log_at on public.push_delivery_log (at desc);
alter table public.push_delivery_log enable row level security;
revoke all on table public.push_delivery_log from public, anon, authenticated;
grant select, insert, delete on table public.push_delivery_log to service_role;

create or replace function public.admin_push_delivery_log(p_user uuid default null, p_limit integer default 50)
returns table (at timestamptz, user_name text, type text, delivery text, endpoints integer, sent integer, failed integer, result text)
language sql stable security definer set search_path = public as $$
  select l.at, coalesce(p.display_name, '(no name)'), l.type, l.delivery, l.endpoints, l.sent, l.failed, l.result
    from public.push_delivery_log l left join profiles p on p.id = l.user_id
   where public.is_admin() and (p_user is null or l.user_id = p_user)
   order by l.at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
revoke all on function public.admin_push_delivery_log(uuid, integer) from public, anon;
grant execute on function public.admin_push_delivery_log(uuid, integer) to authenticated;

create or replace function public.my_push_delivery_log(p_limit integer default 10)
returns table (at timestamptz, type text, delivery text, endpoints integer, sent integer, failed integer, result text)
language sql stable security definer set search_path = public as $$
  select l.at, l.type, l.delivery, l.endpoints, l.sent, l.failed, l.result
    from public.push_delivery_log l
   where auth.uid() is not null and l.user_id = auth.uid()
   order by l.at desc
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;
revoke all on function public.my_push_delivery_log(integer) from public, anon;
grant execute on function public.my_push_delivery_log(integer) to authenticated;

-- Retention: the nightly push prune (0170) also trims this log to 90 days.
create or replace function public.prune_push_subscriptions()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from push_subscriptions where last_seen < now() - interval '60 days';
  get diagnostics v_n = row_count;
  delete from push_delivery_log where at < now() - interval '90 days';
  return v_n;
end $$;
revoke all on function public.prune_push_subscriptions() from public, anon, authenticated;

select public.record_migration('0172_push_delivery_log');

commit;
