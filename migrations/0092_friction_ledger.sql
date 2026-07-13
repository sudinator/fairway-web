-- 0092_friction_ledger.sql
-- A daily "integrity sweep" agent. sweep_friction() scans for states the app should no
-- longer be able to produce, materialises each into friction_items (deduped by signature),
-- and auto-resolves any open warning whose data has since been cleaned. pg_cron runs it daily;
-- admins can force a run. When a NEW item is flagged, admins get one summary push (a notifications
-- row triggers the existing push webhook; type 'friction' defaults to push). Review/resolve RPCs
-- are is_admin-gated; the table is RLS-locked so all access goes through SECURITY DEFINER funcs
-- (the cron run has no auth context, so the non-forced sweep must NOT require is_admin).

create table if not exists public.friction_items (
  id           uuid primary key default gen_random_uuid(),
  signature    text unique not null,
  kind         text not null,                       -- dup_day | dup_game | multi_draft | integrity
  subject_user uuid references public.profiles(id) on delete cascade,
  round_ids    uuid[] not null default '{}',
  detail       text,
  status       text not null default 'open',        -- open | cleared | needs_action | auto_resolved
  reason       text,
  reviewed_by  uuid references public.profiles(id),
  reviewed_at  timestamptz,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);
alter table public.friction_items enable row level security;   -- no policy: definer-only access

-- ── The sweep ────────────────────────────────────────────────────────────────
create or replace function public.sweep_friction(p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_last timestamptz; v_start timestamptz := clock_timestamp(); v_open int; v_new int := 0;
begin
  if p_force then
    if not public.is_admin() then raise exception 'admins only'; end if;
  else
    select last_run into v_last from system_jobs where job = 'friction_sweep';
    if v_last is not null and v_last > now() - interval '20 hours' then
      return jsonb_build_object('skipped', true, 'reason', 'throttled');
    end if;
  end if;
  insert into system_jobs (job, last_run) values ('friction_sweep', now())
    on conflict (job) do update set last_run = now();

  with dup_game as (
    select user_id, array_agg(id order by id) rids
    from rounds where deleted_at is null and game_id is not null
    group by user_id, game_id having count(*) > 1
  ),
  dup_day_src as (
    select r.id, r.user_id, r.course, r.played_at, r.gross_score, coalesce(r.status,'final') st,
           (select count(*) from holes h where h.round_id = r.id and h.strokes is not null) scored
    from rounds r where r.deleted_at is null and r.played_at is not null and r.course is not null
  ),
  dup_day_win as (
    select s.*, count(*) filter (where s.gross_score is not null)
                  over (partition by s.user_id, s.course, s.played_at, s.gross_score) sg
    from dup_day_src s
  ),
  dup_day_grp as (
    select user_id, course, played_at, count(*) cnt,
           bool_or(st = 'in_progress' and scored < 18) has_partial,
           bool_or(st <> 'in_progress') has_final,
           max(sg) max_same_gross,
           array_agg(id order by id) rids
    from dup_day_win group by user_id, course, played_at
  ),
  dup_day as (
    select user_id, course, played_at, cnt, rids,
           (coalesce(max_same_gross,0) >= 2) dup_score,
           (has_partial and has_final) partial_restart
    from dup_day_grp
    where cnt >= 2 and (coalesce(max_same_gross,0) >= 2 or (has_partial and has_final))
  ),
  multi_draft as (
    select user_id, array_agg(id order by id) rids
    from rounds where deleted_at is null and coalesce(status,'final') = 'in_progress'
    group by user_id having count(*) >= 2
  ),
  integrity_rows as (
    select r.id, r.user_id, r.course,
           (select sum(h.strokes) from holes h where h.round_id = r.id and h.strokes is not null) strk,
           r.gross_score gross
    from rounds r
    where r.deleted_at is null and coalesce(r.status,'final') = 'final' and r.gross_score is not null
      and (select count(*) from holes h where h.round_id = r.id and h.strokes is not null) >= 18
      and (select sum(h.strokes) from holes h where h.round_id = r.id and h.strokes is not null) <> r.gross_score
  ),
  det as (
    select 'dup_game:'||md5(array_to_string(rids::text[], ',')) signature, 'dup_game' kind,
           user_id subject_user, rids,
           array_length(rids,1)||' rounds recorded for one game — should be exactly 1.' detail
    from dup_game
    union all
    select 'dup_day:'||md5(array_to_string(rids::text[], ',')), 'dup_day', user_id, rids,
           'Duplicate rounds at '||coalesce(course,'a course')||' on '||played_at::text||' — '||cnt||' rounds'||
             case when dup_score then ', identical scores' else '' end||
             case when partial_restart then ', a stray partial beside a completed round' else '' end||'.'
    from dup_day
    union all
    select 'multi_draft:'||md5(array_to_string(rids::text[], ',')), 'multi_draft', user_id, rids,
           array_length(rids,1)||' unfinished draft rounds open at once — the app now allows only one.'
    from multi_draft
    union all
    select 'integrity:'||id::text, 'integrity', user_id, array[id],
           'Final round at '||coalesce(course,'a course')||': hole strokes total '||strk||' but gross score is '||gross||'.'
    from integrity_rows
  ),
  ins as (
    insert into friction_items (signature, kind, subject_user, round_ids, detail, first_seen, last_seen, status)
    select signature, kind, subject_user, rids, detail, now(), now(), 'open' from det
    on conflict (signature) do update
      set last_seen = now(), detail = excluded.detail,
          subject_user = excluded.subject_user, round_ids = excluded.round_ids,
          status = case when friction_items.status = 'auto_resolved' then 'open' else friction_items.status end
    returning (xmax = 0) as is_new     -- true only for a fresh INSERT, not a conflict-update
  )
  select count(*) filter (where is_new) into v_new from ins;

  -- self-heal: open items not re-detected this run have been cleaned up
  update friction_items set status = 'auto_resolved', reviewed_at = now()
    where status = 'open' and last_seen < v_start;

  -- alert admins once per run when something NEW was flagged
  if v_new > 0 then
    insert into notifications (user_id, message, type, link)
    select p.id,
           v_new || ' new data-integrity flag' || case when v_new = 1 then '' else 's' end || ' to review',
           'friction', '/'
    from profiles p
    where coalesce(p.is_admin, false) = true and coalesce(p.deactivated, false) = false;
  end if;

  select count(*) into v_open from friction_items where status = 'open';
  return jsonb_build_object('ran', true, 'open', v_open, 'new', v_new, 'at', v_start);
end $fn$;
grant execute on function public.sweep_friction(boolean) to authenticated;

-- ── Review / resolve (is_admin-gated) ───────────────────────────────────────
create or replace function public.get_friction_items(p_status text default 'open')
returns table(id uuid, kind text, subject_name text, detail text, round_ids uuid[],
              status text, reason text, reviewed_at timestamptz, first_seen timestamptz)
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
    select f.id, f.kind, coalesce(p.display_name,'(no name)'), f.detail, f.round_ids,
           f.status, f.reason, f.reviewed_at, f.first_seen
    from friction_items f left join profiles p on p.id = f.subject_user
    where p_status is null
       or (p_status = 'resolved' and f.status in ('cleared','auto_resolved'))
       or f.status = p_status
    order by f.first_seen desc;
end $fn$;
grant execute on function public.get_friction_items(text) to authenticated;

create or replace function public.get_friction_rounds(p_id uuid)
returns table(round_id uuid, course text, created_at timestamptz, scored int,
              gross int, status text, recommended boolean)
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
    with ids as (select unnest(round_ids) rid from friction_items where id = p_id),
    r as (
      select ro.id, ro.course, ro.created_at, coalesce(ro.status,'final') st, ro.gross_score,
             (select count(*) from holes h where h.round_id = ro.id and h.strokes is not null)::int sc
      from rounds ro join ids on ids.rid = ro.id
    )
    select r.id, r.course, r.created_at, r.sc, r.gross_score, r.st,
           (r.id = (select id from r order by sc desc, created_at asc limit 1))
    from r order by r.created_at;
end $fn$;
grant execute on function public.get_friction_rounds(uuid) to authenticated;

create or replace function public.resolve_friction(
  p_id uuid, p_status text, p_reason text default null,
  p_keep uuid default null, p_soft_delete boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_kind text; v_rids uuid[]; v_deleted int := 0;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_status not in ('cleared','needs_action','open') then raise exception 'bad status'; end if;
  update friction_items
     set status = p_status, reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  if p_soft_delete then
    select kind, round_ids into v_kind, v_rids from friction_items where id = p_id;
    if v_kind in ('dup_day','dup_game','multi_draft') then
      update rounds set deleted_at = now()
        where id = any(v_rids)
          and id <> coalesce(p_keep, '00000000-0000-0000-0000-000000000000'::uuid)
          and deleted_at is null;
      get diagnostics v_deleted = row_count;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end $fn$;
grant execute on function public.resolve_friction(uuid, text, text, uuid, boolean) to authenticated;

-- ── Daily schedule (idempotent) ─────────────────────────────────────────────
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('friction-sweep'); exception when others then null; end $$;
select cron.schedule('friction-sweep', '17 8 * * *', $$ select public.sweep_friction(false); $$);
-- Optional immediate first pass:  select public.sweep_friction(true);
