-- 0083_ops_autofinish_and_funnel.sql
-- Two operational features:
--   (A) Auto-finish stale-but-complete in-progress rounds so a forgotten "finish" tap
--       doesn't keep a real round out of the player's handicap. Abandoned partials are
--       left alone. Every finalize (manual or auto) is now attributed.
--   (B) Admin ops metrics: profile-completion nudge funnel + stale-round + incomplete
--       profile counts.
-- Safe to run multiple times.

-- (A1) Attribution for round finalization.
alter table public.rounds add column if not exists finished_by text;       -- member uuid (as text) or 'system:auto'
alter table public.rounds add column if not exists finished_at timestamptz;

-- (A2) Throttle registry so the global sweep runs at most hourly no matter how many
--      app-opens call it. Touched only by SECURITY DEFINER functions.
create table if not exists public.system_jobs (
  job      text primary key,
  last_run timestamptz not null default now()
);
alter table public.system_jobs enable row level security;

-- (A3) Finalize stale (24h+), COMPLETE (18+ holes scored) in-progress rounds. Partial
--      abandons are skipped. Self-throttled to once/hour. Attributed 'system:auto'.
create or replace function public.finish_stale_rounds()
returns int
language plpgsql security definer set search_path = public as $fn$
declare
  v_last  timestamptz;
  v_count int := 0;
begin
  select last_run into v_last from system_jobs where job = 'finish_stale_rounds';
  if v_last is not null and v_last > now() - interval '1 hour' then
    return 0;                                   -- ran recently; skip the sweep
  end if;
  insert into system_jobs (job, last_run) values ('finish_stale_rounds', now())
    on conflict (job) do update set last_run = now();

  with eligible as (
    select r.id,
           (select sum(h.strokes) from holes h where h.round_id = r.id and h.strokes is not null) as gross,
           (select count(*)       from holes h where h.round_id = r.id and h.strokes is not null) as scored
    from rounds r
    where coalesce(r.status, 'final') = 'in_progress'
      and r.deleted_at is null
      and r.created_at < now() - interval '24 hours'
  ), done as (
    update rounds r
       set status      = 'final',
           finished_by = 'system:auto',
           finished_at = now(),
           gross_score = coalesce(r.gross_score, e.gross),
           played_at   = coalesce(r.played_at, r.created_at::date)
      from eligible e
     where r.id = e.id and e.scored >= 18
    returning r.id
  )
  select count(*) into v_count from done;
  return v_count;
end $fn$;
grant execute on function public.finish_stale_rounds() to authenticated;

-- (B) Admin ops metrics (nudge funnel + stale/ incomplete counts). is_admin-gated.
create or replace function public.get_ops_metrics()
returns jsonb
language sql security definer set search_path = public as $fn$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'nudge_shown_7d',    (select count(*) from activity_log where action = 'profile_nudge_shown'   and created_at > now() - interval '7 days'),
    'nudge_clicked_7d',  (select count(*) from activity_log where action = 'profile_nudge_clicked' and created_at > now() - interval '7 days'),
    'nudge_shown_28d',   (select count(*) from activity_log where action = 'profile_nudge_shown'   and created_at > now() - interval '28 days'),
    'nudge_clicked_28d', (select count(*) from activity_log where action = 'profile_nudge_clicked' and created_at > now() - interval '28 days'),
    'profiles_incomplete', (select count(*) from profiles
                              where coalesce(deactivated, false) = false
                                and (avatar_url is null or handicap_index is null)),
    'stale_ready',   (select count(*) from rounds r
                        where coalesce(r.status,'final') = 'in_progress' and r.deleted_at is null
                          and r.created_at < now() - interval '24 hours'
                          and (select count(*) from holes h where h.round_id = r.id and h.strokes is not null) >= 18),
    'stale_partial', (select count(*) from rounds r
                        where coalesce(r.status,'final') = 'in_progress' and r.deleted_at is null
                          and r.created_at < now() - interval '24 hours'
                          and (select count(*) from holes h where h.round_id = r.id and h.strokes is not null) < 18),
    'auto_finished_7d', (select count(*) from rounds where finished_by = 'system:auto' and finished_at > now() - interval '7 days')
  ) end;
$fn$;
grant execute on function public.get_ops_metrics() to authenticated;
