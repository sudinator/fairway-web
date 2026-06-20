-- 0023_reset_game_scores.sql
-- Organizer "Reset scores" was a client-side loop that updated each game_players
-- row directly. Under RLS the organizer can only write their own row, guest rows
-- in their group, and (if they are a tee-group marker) rows in their own tee
-- group — so real accounts in OTHER foursomes were silently skipped and kept
-- their scores. This SECURITY DEFINER function clears every player row in the
-- game in one statement (safely bypassing per-row RLS) and is gated to the game
-- creator. It also stamps games.scores_reset_at so every device discards its
-- pre-reset local score backups on next load (otherwise a stale backup on
-- another phone could resurrect the wiped scores).

alter table games add column if not exists scores_reset_at timestamptz;

create or replace function reset_game_scores(p_game uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the organizer (game creator) may reset.
  if not exists (select 1 from games g where g.id = p_game and g.created_by = auth.uid()) then
    raise exception 'Only the game organizer can reset scores';
  end if;

  -- Wipe every player's scores, putts, fairways, penalties/sand and round clock.
  update game_players
     set scores      = '[]'::jsonb,
         putts       = '[]'::jsonb,
         fairways    = '[]'::jsonb,
         penalties   = '[]'::jsonb,
         sand        = '[]'::jsonb,
         clock_start = null,
         clock_end   = null,
         group_locked = false,
         no_show     = false
   where game_id = p_game;

  -- Reopen if it was ended, and stamp the reset so stale device backups are dropped.
  update games
     set status = case when status = 'ended' then 'active' else status end,
         scores_reset_at = now()
   where id = p_game;
end;
$$;

grant execute on function reset_game_scores(uuid) to authenticated;
