-- 0143_competition_schedule_contract.sql
-- Makes the planned Cup schedule the authoritative points denominator.
-- AUTHORIZATION: competition schedule reads inherit club membership; organizer/club-admin/system-admin RPCs lock or reopen, direct audit writes are revoked, and locked schedule mutations are trigger-gated.

begin;

alter table public.competitions
  add column if not exists schedule_status text not null default 'draft',
  add column if not exists schedule_locked_at timestamptz,
  add column if not exists schedule_locked_by uuid references auth.users(id) on delete set null,
  add column if not exists schedule_revision integer not null default 1,
  add column if not exists tie_rule text not null default 'shared';

alter table public.competitions drop constraint if exists competitions_schedule_status_chk;
alter table public.competitions add constraint competitions_schedule_status_chk
  check (schedule_status in ('draft','locked'));
alter table public.competitions drop constraint if exists competitions_schedule_revision_chk;
alter table public.competitions add constraint competitions_schedule_revision_chk
  check (schedule_revision > 0);
alter table public.competitions drop constraint if exists competitions_tie_rule_chk;
alter table public.competitions add constraint competitions_tie_rule_chk
  check (tie_rule in ('shared','team_a_retains','team_b_retains'));

alter table public.competition_sessions
  add column if not exists planned_match_count integer not null default 1;
alter table public.competition_sessions drop constraint if exists competition_sessions_planned_match_count_chk;
alter table public.competition_sessions add constraint competition_sessions_planned_match_count_chk
  check (planned_match_count > 0 and planned_match_count <= 100);

-- Existing v179.1/v179.2 sessions were created from completed game structure. Preserve
-- their real denominator instead of treating every legacy session as one match.
update public.competition_sessions cs
   set planned_match_count = greatest(1,
     case
       when cs.format = 'match' then jsonb_array_length(coalesce(to_jsonb(g.pairings), '[]'::jsonb))
       else jsonb_array_length(coalesce(to_jsonb(g.foursomes), '[]'::jsonb))
     end)
  from public.games g
 where g.id = cs.game_id;

create table if not exists public.competition_schedule_events (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  revision integer not null,
  action text not null check (action in ('locked','reopened')),
  reason text,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists competition_schedule_events_comp_idx
  on public.competition_schedule_events(competition_id, created_at desc);

alter table public.competition_schedule_events enable row level security;
grant select on public.competition_schedule_events to authenticated;
revoke insert, update, delete on public.competition_schedule_events from authenticated;
drop policy if exists competition_schedule_events_select on public.competition_schedule_events;
create policy competition_schedule_events_select on public.competition_schedule_events for select to authenticated
using (exists (
  select 1 from public.competitions c
   where c.id = competition_schedule_events.competition_id
     and (public.is_group_member(c.group_id, auth.uid()) or public.is_admin())
));

create or replace function public.can_manage_competition(p_competition uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.competitions c
     where c.id = p_competition
       and (public.is_admin() or (public.is_group_member(c.group_id, p_user) and (c.created_by = p_user or public.is_group_admin(c.group_id, p_user))))
  );
$$;
revoke all on function public.can_manage_competition(uuid, uuid) from public, anon;
grant execute on function public.can_manage_competition(uuid, uuid) to authenticated;

create or replace function public.lock_competition_schedule(p_competition uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comp public.competitions%rowtype;
begin
  if auth.uid() is null or not public.can_manage_competition(p_competition, auth.uid()) then
    raise exception 'Only the Cup organizer or a club admin can lock the schedule';
  end if;
  select * into v_comp from public.competitions where id = p_competition for update;
  if not found then raise exception 'Cup not found'; end if;
  if v_comp.schedule_status = 'locked' then return; end if;
  if not exists (select 1 from public.competition_sessions where competition_id = p_competition) then
    raise exception 'Add at least one planned session before locking the Cup schedule';
  end if;
  update public.competitions
     set schedule_status = 'locked', schedule_locked_at = now(), schedule_locked_by = auth.uid(), updated_at = now()
   where id = p_competition;
  insert into public.competition_schedule_events(competition_id, revision, action, actor_id)
  values (p_competition, v_comp.schedule_revision, 'locked', auth.uid());
end;
$$;
revoke all on function public.lock_competition_schedule(uuid) from public, anon;
grant execute on function public.lock_competition_schedule(uuid) to authenticated;

create or replace function public.reopen_competition_schedule(p_competition uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comp public.competitions%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if auth.uid() is null or not public.can_manage_competition(p_competition, auth.uid()) then
    raise exception 'Only the Cup organizer or a club admin can reopen the schedule';
  end if;
  if v_reason is null then raise exception 'Explain why the locked Cup schedule is being reopened'; end if;
  select * into v_comp from public.competitions where id = p_competition for update;
  if not found then raise exception 'Cup not found'; end if;
  if v_comp.schedule_status <> 'locked' then return; end if;
  update public.competitions
     set schedule_status = 'draft', schedule_locked_at = null, schedule_locked_by = null,
         schedule_revision = schedule_revision + 1, updated_at = now()
   where id = p_competition;
  insert into public.competition_schedule_events(competition_id, revision, action, reason, actor_id)
  values (p_competition, v_comp.schedule_revision + 1, 'reopened', v_reason, auth.uid());
end;
$$;
revoke all on function public.reopen_competition_schedule(uuid, text) from public, anon;
grant execute on function public.reopen_competition_schedule(uuid, text) to authenticated;

create or replace function public.guard_locked_competition_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comp uuid := case when tg_op = 'DELETE' then old.competition_id else new.competition_id end;
  v_locked boolean;
begin
  select schedule_status = 'locked' into v_locked from public.competitions where id = v_comp;
  if not coalesce(v_locked, false) then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'INSERT' or tg_op = 'DELETE' then
    raise exception 'The Cup schedule is locked. Reopen it with a reason before changing sessions';
  end if;
  if old.competition_id is distinct from new.competition_id
     or old.name is distinct from new.name
     or old.format is distinct from new.format
     or old.session_order is distinct from new.session_order
     or old.play_date is distinct from new.play_date
     or old.points_per_match is distinct from new.points_per_match
     or old.planned_match_count is distinct from new.planned_match_count then
    raise exception 'The Cup schedule is locked. Reopen it with a reason before changing session scoring';
  end if;
  -- Linking the already-planned row to its game remains allowed while locked.
  return new;
end;
$$;
revoke all on function public.guard_locked_competition_schedule() from public, anon, authenticated;
drop trigger if exists locked_competition_schedule_contract on public.competition_sessions;
create trigger locked_competition_schedule_contract
before insert or update or delete on public.competition_sessions
for each row execute function public.guard_locked_competition_schedule();

create or replace function public.guard_locked_competition_tie_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.schedule_status = 'locked' and old.tie_rule is distinct from new.tie_rule then
    raise exception 'The Cup schedule is locked. Reopen it with a reason before changing the tie rule';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_locked_competition_tie_rule() from public, anon, authenticated;
drop trigger if exists locked_competition_tie_rule_contract on public.competitions;
create trigger locked_competition_tie_rule_contract
before update of tie_rule on public.competitions
for each row execute function public.guard_locked_competition_tie_rule();

commit;

select record_migration('0143_competition_schedule_contract');
