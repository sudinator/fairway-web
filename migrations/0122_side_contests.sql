-- 0122_side_contests.sql
-- Side contests for large events: closest-to-pin (all par-3s), longest drive, straightest drive.
-- Model: ONE generic "measured contest" (game_contests) + an APPEND-ONLY entry log
-- (game_contest_entries). The leaderboard is never stored — it's the per-hole min (better='low')
-- or max (better='high') over non-voided entries, computed client-side in lib/contests.ts. Append-only
-- + a commutative reduction is what makes offline / out-of-order sync at 80+ players conflict-free.
--
-- Writes go ONLY through SECURITY DEFINER RPCs (like set_player_bets / set_tee_groups), so the tables
-- carry SELECT policies for participants and NO direct insert/update/delete. Idempotent. Run after 0121.

-- ---------- tables ----------
create table if not exists public.game_contests (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  kind text not null check (kind in ('ctp','long_drive','straightest','custom')),
  label text not null,
  holes int[] not null default '{}',
  unit text not null check (unit in ('ft_in','yards','ft_center')),
  better text not null check (better in ('low','high')),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists game_contests_game_idx on public.game_contests(game_id);

create table if not exists public.game_contest_entries (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.game_contests(id) on delete cascade,
  hole int not null,
  player_id uuid,                       -- game_players.user_id (null for a guest)
  guest_id uuid references public.group_guests(id) on delete cascade,  -- null for a member
  player_name text not null,            -- denormalized display name for the board
  value numeric not null,               -- canonical: ft_in->inches, yards->yards, ft_center->feet
  recorded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  voided boolean not null default false
);
create index if not exists gce_contest_hole_idx on public.game_contest_entries(contest_id, hole);

-- ---------- RLS: participants can READ; all writes via RPCs only ----------
alter table public.game_contests enable row level security;
alter table public.game_contest_entries enable row level security;

-- helper: may the current user see this game? (a player in it, its creator, or an admin of its club)
create or replace function public.can_see_game(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from game_players gp where gp.game_id = p_game and gp.user_id = auth.uid())
      or exists (select 1 from games g where g.id = p_game and g.created_by = auth.uid())
      or exists (select 1 from games g join group_members m on m.group_id = g.group_id
                 where g.id = p_game and m.user_id = auth.uid() and m.role = 'admin' and m.status = 'active');
$$;
grant execute on function public.can_see_game(uuid) to authenticated;

drop policy if exists gc_select on public.game_contests;
create policy gc_select on public.game_contests for select
  using (public.can_see_game(game_id));

drop policy if exists gce_select on public.game_contest_entries;
create policy gce_select on public.game_contest_entries for select
  using (exists (select 1 from public.game_contests c where c.id = contest_id and public.can_see_game(c.game_id)));

-- ---------- organizer gate helper (game creator OR active club admin) ----------
create or replace function public.is_game_organizer(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from games g where g.id = p_game and g.created_by = auth.uid())
      or exists (select 1 from games g join group_members m on m.group_id = g.group_id
                 where g.id = p_game and m.user_id = auth.uid() and m.role = 'admin' and m.status = 'active');
$$;
grant execute on function public.is_game_organizer(uuid) to authenticated;

-- ---------- RPCs (writes) ----------
-- create a contest — organizer only
create or replace function public.create_game_contest(
  p_game uuid, p_kind text, p_label text, p_holes int[], p_unit text, p_better text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not public.is_game_organizer(p_game) then raise exception 'not authorized to create a contest'; end if;
  insert into game_contests(game_id, kind, label, holes, unit, better)
    values (p_game, p_kind, coalesce(nullif(btrim(p_label), ''), 'Contest'), coalesce(p_holes, '{}'), p_unit, p_better)
    returning id into new_id;
  return new_id;
end $$;
grant execute on function public.create_game_contest(uuid, text, text, int[], text, text) to authenticated;

-- edit a contest — organizer only
create or replace function public.update_game_contest(
  p_contest uuid, p_label text, p_holes int[], p_unit text, p_better text)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  select game_id into gid from game_contests where id = p_contest;
  if gid is null then raise exception 'no such contest'; end if;
  if not public.is_game_organizer(gid) then raise exception 'not authorized to edit this contest'; end if;
  update game_contests set
    label = coalesce(nullif(btrim(p_label), ''), label),
    holes = coalesce(p_holes, holes),
    unit  = coalesce(p_unit, unit),
    better = coalesce(p_better, better)
  where id = p_contest;
end $$;
grant execute on function public.update_game_contest(uuid, text, int[], text, text) to authenticated;

-- remove a contest (and its entries via cascade) — organizer only
create or replace function public.delete_game_contest(p_contest uuid)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  select game_id into gid from game_contests where id = p_contest;
  if gid is null then return; end if;
  if not public.is_game_organizer(gid) then raise exception 'not authorized to delete this contest'; end if;
  delete from game_contests where id = p_contest;
end $$;
grant execute on function public.delete_game_contest(uuid) to authenticated;

-- log an attempt (APPEND-ONLY). Self-entry: any game member. For another player or a guest: an
-- organizer OR a scorer (someone who marks a group in this game). Value is the canonical numeric.
create or replace function public.log_contest_entry(
  p_contest uuid, p_hole int, p_player uuid, p_guest uuid, p_player_name text, p_value numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid; new_id uuid; is_member boolean; is_scorer boolean;
begin
  select game_id into gid from game_contests where id = p_contest;
  if gid is null then raise exception 'no such contest'; end if;
  if p_value is null then raise exception 'value required'; end if;

  select exists (select 1 from game_players gp where gp.game_id = gid and gp.user_id = auth.uid()) into is_member;
  select exists (select 1 from game_players gp where gp.game_id = gid and gp.user_id = auth.uid() and gp.is_marker = true) into is_scorer;

  -- self-entry (a member logging their own attempt) OR logging for others as organizer/scorer
  if p_player is not distinct from auth.uid() and p_guest is null then
    if not (is_member or public.is_game_organizer(gid)) then raise exception 'join the event to log your own attempt'; end if;
  else
    if not (public.is_game_organizer(gid) or is_scorer) then raise exception 'only a scorer or organizer can log for others'; end if;
  end if;

  insert into game_contest_entries(contest_id, hole, player_id, guest_id, player_name, value)
    values (p_contest, p_hole, p_player, p_guest, coalesce(nullif(btrim(p_player_name), ''), 'Player'), p_value)
    returning id into new_id;
  return new_id;
end $$;
grant execute on function public.log_contest_entry(uuid, int, uuid, uuid, text, numeric) to authenticated;

-- void / unvoid an entry — the organizer, or the person who recorded it (fix your own mistake)
create or replace function public.void_contest_entry(p_entry uuid, p_void boolean)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid; rec uuid;
begin
  select c.game_id, e.recorded_by into gid, rec
    from game_contest_entries e join game_contests c on c.id = e.contest_id
    where e.id = p_entry;
  if gid is null then raise exception 'no such entry'; end if;
  if not (public.is_game_organizer(gid) or rec = auth.uid()) then raise exception 'not authorized to void this entry'; end if;
  update game_contest_entries set voided = coalesce(p_void, true) where id = p_entry;
end $$;
grant execute on function public.void_contest_entry(uuid, boolean) to authenticated;
