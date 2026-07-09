-- 0074_tee_reminders.sql
-- Time-based tee-time reminders, delivered through the existing
-- notifications -> Database Webhook -> /api/push pipeline (type 'tee_reminder', def push).
-- The scheduler only INSERTS notification rows; no pg_net / Edge Function needed.
--
-- Two reminders, both de-duplicated per (user, tee time, reminder-kind) via the link marker:
--   A) Deadline nudge  : 24h before signup_deadline, to ACTIVE club members who have NOT responded.
--   B) Morning-of      : 06:00-11:59 America/New_York on play_date, to players who chose 'in'.
--
-- pg_cron runs in UTC; that is fine because the windows are computed against stored
-- timestamps (signup_deadline is timestamptz; play_date is compared in America/New_York).

create extension if not exists pg_cron;

create or replace function public.send_tee_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A) Deadline nudge: within 24h of the signup deadline, members with no RSVP row yet.
  insert into notifications (user_id, message, group_id, type, link)
  select gm.user_id,
         'RSVP closes soon for the ' || to_char(t.play_date, 'Dy, Mon FMDD')
           || ' tee time — let your club know if you''re in.',
         t.group_id,
         'tee_reminder',
         '/?tt=' || t.id::text || '&r=deadline'
  from public.tee_times t
  join public.group_members gm
    on gm.group_id = t.group_id
   and gm.status = 'active'
   and gm.user_id is not null
  where t.status = 'upcoming'
    and t.signup_deadline is not null
    and now() >= t.signup_deadline - interval '24 hours'
    and now() <  t.signup_deadline
    and not exists (
      select 1 from public.tee_time_rsvps r
      where r.tee_time_id = t.id and r.user_id = gm.user_id
    )
    and not exists (
      select 1 from public.notifications n
      where n.user_id = gm.user_id
        and n.type = 'tee_reminder'
        and n.link = '/?tt=' || t.id::text || '&r=deadline'
    );

  -- B) Morning-of: on the play date (06:00-11:59 Eastern), to players who said 'in'.
  insert into notifications (user_id, message, group_id, type, link)
  select r.user_id,
         'Tee time today — ' || to_char(t.play_date, 'Dy, Mon FMDD') || '. See you out there.',
         t.group_id,
         'tee_reminder',
         '/?tt=' || t.id::text || '&r=day'
  from public.tee_times t
  join public.tee_time_rsvps r
    on r.tee_time_id = t.id
   and r.choice = 'in'
   and r.user_id is not null
  where t.status = 'upcoming'
    and (now() at time zone 'America/New_York')::date = t.play_date
    and extract(hour from (now() at time zone 'America/New_York')) >= 6
    and extract(hour from (now() at time zone 'America/New_York')) < 12
    and not exists (
      select 1 from public.notifications n
      where n.user_id = r.user_id
        and n.type = 'tee_reminder'
        and n.link = '/?tt=' || t.id::text || '&r=day'
    );
end;
$$;

-- Schedule it every 15 minutes. Idempotent: drop an existing job of the same name first.
do $$
begin
  perform cron.unschedule('tee-reminders');
exception when others then
  null;
end;
$$;

select cron.schedule('tee-reminders', '*/15 * * * *', $$ select public.send_tee_reminders(); $$);
