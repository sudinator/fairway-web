-- 0135_ledger_backfill.sql
-- Evidence-based backfill for migrations 0122-0128, which predated permanent enforcement that every
-- post-0113 migration self-record. This migration NEVER marks a migration merely because its file exists;
-- it records only when a sentinel object/definition/privilege proves the corresponding change is present.
-- Run as the database owner/postgres in the Supabase SQL editor: migration 0123 intentionally revoked
-- record_migration(text) from public/anon/authenticated so ordinary app identities cannot forge the ledger.

-- 0122: side-contest tables are unique to this migration.
select public.record_migration('0122_side_contests')
where to_regclass('public.game_contests') is not null
  and to_regclass('public.game_contest_entries') is not null;

-- 0123: AI usage tables + hardened record_migration grant surface.
select public.record_migration('0123_api_hardening')
where to_regclass('public.ai_usage_daily') is not null
  and to_regclass('public.ai_usage_global') is not null
  and to_regprocedure('public.bump_ai_usage(text,integer,integer)') is not null
  and not has_function_privilege('authenticated', 'public.record_migration(text)', 'EXECUTE');

-- 0124: freshness cache table and RPC family introduced.
select public.record_migration('0124_course_freshness')
where to_regclass('public.course_freshness') is not null
  and to_regprocedure('public.record_course_freshness(uuid,jsonb,jsonb,boolean)') is not null
  and to_regprocedure('public.set_course_freshness_status(uuid,text)') is not null;

-- 0125: status-domain constraint proves the authorization correction migration was applied.
select public.record_migration('0125_course_freshness_authorization')
where exists (
  select 1
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'course_freshness'
    and c.conname = 'course_freshness_status_check'
);

-- 0126: same RPC signatures as 0125; distinguish it by the canonical authorization helpers in the
-- deployed function definitions.
select public.record_migration('0126_course_freshness_use_canonical_auth')
where to_regprocedure('public.record_course_freshness(uuid,jsonb,jsonb,boolean)') is not null
  and to_regprocedure('public.set_course_freshness_status(uuid,text)') is not null
  and pg_get_functiondef('public.record_course_freshness(uuid,jsonb,jsonb,boolean)'::regprocedure)
        ~ 'is_group_member'
  and pg_get_functiondef('public.set_course_freshness_status(uuid,text)'::regprocedure)
        ~ 'is_group_admin';

-- 0127: system-function lockdown removed app-role EXECUTE from the cron-only reapers while retaining
-- authenticated access to the deliberately client-triggered stale-round sweep.
select public.record_migration('0127_system_function_lockdown')
where to_regprocedure('public.purge_old_notifications()') is not null
  and to_regprocedure('public.send_tee_reminders()') is not null
  and to_regprocedure('public.finish_stale_rounds()') is not null
  and not has_function_privilege('authenticated', 'public.purge_old_notifications()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.send_tee_reminders()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.finish_stale_rounds()', 'EXECUTE');

-- 0128: generic API rate-limit table + RPC.
select public.record_migration('0128_rate_limit')
where to_regclass('public.api_rate_limits') is not null
  and to_regprocedure('public.bump_rate_limit(text,integer,integer)') is not null;

select public.record_migration('0135_ledger_backfill');
