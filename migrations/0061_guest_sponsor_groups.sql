-- 0061_guest_sponsor_groups.sql
-- Two things for the group randomizer:
--  1) Record which member sponsored each guest, so the randomizer can keep a
--     guest in the same foursome as the member who invited them. `guest_of` holds
--     the sponsor's user id (null for members and for legacy/unattributed guests).
--  2) A batch tee-group setter so "Randomize groups" writes every player's group in
--     ONE transaction instead of one round-trip per player. Gated to the game
--     creator OR an active group admin, and it touches ONLY tee_group / is_marker
--     (never scores) — mirroring set_tee_group (0009) and set_player_bets (0059).
-- Idempotent. Run in the Supabase SQL editor after 0060.

alter table public.game_players
  add column if not exists guest_of uuid;   -- sponsoring member's user id; null = member / unattributed

-- p_assignments is a JSON array of { "player": <uuid>, "group": <int|null> }.
-- A null group leaves the player unassigned (used for overflow guests when a
-- sponsor brought more than three). The join is scoped to p_game so the call can
-- never move players belonging to another game.
create or replace function set_tee_groups(p_game uuid, p_assignments jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare creator uuid; grp uuid;
begin
  select g.created_by, g.group_id into creator, grp from games g where g.id = p_game;
  if creator is null then raise exception 'no such game'; end if;
  if not (auth.uid() = creator
     or exists (select 1 from group_members m
                where m.group_id = grp and m.user_id = auth.uid()
                  and m.role = 'admin' and m.status = 'active')) then
    raise exception 'not authorized to assign tee groups';
  end if;

  update game_players gp
     set tee_group = a.grp_num::smallint,
         is_marker = case when a.grp_num is null then false else gp.is_marker end
    from (
      select (elem->>'player')::uuid                as player_id,
             nullif(elem->>'group','')::int         as grp_num
      from jsonb_array_elements(p_assignments) elem
    ) a
   where gp.id = a.player_id
     and gp.game_id = p_game;   -- safety: only ever touch this game's players
end $$;

grant execute on function set_tee_groups(uuid, jsonb) to authenticated;
