-- 0067_save_hole_stats.sql
-- Group scoring only: let a PLAYER keep their own peripheral stats (putts, fairways,
-- penalties, sand) even when someone else is the group's marker, WITHOUT being able to
-- touch the gross score. Mirrors the existing save_hole_scores ownership chokepoint
-- (0022) but is scoped to the caller's OWN row and to the stat columns only, so the
-- group scorer stays the sole authority on the number. Last-write-wins per stat column:
-- the client passes only the columns it changed (others null -> coalesce keeps them).
-- SECURITY DEFINER so it works regardless of the row-level update policy; the WHERE/guard
-- below is the real gate.
create or replace function public.save_hole_stats(
  p_player    uuid,
  p_putts     jsonb default null,
  p_fairways  jsonb default null,
  p_penalties jsonb default null,
  p_sand      jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); owner uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select user_id into owner from public.game_players where id = p_player;
  if owner is null then raise exception 'no such player, or that row has no owner to keep its own stats'; end if;
  if owner <> uid then raise exception 'you can only edit your own stats'; end if;
  update public.game_players set
      putts     = coalesce(p_putts,     putts),
      fairways  = coalesce(p_fairways,  fairways),
      penalties = coalesce(p_penalties, penalties),
      sand      = coalesce(p_sand,      sand)
   where id = p_player;   -- scores / clock deliberately never touched here
end $$;
