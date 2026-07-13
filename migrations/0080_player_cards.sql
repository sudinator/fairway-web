-- 0080_player_cards.sql
-- Peer-visible player card: a small per-player summary (running index, its recent
-- trend, rolling-form series, rounds played) that group-mates can read. Needed
-- because a peer's rounds themselves are not readable (rounds RLS is own/admin).
-- Computed client-side at sync time (lib/card-sync). Safe to run multiple times.

create table if not exists public.player_cards (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  idx        numeric,                          -- running WHS index (null if < 3 rounds)
  idx_trend  numeric,                          -- index now minus index before last 5 rounds (neg = improving)
  form       jsonb not null default '[]'::jsonb, -- last-5 rolling-average differential series
  rounds     int   not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.player_cards enable row level security;

drop policy if exists player_cards_own on public.player_cards;
create policy player_cards_own on public.player_cards
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists player_cards_admin on public.player_cards;
create policy player_cards_admin on public.player_cards
  for select using (public.is_admin());

-- Card summaries for everyone in a group the caller belongs to. SECURITY DEFINER +
-- is_group_member gate (mirrors group_roster / group_badges). Honors show_card.
drop function if exists public.group_cards(uuid);
create or replace function public.group_cards(p_group uuid)
returns table (user_id uuid, idx numeric, idx_trend numeric, form jsonb, rounds int)
language sql security definer set search_path = public as $$
  select pc.user_id, pc.idx, pc.idx_trend, pc.form, pc.rounds
  from public.player_cards pc
  join public.group_members gm
    on gm.user_id = pc.user_id and gm.group_id = p_group and gm.status = 'active'
  join public.profiles pr on pr.id = pc.user_id
  where public.is_group_member(p_group, auth.uid())
    and coalesce(pr.show_card, true) = true;
$$;
grant execute on function public.group_cards(uuid) to authenticated;
