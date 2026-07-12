-- 0079_achievements.sql
-- Achievements/badges: per-player earned badges + a peer-visible read path.
-- Safe to run multiple times. Run in the Supabase SQL editor.

-- 1) member_badges: one row per (user, badge_key).
--    count       = times earned (for repeatable/count badges; 1 for once/milestone)
--    best_value  = current record for "best" badges (differential, vs-par, fairways, etc.)
--    best_round_id = the round that set the current record
create table if not exists public.member_badges (
  user_id         uuid not null references auth.users(id) on delete cascade,
  badge_key       text not null,
  count           int  not null default 0,
  best_value      numeric,
  best_round_id   uuid references public.rounds(id) on delete set null,
  first_earned_at timestamptz not null default now(),
  last_earned_at  timestamptz not null default now(),
  primary key (user_id, badge_key)
);

alter table public.member_badges enable row level security;

-- Own badges: full access to your own rows.
drop policy if exists member_badges_own on public.member_badges;
create policy member_badges_own on public.member_badges
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admins can read all (oversight/analytics).
drop policy if exists member_badges_admin on public.member_badges;
create policy member_badges_admin on public.member_badges
  for select using (public.is_admin());

-- 2) profiles.show_card — per-player opt-out of the public player card (default on).
alter table public.profiles add column if not exists show_card boolean not null default true;

-- 3) Peer viewing: badges for everyone in a group the caller belongs to.
--    SECURITY DEFINER + is_group_member gate (mirrors group_roster). Honors show_card.
drop function if exists public.group_badges(uuid);
create or replace function public.group_badges(p_group uuid)
returns table (
  user_id uuid, badge_key text, count int, best_value numeric,
  best_round_id uuid, first_earned_at timestamptz, last_earned_at timestamptz
)
language sql security definer set search_path = public as $$
  select mb.user_id, mb.badge_key, mb.count, mb.best_value, mb.best_round_id,
         mb.first_earned_at, mb.last_earned_at
  from public.member_badges mb
  join public.group_members gm
    on gm.user_id = mb.user_id and gm.group_id = p_group and gm.status = 'active'
  join public.profiles pr on pr.id = mb.user_id
  where public.is_group_member(p_group, auth.uid())
    and coalesce(pr.show_card, true) = true;
$$;
grant execute on function public.group_badges(uuid) to authenticated;
