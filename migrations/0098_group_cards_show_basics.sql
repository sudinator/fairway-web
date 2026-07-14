-- 0098_group_cards_show_basics.sql
-- Option B for profile sharing: show_card gates only the SHOWCASE (badges + form sparkline).
-- Name, handicap index, and round count are roster basics and stay visible to club-mates even
-- when a member turns sharing off — so a private member's card reads "10 rounds", not a broken "0".
--
-- Changes vs 0082: group_cards now returns a row for EVERY active member (opted-out included),
-- with idx / idx_trend / live rounds always populated; it BLANKS the form sparkline when sharing is
-- off, and returns show_card so the client can hide the badge shelf. group_badges is unchanged — it
-- already returns nothing for opted-out members, which correctly hides their badges under Option B.
-- Self-contained + idempotent (recreates player_cards if missing); supersedes 0082. Safe to re-run.

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
returns table (user_id uuid, idx numeric, idx_trend numeric, form jsonb, rounds int, show_card boolean)
language sql security definer set search_path = public as $$
  select gm.user_id,
         pc.idx,
         pc.idx_trend,
         case when coalesce(pr.show_card, true) then coalesce(pc.form, '[]'::jsonb) else '[]'::jsonb end as form,
         (select count(*)::int from rounds r
            where r.user_id = gm.user_id
              and r.deleted_at is null
              and coalesce(r.status, 'final') <> 'in_progress') as rounds,
         coalesce(pr.show_card, true) as show_card
  from group_members gm
  join profiles pr on pr.id = gm.user_id
  left join player_cards pc on pc.user_id = gm.user_id
  where gm.group_id = p_group and gm.status = 'active'
    and public.is_group_member(p_group, auth.uid());
$$;
grant execute on function public.group_cards(uuid) to authenticated;
