-- 0123_api_hardening.sql
-- Two security fixes flagged in review:
--  (1) Move the AI daily limit from an in-memory serverless variable (resets on cold start,
--      per-instance, bypassable) to the database: atomic per-user + global counters that the
--      authenticated /api/analyze-round route checks before calling Gemini.
--  (2) Lock down record_migration() so ordinary members can't falsify the migration ledger.
-- Idempotent. Run after 0122.

-- ---------- (1) AI usage counters ----------
create table if not exists public.ai_usage_daily (
  user_id uuid not null,
  usage_date date not null default current_date,
  operation_type text not null,
  count int not null default 0,
  primary key (user_id, usage_date, operation_type)
);
create table if not exists public.ai_usage_global (
  usage_date date primary key default current_date,
  count int not null default 0
);
alter table public.ai_usage_daily enable row level security;
alter table public.ai_usage_global enable row level security;
-- No policies: these are written only by the SECURITY DEFINER function below and never read by clients.

-- Atomically check-and-increment. Returns {allowed, reason, used, limit}. auth.uid() identifies the
-- caller, so the route must invoke this with the user's session (not the anon/service key). The caps
-- are soft cost-guards layered on top of the real backstop (Gemini key on the free tier, no billing).
create or replace function public.bump_ai_usage(p_op text, p_user_limit int, p_global_limit int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); u_count int; g_count int;
begin
  if uid is null then raise exception 'authentication required' using errcode = '42501'; end if;

  select coalesce(count, 0) into u_count
    from ai_usage_daily where user_id = uid and usage_date = current_date and operation_type = p_op;
  if u_count >= greatest(p_user_limit, 0) then
    return jsonb_build_object('allowed', false, 'reason', 'user', 'used', u_count, 'limit', p_user_limit);
  end if;

  select coalesce(count, 0) into g_count from ai_usage_global where usage_date = current_date;
  if g_count >= greatest(p_global_limit, 0) then
    return jsonb_build_object('allowed', false, 'reason', 'global', 'used', g_count, 'limit', p_global_limit);
  end if;

  insert into ai_usage_daily (user_id, usage_date, operation_type, count)
    values (uid, current_date, p_op, 1)
    on conflict (user_id, usage_date, operation_type) do update set count = ai_usage_daily.count + 1;
  insert into ai_usage_global (usage_date, count)
    values (current_date, 1)
    on conflict (usage_date) do update set count = ai_usage_global.count + 1;

  return jsonb_build_object('allowed', true, 'used', u_count + 1, 'limit', p_user_limit);
end $$;
revoke all on function public.bump_ai_usage(text, int, int) from public;
grant execute on function public.bump_ai_usage(text, int, int) to authenticated;

-- ---------- (2) Lock down the migration ledger ----------
-- record_migration() is SECURITY DEFINER; granting it to authenticated let any signed-in user write a
-- fake ledger entry. Only the owner/service role should record migrations during deployment.
revoke execute on function public.record_migration(text) from public;
revoke execute on function public.record_migration(text) from anon;
revoke execute on function public.record_migration(text) from authenticated;
