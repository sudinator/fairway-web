-- 0198_email_and_announcement_hardening.sql
--
-- 210.7 — the last two findings from the external review.
--
-- Point 5 · Round emails never disappear silently. The selector could pick a finished round with no hole-by-hole
-- data; the sender skipped it without a word, picked it again every tick, and 20 such rounds could block the
-- batch. Now: rounds with no hole data are excluded by the selector, explicitly (there is no scorecard to
-- summarise); anything else the sender can't build is logged as 'skipped' with its reason and never picked
-- again; a failed read is logged as 'failed'.
--
-- Point 6 · A recap announcement can always be retried. The server recorded the announcement, then inserted the
-- notifications separately; if the insert failed, a retry saw "already announced" and the notifications were
-- never sent. announce_game_recap does both in ONE transaction — the claim and the members' notifications
-- (the route prepares the wording for both outcomes, "final" and "results updated") — so a failure undoes the
-- claim too, and a retry starts clean.
--
-- AUTHORIZATION: due_round_emails, announce_game_recap — service role only (EXECUTE revoked from app roles;
-- checked by privilege, never by calling — 208.4).
--
-- Idempotent; safe to re-run.

begin;

-- ---------------------------------------------------------------- point 5
alter table public.round_email_log drop constraint if exists round_email_log_status_check;
alter table public.round_email_log add constraint round_email_log_status_check check (status in ('sent', 'failed', 'skipped'));

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
     -- 210.7 (review point 5): a round with no hole-by-hole data has no scorecard to summarise — excluded here,
     -- explicitly, rather than picked every tick and silently skipped; and a round the sender logged as SKIPPED
     -- (with its reason) is never picked again.
     and exists (select 1 from holes h where h.round_id = r.id)
     and not exists (select 1 from round_email_log l where l.round_id = r.id and l.status = 'skipped')
     and coalesce(r.finished_at, r.created_at) between now() - interval '7 days' and now() - interval '1 hour'
     and p.account_status = 'active' and p.round_emails and p.email is not null
     and (coalesce(v_mode, 'owner') = 'everyone' or coalesce(p.is_owner, false))
     and not exists (select 1 from round_email_log l where l.round_id = r.id and l.at > now() - interval '1 hour')
   order by coalesce(r.finished_at, r.created_at)
   limit greatest(1, least(coalesce(p_limit, 20), 100));
end $$;
revoke all on function public.due_round_emails(integer) from public, anon, authenticated;
grant execute on function public.due_round_emails(integer) to service_role;

-- ---------------------------------------------------------------- point 6
create or replace function public.announce_game_recap(p_game uuid, p_signature text, p_final jsonb, p_updated jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare g record; v_claim text; v_rows jsonb;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select id, status, recap_signature into g from games where id = p_game for update;
  if not found then raise exception 'no such game' using errcode = 'P0002'; end if;
  if g.status is distinct from 'ended' then return 'not_ended'; end if;
  if g.recap_signature is not distinct from p_signature then return 'same'; end if;
  v_claim := case when g.recap_signature is null then 'final' else 'updated' end;
  update games set recap_signature = p_signature, recap_announced_at = now() where id = p_game;
  -- The members' notifications, in the SAME transaction: if this insert fails, the claim above is undone too.
  v_rows := case when v_claim = 'final' then p_final else p_updated end;
  if jsonb_typeof(v_rows) = 'array' and jsonb_array_length(v_rows) > 0 then
    insert into notifications(user_id, group_id, type, message, link, detail)
    select x.user_id, x.group_id, x.type, x.message, x.link, x.detail
      from jsonb_to_recordset(v_rows) as x(user_id uuid, group_id uuid, type text, message text, link text, detail text);
  end if;
  return v_claim;
end $$;
revoke all on function public.announce_game_recap(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.announce_game_recap(uuid, text, jsonb, jsonb) to service_role;

select public.record_migration('0198_email_and_announcement_hardening');

commit;
