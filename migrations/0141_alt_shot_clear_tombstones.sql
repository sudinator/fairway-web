-- 0141_alt_shot_clear_tombstones.sql
--
-- Follow-up to 0140 after staging review of backward-compatible Alternate Shot
-- score clearing.
--
-- Historical Alternate Shot games can still carry duplicated gross scores in
-- game_players.scores. 0140 makes canonical side rows override those legacy
-- values. If a canonical row were DELETED when the scorer presses Clear, the
-- historical player score underneath would become visible again. A clear must
-- therefore be an explicit canonical value, not absence of a row.
--
-- AUTHORIZATION: preserves 0140 deny-by-default writes: direct table mutation stays revoked;
-- the SECURITY DEFINER RPC keeps the same authenticated caller checks (admin, organizer,
-- marker, tee-group marker, or a member scoring only their own side).
--
-- This migration makes `strokes` nullable and changes the canonical write RPC
-- so p_strokes = NULL UPSERTS a null tombstone. The application reads that row
-- as an intentional blank and therefore masks any legacy duplicated score for
-- exactly that side/hole.
--
-- Reset Scores still DELETEs all canonical rows because the same reset also
-- clears game_players.scores, so no legacy score can resurrect after reset.

begin;

alter table public.game_alt_shot_scores
  alter column strokes drop not null;

-- The existing CHECK (strokes between 1 and 30) intentionally remains. In
-- PostgreSQL a CHECK passes on NULL, while non-null scores remain constrained.

create or replace function public.save_alt_shot_side_score(
  p_game uuid,
  p_foursome_id text,
  p_side text,
  p_hole_index integer,
  p_strokes integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_foursome jsonb;
  v_side_members jsonb;
  v_authorized boolean := false;
  v_tee_group smallint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_game is null then
    raise exception 'Game is required';
  end if;

  if nullif(btrim(p_foursome_id), '') is null then
    raise exception 'Foursome is required';
  end if;

  if p_side not in ('a', 'b') then
    raise exception 'Alternate Shot side must be a or b';
  end if;

  if p_hole_index is null or p_hole_index < 0 or p_hole_index > 17 then
    raise exception 'Hole index must be between 0 and 17';
  end if;

  if p_strokes is not null and (p_strokes < 1 or p_strokes > 30) then
    raise exception 'Strokes must be between 1 and 30';
  end if;

  select g.*
    into v_game
    from public.games g
   where g.id = p_game
   for update;

  if not found then
    raise exception 'Game not found';
  end if;

  if v_game.game_type <> 'alt_shot' then
    raise exception 'Side-owned scoring is only valid for Alternate Shot';
  end if;

  select f
    into v_foursome
    from jsonb_array_elements(coalesce(v_game.foursomes, '[]'::jsonb)) as f
   where f ->> 'id' = p_foursome_id
   limit 1;

  if v_foursome is null then
    raise exception 'Alternate Shot group not found';
  end if;

  v_side_members := coalesce(v_foursome -> p_side, '[]'::jsonb);

  if jsonb_typeof(v_side_members) <> 'array'
     or jsonb_array_length(v_side_members) <> 2 then
    raise exception 'Alternate Shot side must contain exactly two players';
  end if;

  select gp.tee_group
    into v_tee_group
    from public.game_players gp
   where gp.game_id = p_game
     and (v_side_members ? coalesce(gp.user_id::text, gp.id::text))
     and gp.tee_group is not null
   order by gp.tee_group
   limit 1;

  if public.is_admin() then
    v_authorized := true;
  elsif v_game.created_by = auth.uid() then
    v_authorized := true;
  elsif v_game.marker_user_id = auth.uid() then
    v_authorized := true;
  elsif v_tee_group is not null
        and public.is_tee_group_marker(p_game, v_tee_group) then
    v_authorized := true;
  else
    v_authorized := exists (
      select 1
        from public.game_players gp
       where gp.game_id = p_game
         and gp.user_id = auth.uid()
         and (v_side_members ? coalesce(gp.user_id::text, gp.id::text))
    );
  end if;

  if not v_authorized then
    raise exception 'You are not allowed to score this Alternate Shot side';
  end if;

  -- NULL is persisted as an explicit clear tombstone rather than deleting the
  -- row, so historical duplicated player scores cannot reappear underneath it.
  insert into public.game_alt_shot_scores (
    game_id,
    foursome_id,
    side,
    hole_index,
    strokes,
    updated_at,
    updated_by
  )
  values (
    p_game,
    p_foursome_id,
    p_side,
    p_hole_index,
    p_strokes,
    now(),
    auth.uid()
  )
  on conflict (game_id, foursome_id, side, hole_index)
  do update
     set strokes    = excluded.strokes,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by;

  -- A pure clear on a never-scored new game should not by itself mark scoring as
  -- started. Once a real canonical score has existed, the marker remains set.
  if p_strokes is not null then
    update public.games
       set alt_shot_scoring_started_at =
             coalesce(alt_shot_scoring_started_at, now())
     where id = p_game;
  end if;
end;
$$;

revoke all
  on function public.save_alt_shot_side_score(uuid, text, text, integer, integer)
  from public;

revoke all
  on function public.save_alt_shot_side_score(uuid, text, text, integer, integer)
  from anon;

grant execute
  on function public.save_alt_shot_side_score(uuid, text, text, integer, integer)
  to authenticated;

select public.record_migration('0141_alt_shot_clear_tombstones');

commit;

-- Verification (read only)
select id, applied_at
from public.schema_migrations
where id = '0141_alt_shot_clear_tombstones';

select column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'game_alt_shot_scores'
  and column_name = 'strokes';
