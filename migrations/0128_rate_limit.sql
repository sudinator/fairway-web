-- 0128_rate_limit.sql
-- Follow-up security review (Aug 2026), finding #10: /api/courses required auth but had no per-user
-- volume cap, so one account could drive unlimited unique upstream calls against the metered course API.
-- Adds a generic, reusable per-user rate limiter (also usable by future endpoints) and wires courses to it.
-- Identity is ALWAYS auth.uid() server-side — the client cannot rate-limit as someone else. Bucket names
-- are allowlisted so a client can't spam arbitrary buckets to grow the table.
--
-- AUTHORIZATION: bump_rate_limit(bucket, limit, window_seconds) — callable by authenticated only; counts
-- against auth.uid() (server-derived); bucket restricted to a known allowlist; the api_rate_limits table is
-- RLS-locked with no policies so only this SECURITY DEFINER function can read/write it.

create table if not exists public.api_rate_limits (
  user_id      uuid        not null,
  bucket       text        not null,
  window_start timestamptz not null default now(),
  count        int         not null default 0,
  primary key (user_id, bucket)
);
alter table public.api_rate_limits enable row level security;
-- No policies: direct PostgREST access is denied; only the SECURITY DEFINER RPC below can touch it.

create or replace function public.bump_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_count int;
  v_start timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_bucket not in ('courses', 'ai') then
    raise exception 'unknown rate-limit bucket' using errcode = '22023';
  end if;
  if p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid limit/window' using errcode = '22023';
  end if;

  insert into api_rate_limits (user_id, bucket, window_start, count)
    values (v_uid, p_bucket, v_now, 1)
  on conflict (user_id, bucket) do update set
    window_start = case when api_rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
                        then v_now else api_rate_limits.window_start end,
    count        = case when api_rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
                        then 1 else api_rate_limits.count + 1 end
  returning count, window_start into v_count, v_start;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'reset_at', v_start + make_interval(secs => p_window_seconds)
  );
end $$;
revoke all on function public.bump_rate_limit(text, int, int) from public;
revoke all on function public.bump_rate_limit(text, int, int) from anon;
grant execute on function public.bump_rate_limit(text, int, int) to authenticated;

select public.record_migration('0128_rate_limit');
