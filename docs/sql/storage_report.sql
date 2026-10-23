-- storage_report.sql — READ-ONLY. Run on PRODUCTION to see how big the database is and what is growing (212.28).
-- Supabase plans cap the database (Free 500 MB, Pro 8 GB included); this shows how close we are and which tables
-- only ever grow (logs, notifications, audit trails).

-- 1. The whole database
select pg_size_pretty(pg_database_size(current_database())) as database_size;

-- 2. The 15 largest tables (rows, and size including their indexes)
select c.relname as table_name,
       c.reltuples::bigint as approx_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by pg_total_relation_size(c.oid) desc
 limit 15;

-- 3. Tables that only ever grow: rows added in the last 30 days, and in total
select 'activity_log' as table_name, (select count(*) from public.activity_log where created_at > now() - interval '30 days') as last_30_days, (select count(*) from public.activity_log) as total
union all select 'notifications', (select count(*) from public.notifications where created_at > now() - interval '30 days'), (select count(*) from public.notifications)
union all select 'money_audit', (select count(*) from public.money_audit where created_at > now() - interval '30 days'), (select count(*) from public.money_audit)
union all select 'round_email_log', (select count(*) from public.round_email_log where at > now() - interval '30 days'), (select count(*) from public.round_email_log)
union all select 'holes', (select count(*) from public.holes h join public.rounds r on r.id = h.round_id where r.created_at > now() - interval '30 days'), (select count(*) from public.holes);
