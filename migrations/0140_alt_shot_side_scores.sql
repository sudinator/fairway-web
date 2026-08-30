-- 0140_alt_shot_side_scores.sql
--
-- Alternate Shot has one ball and one gross score per SIDE, not one score
-- per player. Historically BNN stored an Alternate Shot score by copying the
-- same gross score into both partners' game_players.scores arrays. That made
-- the persistence model look as though both players independently shot the
-- same score.
--
-- This migration introduces a canonical side-owned score store:
--
--   game + foursome + side + hole = one gross score
--
-- It deliberately does NOT delete or rewrite historical game_players scores.
-- Application code can therefore fall back to the historical duplicated
-- partner rows for existing Alternate Shot games while new/edited scoring
-- moves to this canonical store.
--
-- Also:
--   * authenticated clients may READ side scores only for games they can
--     legitimately access;
--   * clients cannot directly INSERT/UPDATE/DELETE side-score rows;
--   * writes go through save_alt_shot_side_score(), which verifies the game,
--     foursome, side, hole, and caller authorization;
--   * a player may score their own side;
--   * the organizer/admin/authorized marker may score either side;
--   * an ordinary opponent cannot overwrite the other side;
--   * NULL strokes means clear/delete that side's hole score;
--   * side-score changes participate in Supabase Realtime;
--   * Reset Scores clears canonical Alternate Shot scores too;
--   * alt_shot_scoring_started_at gives setup/change-game safeguards a
--     durable indication that canonical Alternate Shot scoring has begun.
--
-- Backward-compatible / expand-first:
-- old application versions ignore the new table and games column.

begin;


-- ---------------------------------------------------------------------------
-- 1. Durable scoring-start marker on games
-- ---------------------------------------------------------------------------

alter table public.games
  add column if not exists alt_shot_scoring_started_at timestamptz;


-- ---------------------------------------------------------------------------
-- 2. Canonical Alternate Shot side-score table
-- ---------------------------------------------------------------------------

create table if not exists public.game_alt_shot_scores (
  game_id       uuid        not null references public.games(id) on delete cascade,
  foursome_id   text        not null,
  side          text        not null,
  hole_index    integer     not null,
  strokes       integer     not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid        references auth.users(id) on delete set null,

  constraint game_alt_shot_scores_side_chk
    check (side in ('a', 'b')),

  constraint game_alt_shot_scores_hole_chk
    check (hole_index between 0 and 17),

  constraint game_alt_shot_scores_strokes_chk
    check (strokes between 1 and 30),

  constraint game_alt_shot_scores_pk
    primary key (game_id, foursome_id, side, hole_index)
);


create index if not exists game_alt_shot_scores_game_idx
  on public.game_alt_shot_scores(game_id);

create index if not exists game_alt_shot_scores_game_foursome_idx
  on public.game_alt_shot_scores(game_id, foursome_id);


-- ---------------------------------------------------------------------------
-- 3. RLS
--
-- Side scores are readable to legitimate game viewers, but direct writes are
-- intentionally not exposed. save_alt_shot_side_score() is the write gate.
-- ---------------------------------------------------------------------------

alter table public.game_alt_shot_scores enable row level security;

grant select on public.game_alt_shot_scores to authenticated;

revoke insert, update, delete
  on public.game_alt_shot_scores
  from public, anon, authenticated;


drop policy if exists game_alt_shot_scores_select
  on public.game_alt_shot_scores;

create policy game_alt_shot_scores_select
  on public.game_alt_shot_scores
  for select
  to authenticated
  using (
    public.is_game_member(game_id)
    or exists (
      select 1
      from public.games g
      where g.id = game_alt_shot_scores.game_id
        and g.created_by = auth.uid()
    )
    or public.is_admin()
  );


-- ---------------------------------------------------------------------------
-- 4. Canonical write RPC
--
-- p_strokes:
--   integer => insert/update one side/hole score
--   NULL    => clear/delete one side/hole score
--
-- Authorization:
--   * app admin
--   * game organizer
--   * game's global marker_user_id
--   * tee-group marker for the foursome's tee group
--   * authenticated player who belongs to the side being scored
--
-- An ordinary player on Side A cannot write Side B.
-- ---------------------------------------------------------------------------

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


  -- Lock the game row so setup/scoring state cannot change underneath this
  -- authorization and write.
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


  -- Locate the exact foursome object stored on the game.
  select f
    into v_foursome
    from jsonb_array_elements(
      coalesce(v_game.foursomes, '[]'::jsonb)
    ) as f
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


  -- Determine the tee group represented by this foursome, where available.
  -- Foursome arrays use BNN's canonical player key:
  -- registered player => user_id
  -- guest             => game_players.id
  select gp.tee_group
    into v_tee_group
    from public.game_players gp
   where gp.game_id = p_game
     and (
       v_side_members ? coalesce(gp.user_id::text, gp.id::text)
     )
     and gp.tee_group is not null
   order by gp.tee_group
   limit 1;


  -- Privileged scorers.
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
    -- Ordinary player: may write only the side they actually belong to.
    v_authorized := exists (
      select 1
        from public.game_players gp
       where gp.game_id = p_game
         and gp.user_id = auth.uid()
         and (
           v_side_members ? coalesce(gp.user_id::text, gp.id::text)
         )
    );
  end if;


  if not v_authorized then
    raise exception 'You are not allowed to score this Alternate Shot side';
  end if;


  -- NULL is the semantic "Clear" operation.
  if p_strokes is null then
    delete from public.game_alt_shot_scores
     where game_id = p_game
       and foursome_id = p_foursome_id
       and side = p_side
       and hole_index = p_hole_index;

    return;
  end if;


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


  -- Durable scoring-start marker. Once canonical Alternate Shot scoring has
  -- begun, setup-changing workflows can distinguish a genuinely unscored game.
  update public.games
     set alt_shot_scoring_started_at =
           coalesce(alt_shot_scoring_started_at, now())
   where id = p_game;

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


-- ---------------------------------------------------------------------------
-- 5. Supabase Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
      from pg_publication
     where pubname = 'supabase_realtime'
  )
  and not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'game_alt_shot_scores'
  ) then
    alter publication supabase_realtime
      add table public.game_alt_shot_scores;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Organizer Reset Scores
--
-- Preserve the existing 0023 contract and extend it so an Alternate Shot reset
-- also clears the canonical side-score store and scoring-start marker.
-- ---------------------------------------------------------------------------

create or replace function public.reset_game_scores(p_game uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
      from public.games g
     where g.id = p_game
       and g.created_by = auth.uid()
  ) then
    raise exception 'Only the game organizer can reset scores';
  end if;


  -- Existing per-player scoring/stat state.
  update public.game_players
     set scores       = '[]'::jsonb,
         putts        = '[]'::jsonb,
         fairways     = '[]'::jsonb,
         penalties    = '[]'::jsonb,
         sand         = '[]'::jsonb,
         clock_start  = null,
         clock_end    = null,
         group_locked = false,
         no_show      = false
   where game_id = p_game;


  -- Canonical Alternate Shot scoring state.
  delete from public.game_alt_shot_scores
   where game_id = p_game;


  -- Reopen an ended game and stamp the reset. Clearing
  -- alt_shot_scoring_started_at allows a truly reset Alternate Shot game to
  -- return to its pre-scoring setup state.
  update public.games
     set status =
           case
             when status = 'ended' then 'active'
             else status
           end,
         scores_reset_at = now(),
         alt_shot_scoring_started_at = null
   where id = p_game;
end;
$$;

revoke all
  on function public.reset_game_scores(uuid)
  from public;

revoke all
  on function public.reset_game_scores(uuid)
  from anon;

grant execute
  on function public.reset_game_scores(uuid)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Master-admin Reset Scores
--
-- Preserve the existing 0031 support/repair contract and extend it to the new
-- side-score store.
-- ---------------------------------------------------------------------------

create or replace function public.admin_reset_game(p_game uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return;
  end if;


  update public.game_players
     set scores       = '[]'::jsonb,
         putts        = '[]'::jsonb,
         fairways     = '[]'::jsonb,
         penalties    = '[]'::jsonb,
         sand         = '[]'::jsonb,
         clock_start  = null,
         clock_end    = null,
         group_locked = false,
         no_show      = false
   where game_id = p_game;


  delete from public.game_alt_shot_scores
   where game_id = p_game;


  update public.games
     set status =
           case
             when status = 'ended' then 'active'
             else status
           end,
         scores_reset_at = now(),
         alt_shot_scoring_started_at = null
   where id = p_game;
end;
$$;

revoke all
  on function public.admin_reset_game(uuid)
  from public;

revoke all
  on function public.admin_reset_game(uuid)
  from anon;

grant execute
  on function public.admin_reset_game(uuid)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 8. Migration ledger
-- ---------------------------------------------------------------------------

select public.record_migration('0140_alt_shot_side_scores');


commit;


-- ---------------------------------------------------------------------------
-- Verification — read only
-- ---------------------------------------------------------------------------

select id, applied_at
from public.schema_migrations
where id = '0140_alt_shot_side_scores';


select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'game_alt_shot_scores'
order by ordinal_position;


select
  schemaname,
  tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'game_alt_shot_scores';


select
  routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'save_alt_shot_side_score';


select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'games'
  and column_name = 'alt_shot_scoring_started_at';
