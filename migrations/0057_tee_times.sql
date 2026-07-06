-- 0057_tee_times.sql
-- "Tee Times" scheduling: a group organizer posts an upcoming outing; members RSVP
-- in/out/maybe with guests and a waitlist. Multi-group from the start; UI gated to TGC
-- in phase 1. Distinct from BNN "rounds" (recorded golf tied to games).

create table if not exists public.tee_times (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  seq integer,                                   -- per-group display number (e.g. #2602)
  title text,
  kind text default 'scheduled',                 -- type label (group-configurable later)
  course text,                                    -- course name (display; game pulls full course later)
  play_date date not null,
  tee_off_times text[] not null default '{}',     -- one or more start times
  signup_opens_at timestamptz,
  signup_deadline timestamptz,
  max_spots integer,
  notes text,
  status text not null default 'upcoming',        -- upcoming | cancelled | completed
  captain_user_id uuid references auth.users(id) on delete set null,
  game_id uuid references public.games(id) on delete set null,  -- future handoff link
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tee_times_group_idx on public.tee_times(group_id, play_date);

create table if not exists public.tee_time_rsvps (
  id uuid primary key default gen_random_uuid(),
  tee_time_id uuid not null references public.tee_times(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  choice text not null check (choice in ('in','out','maybe')),
  guest_names text[] not null default '{}',
  signup_order integer,
  responded_at timestamptz not null default now(),
  unique (tee_time_id, user_id)
);
create index if not exists tee_time_rsvps_tt_idx on public.tee_time_rsvps(tee_time_id);

alter table public.tee_times enable row level security;
alter table public.tee_time_rsvps enable row level security;

-- ── tee_times: any active group member reads; organizer/admin (or creator) manages ──
drop policy if exists tt_select on public.tee_times;
create policy tt_select on public.tee_times for select
  using (exists (select 1 from public.group_members gm
                 where gm.group_id = tee_times.group_id and gm.user_id = auth.uid() and gm.status = 'active'));

drop policy if exists tt_insert on public.tee_times;
create policy tt_insert on public.tee_times for insert
  with check (exists (select 1 from public.group_members gm
                      where gm.group_id = tee_times.group_id and gm.user_id = auth.uid()
                        and gm.status = 'active' and gm.role in ('admin','owner')));

drop policy if exists tt_update on public.tee_times;
create policy tt_update on public.tee_times for update
  using (created_by = auth.uid()
         or exists (select 1 from public.group_members gm
                    where gm.group_id = tee_times.group_id and gm.user_id = auth.uid()
                      and gm.status = 'active' and gm.role in ('admin','owner')));

drop policy if exists tt_delete on public.tee_times;
create policy tt_delete on public.tee_times for delete
  using (created_by = auth.uid()
         or exists (select 1 from public.group_members gm
                    where gm.group_id = tee_times.group_id and gm.user_id = auth.uid()
                      and gm.status = 'active' and gm.role in ('admin','owner')));

-- ── tee_time_rsvps: members read all in their group; write own; organizer/admin writes anyone's ──
drop policy if exists ttr_select on public.tee_time_rsvps;
create policy ttr_select on public.tee_time_rsvps for select
  using (exists (select 1 from public.tee_times t
                   join public.group_members gm on gm.group_id = t.group_id
                 where t.id = tee_time_rsvps.tee_time_id and gm.user_id = auth.uid() and gm.status = 'active'));

drop policy if exists ttr_insert on public.tee_time_rsvps;
create policy ttr_insert on public.tee_time_rsvps for insert
  with check (
    exists (select 1 from public.tee_times t
              join public.group_members gm on gm.group_id = t.group_id
            where t.id = tee_time_rsvps.tee_time_id and gm.user_id = auth.uid() and gm.status = 'active')
    and (user_id = auth.uid()
         or exists (select 1 from public.tee_times t2
                      join public.group_members gm2 on gm2.group_id = t2.group_id
                    where t2.id = tee_time_rsvps.tee_time_id and gm2.user_id = auth.uid()
                      and gm2.status = 'active' and gm2.role in ('admin','owner'))));

drop policy if exists ttr_update on public.tee_time_rsvps;
create policy ttr_update on public.tee_time_rsvps for update
  using (
    user_id = auth.uid()
    or exists (select 1 from public.tee_times t
                 join public.group_members gm on gm.group_id = t.group_id
               where t.id = tee_time_rsvps.tee_time_id and gm.user_id = auth.uid()
                 and gm.status = 'active' and gm.role in ('admin','owner')));

drop policy if exists ttr_delete on public.tee_time_rsvps;
create policy ttr_delete on public.tee_time_rsvps for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.tee_times t
                 join public.group_members gm on gm.group_id = t.group_id
               where t.id = tee_time_rsvps.tee_time_id and gm.user_id = auth.uid()
                 and gm.status = 'active' and gm.role in ('admin','owner')));
