-- 0120: publish tee time tables to the realtime stream so the Tee Times tab updates live
-- (new tee times, RSVPs, waitlist, cancellations, reordering) without a manual pull-to-refresh.
-- Idempotent: only adds each table if the publication exists and the table isn't already a member.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tee_times') then
      alter publication supabase_realtime add table public.tee_times;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tee_time_rsvps') then
      alter publication supabase_realtime add table public.tee_time_rsvps;
    end if;
  end if;
end $$;

select record_migration('0120_teetimes_realtime');
