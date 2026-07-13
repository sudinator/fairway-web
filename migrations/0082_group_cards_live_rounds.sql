-- 0082_group_cards_live_rounds.sql
-- Robust peer card: return a row for EVERY active club member (even before they've
-- synced a summary) and compute rounds-played LIVE from rounds, so the count is always
-- accurate instead of depending on the lazy player_cards write (which was showing 0 for
-- members who hadn't opened the app yet). Self-contained: (re)creates player_cards +
-- policies idempotently, so it works whether or not 0080 was run. Safe to run repeatedly.

create table if not exists public.player_cards (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  idx        numeric,
  idx_trend  numeric,
  form       jsonb not null default '[]'::jsonb,
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

drop function if exists public.group_cards(uuid);
create or replace function public.group_cards(p_group uuid)
returns table (user_id uuid, idx numeric, idx_trend numeric, form jsonb, rounds int)
language sql security definer set search_path = public as $$
  select gm.user_id,
         pc.idx,
         pc.idx_trend,
         coalesce(pc.form, '[]'::jsonb) as form,
         (select count(*)::int from rounds r
            where r.user_id = gm.user_id
              and r.deleted_at is null
              and coalesce(r.status, 'final') <> 'in_progress') as rounds
  from group_members gm
  join profiles pr on pr.id = gm.user_id
  left join player_cards pc on pc.user_id = gm.user_id
  where gm.group_id = p_group and gm.status = 'active'
    and public.is_group_member(p_group, auth.uid())
    and coalesce(pr.show_card, true) = true;
$$;
grant execute on function public.group_cards(uuid) to authenticated;
