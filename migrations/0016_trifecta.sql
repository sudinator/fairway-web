-- 0016: Trifecta format support.
-- (1) allow the new 'trifecta' game_type. games.game_type may have a CHECK
--     constraint listing the old formats; find and drop any such constraint so
--     the new value inserts. The app controls game_type, so dropping validation
--     is safe. If your DB has no such constraint this loop simply does nothing.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.games'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%game_type%'
  loop
    execute format('alter table public.games drop constraint %I', c.conname);
  end loop;
end $$;

-- (2) team-score mode for the Trifecta team leg (and future aggregate four-ball):
--     'best_ball' (low net of the two) or 'aggregate' (both nets added — Shootout).
alter table public.games add column if not exists team_score_mode text not null default 'best_ball';
