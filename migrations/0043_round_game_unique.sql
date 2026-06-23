-- 0043_round_game_unique.sql
-- One history round per (game, user). Two upsert paths post game rounds — the
-- client recordMyGameRound() and the server post_game_rounds() RPC — and both do a
-- non-atomic select-then-insert, which can race into DUPLICATE rounds (same game,
-- same player) under concurrency (e.g. the "game ended" effect firing while the
-- organizer's End-game posts, or the same user on two devices).
--
-- This migration (1) removes any duplicates that already exist, keeping the newest
-- row per pair, then (2) adds a unique index so the race can never create another.
--
-- NOTE: manually-added rounds have game_id = NULL. A standard (NULLS DISTINCT)
-- unique index treats every NULL as distinct, so those rows are unaffected — only
-- game-recorded rounds (game_id NOT NULL) are constrained. Run 0043 BEFORE 0044.

-- 1a) Drop holes belonging to the duplicate (older) rounds first (FK child rows).
with ranked as (
  select id,
         row_number() over (
           partition by game_id, user_id
           order by created_at desc nulls last, id desc
         ) as rn
  from rounds
  where game_id is not null
)
delete from holes
where round_id in (select id from ranked where rn > 1);

-- 1b) Drop the duplicate rounds themselves.
with ranked as (
  select id,
         row_number() over (
           partition by game_id, user_id
           order by created_at desc nulls last, id desc
         ) as rn
  from rounds
  where game_id is not null
)
delete from rounds
where id in (select id from ranked where rn > 1);

-- 2) Enforce uniqueness going forward. NULL game_ids (manual rounds) stay unconstrained.
create unique index if not exists rounds_game_user_uniq
  on rounds (game_id, user_id);
