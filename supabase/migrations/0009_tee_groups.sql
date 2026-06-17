-- 0009_tee_groups.sql — STAGE 3 (tee groups + per-group markers)
-- Large games split into tee groups that play together; EACH group has its own
-- marker who scores ONLY that group. SECURITY-SENSITIVE, additive RLS.
--
-- Design notes:
--  * The organizer does NOT get blanket score-write. Assigning groups/markers
--    is done through SECURITY DEFINER RPCs that validate the caller is the game
--    creator and that touch ONLY tee_group / is_marker — never scores.
--  * Actual scoring is allowed only for: your own row, a guest row (group
--    members), the legacy single whole-game marker (0006), and a tee-group
--    marker writing rows in their own tee group.

alter table game_players add column if not exists tee_group smallint;          -- 1,2,3… ; null = unassigned
alter table game_players add column if not exists is_marker  boolean not null default false;

-- Am I a marker for this tee group of this game? SECURITY DEFINER so the lookup
-- never recurses through game_players' own RLS.
create or replace function is_tee_group_marker(p_game uuid, p_group smallint)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from game_players w
    where w.game_id = p_game and w.user_id = auth.uid()
      and w.is_marker = true and w.tee_group is not null and w.tee_group = p_group
  );
$$;

-- A tee-group marker may update rows in the SAME tee group of the SAME game.
drop policy if exists "tee_group_marker_can_update" on game_players;
create policy "tee_group_marker_can_update" on game_players for update to authenticated
using      (is_tee_group_marker(game_id, tee_group))
with check (is_tee_group_marker(game_id, tee_group));

-- Organizer-only admin: assign a player's tee group (does NOT touch scores).
create or replace function set_tee_group(p_player uuid, p_group smallint)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  select game_id into gid from game_players where id = p_player;
  if not exists (select 1 from games g where g.id = gid and g.created_by = auth.uid()) then
    raise exception 'only the organizer can assign tee groups';
  end if;
  update game_players
     set tee_group = p_group,
         is_marker = case when p_group is null then false else is_marker end
   where id = p_player;
end $$;

-- Organizer-only admin: set/clear a group's marker (one marker per group).
create or replace function set_group_marker(p_player uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid; grp smallint;
begin
  select game_id, tee_group into gid, grp from game_players where id = p_player;
  if not exists (select 1 from games g where g.id = gid and g.created_by = auth.uid()) then
    raise exception 'only the organizer can assign markers';
  end if;
  if p_on and grp is not null then
    update game_players set is_marker = false where game_id = gid and tee_group = grp;
  end if;
  update game_players set is_marker = p_on where id = p_player;
end $$;
