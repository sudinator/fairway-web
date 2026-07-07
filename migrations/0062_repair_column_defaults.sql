-- 0062_repair_column_defaults.sql
-- Root-cause repair for the `bets` NOT-NULL incident. Many columns were added with
-- `alter table ... add column if not exists <col> ... default <x>`. If the column
-- already existed on a given database from an earlier state, the `if not exists`
-- guard skips the WHOLE statement — including the DEFAULT — so the column can end
-- up NOT NULL with no default, and any insert that omits it fails. Re-asserting the
-- intended default is idempotent and safe to run on production (setting a default
-- that's already correct is a no-op; it never touches existing row data).
--
-- The app also now sets these columns explicitly on insert (belt-and-suspenders),
-- but restoring the defaults keeps future/manual inserts correct too. Run after 0061.

alter table public.group_invites alter column multi            set default false;
alter table public.group_invites alter column use_count        set default 0;
alter table public.games         alter column team_score_mode  set default 'best_ball';
alter table public.profiles      alter column created_at        set default now();
alter table public.games         alter column trifecta_scoring  set default 'per_hole';
alter table public.group_members alter column is_support        set default false;
alter table public.groups        alter column is_default        set default false;
alter table public.profiles      alter column banned            set default false;
alter table public.groups        alter column money_simplify    set default true;
alter table public.game_players  alter column bets              set default true;
alter table public.rounds        alter column status            set default 'final';
alter table public.games         alter column allowance_pct     set default 100;
alter table public.holes         alter column sand              set default false;
alter table public.game_players  alter column is_guest          set default false;
alter table public.game_players  alter column penalties         set default '[]'::jsonb;
alter table public.game_players  alter column sand              set default '[]'::jsonb;
alter table public.game_players  alter column is_marker         set default false;
alter table public.game_players  alter column group_locked      set default false;
