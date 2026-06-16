-- 0007_guest_players.sql — STAGE 2B (guest players)
-- A guest is a game_players row with no account (user_id null), a name, and a
-- handicap. Scored like anyone; lives only on the game (no rounds/dashboard).
-- SECURITY-SENSITIVE RLS below — review and test with two accounts.

-- 1) Allow account-less rows + a guest flag.
alter table game_players alter column user_id drop not null;
alter table game_players add column if not exists is_guest boolean not null default false;

-- 2) Any member of the game's group may add a guest to that game.
drop policy if exists "members_add_guests" on game_players;
create policy "members_add_guests" on game_players for insert to authenticated
with check (
  is_guest = true and user_id is null and exists (
    select 1 from games g join group_members gm on gm.group_id = g.group_id
    where g.id = game_players.game_id and gm.user_id = auth.uid()
  )
);

-- 3) Any member may update a guest row (assign team/foursome, scores).
drop policy if exists "members_update_guests" on game_players;
create policy "members_update_guests" on game_players for update to authenticated
using (
  is_guest = true and exists (
    select 1 from games g join group_members gm on gm.group_id = g.group_id
    where g.id = game_players.game_id and gm.user_id = auth.uid()
  )
)
with check (
  is_guest = true and exists (
    select 1 from games g join group_members gm on gm.group_id = g.group_id
    where g.id = game_players.game_id and gm.user_id = auth.uid()
  )
);

-- 4) Any member may remove a guest.
drop policy if exists "members_delete_guests" on game_players;
create policy "members_delete_guests" on game_players for delete to authenticated
using (
  is_guest = true and exists (
    select 1 from games g join group_members gm on gm.group_id = g.group_id
    where g.id = game_players.game_id and gm.user_id = auth.uid()
  )
);
