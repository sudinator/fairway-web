-- 0231_test_clubs_out_of_stats.sql
--
-- 212.70 (owner, Oct 29): "exclude all matches played by the app testing group … all stats in that club must be excluded
-- like they don't exist." Test clubs (groups.is_test, 0106) never post rounds, so Rounds-based stats already leave them out;
-- the app now drops their games from the game-based readers (head-to-head, Season Wrapped — lib/test-clubs). Server side,
-- the one gap: a test club's quarterly report could still be emailed. due_club_report_emails now skips test clubs.
--
-- AUTHORIZATION: unchanged (the server session only).
-- TESTS: ci/assert-test-clubs.sql
--
-- Idempotent; safe to re-run.

begin;

CREATE OR REPLACE FUNCTION public.due_club_report_emails(p_limit integer DEFAULT 20)
 RETURNS TABLE(report_id uuid, user_id uuid, email text, display_name text, group_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_mode text;
begin
  if not public.round_email_server_session() then raise exception 'club report emails are sent by the server' using errcode = '42501'; end if;
  select coalesce(value->>'recipients', 'owner') into v_mode from app_settings where key = 'club_reports';
  return query
  select r.id, p.id, p.email, p.display_name, r.group_id
    from club_reports r
    join groups g on g.id = r.group_id and not g.is_test   -- 0231: a test club's report is never sent
    join profiles p on p.account_status = 'active' and p.club_report_emails and p.email is not null
   where r.snapshot is not null and r.published_at > now() - interval '14 days'
     and (
       (coalesce(v_mode, 'owner') = 'everyone' and exists (select 1 from group_members gm where gm.group_id = r.group_id and gm.user_id = p.id and gm.status = 'active'))
       or (coalesce(v_mode, 'owner') <> 'everyone' and coalesce(p.is_owner, false))
     )
     and not exists (select 1 from club_report_email_log l where l.report_id = r.id and l.user_id = p.id and (l.status = 'sent' or l.at > now() - interval '1 hour'))
   order by r.published_at
   limit greatest(1, least(coalesce(p_limit, 20), 100));
end $function$;

select public.record_migration('0231_test_clubs_out_of_stats');

commit;
