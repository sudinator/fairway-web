-- 0056_expense_source.sql
-- Link an expense back to the game whose bet produced it, so a game's bet can be
-- posted to Money at most once, shown as "Posted", un-posted (delete the linked
-- expense), and detected as stale after score edits. Both columns nullable — normal
-- expenses leave them null.

alter table public.expenses
  add column if not exists source_game_id uuid references public.games(id) on delete set null;

alter table public.expenses
  add column if not exists source_kind text;

-- One posted bet per game (partial unique index; ignores normal null-source expenses).
create unique index if not exists expenses_one_bet_per_game
  on public.expenses (source_game_id)
  where source_kind = 'tgc_bet';
