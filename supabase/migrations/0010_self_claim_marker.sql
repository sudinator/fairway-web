-- 0010_self_claim_marker.sql — self-service tee-group markers
-- Any player who is in a tee group may claim the marker role for THEIR OWN group
-- (taking it over from whoever had it — the rest of the group sees scores live
-- and read-only, which is their consent). They can also step down.
-- SECURITY DEFINER + auth.uid(): a player can only ever become the marker of the
-- group they're already in, and these only touch is_marker — never scores.

create or replace function claim_group_marker(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare mine uuid; grp smallint;
begin
  select id, tee_group into mine, grp from game_players
   where game_id = p_game and user_id = auth.uid();
  if mine is null then raise exception 'you are not in this game'; end if;
  if grp  is null then raise exception 'you are not in a tee group yet'; end if;
  update game_players set is_marker = false where game_id = p_game and tee_group = grp;  -- one marker per group
  update game_players set is_marker = true  where id = mine;
end $$;

create or replace function release_group_marker(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update game_players set is_marker = false where game_id = p_game and user_id = auth.uid();
end $$;
