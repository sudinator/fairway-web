-- 0006_group_marker.sql  — STAGE 2 (group scoring: the "marker")
-- Run in the Supabase SQL editor. Sections are independent; all idempotent.
-- SECURITY-SENSITIVE: the RLS policy lets the current marker write OTHER
-- players' scores in the same game. Review it and test with two accounts.

-- 1) Column: who currently holds the group scorecard.
alter table games add column if not exists marker_user_id uuid references auth.users(id);

-- 2) Claim / release the marker, via SECURITY DEFINER so we can enforce that
--    only a member of the game's group may claim, and only the holder releases.
--    NOTE: assumes group_members(group_id, user_id). Adjust if your column
--    names differ.
create or replace function claim_marker(p_game_id uuid) returns void
language sql security definer set search_path = public as $$
  update games set marker_user_id = auth.uid()
  where id = p_game_id
    and exists (
      select 1 from group_members gm
      where gm.group_id = games.group_id and gm.user_id = auth.uid()
    );
$$;
grant execute on function claim_marker(uuid) to authenticated;

create or replace function release_marker(p_game_id uuid) returns void
language sql security definer set search_path = public as $$
  update games set marker_user_id = null
  where id = p_game_id and marker_user_id = auth.uid();
$$;
grant execute on function release_marker(uuid) to authenticated;

-- 3) RLS: allow the current marker to UPDATE any player row in their game.
--    This is ADDED alongside your existing policies (Postgres RLS is OR-ed),
--    so players can still update their own rows as before.
drop policy if exists "marker_can_update_group_scores" on game_players;
create policy "marker_can_update_group_scores"
on game_players for update to authenticated
using (
  exists (select 1 from games g
          where g.id = game_players.game_id and g.marker_user_id = auth.uid())
)
with check (
  exists (select 1 from games g
          where g.id = game_players.game_id and g.marker_user_id = auth.uid())
);

-- 4) Realtime: let viewers see scores land live. Run ONLY if these tables
--    aren't already in the realtime publication (otherwise it errors — that's
--    fine, it just means it's already on). You can also toggle realtime per
--    table in the Supabase dashboard (Database > Replication).
-- alter publication supabase_realtime add table game_players;
-- alter publication supabase_realtime add table games;
