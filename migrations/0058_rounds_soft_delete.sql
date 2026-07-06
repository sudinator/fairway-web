-- 0058_rounds_soft_delete.sql
-- Soft-delete for rounds. Game-recorded rounds (game_id set) can't be hard-deleted
-- effectively: recordMyGameRound() re-inserts them by (game_id,user_id) the next time
-- the ended game is opened, so a hard delete silently comes back and keeps feeding
-- stats + handicap. A soft delete sticks because every re-post path finds the existing
-- (hidden) row and UPDATEs it in place — leaving deleted_at untouched.
alter table public.rounds add column if not exists deleted_at timestamptz;
create index if not exists rounds_user_active_idx on public.rounds(user_id) where deleted_at is null;
