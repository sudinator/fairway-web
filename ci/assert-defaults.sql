-- ci/assert-defaults.sql
-- Hard gate for the automated robustness check. These are the NOT-NULL "state"
-- columns the app inserts by relying on a DB default. If any lacks a default, a
-- migration has (re)introduced the drift that caused the `bets` incident — fail.
do $$
declare missing text;
begin
  select string_agg(table_name || '.' || column_name, ', ')
    into missing
  from information_schema.columns
  where table_schema = 'public'
    and is_nullable = 'NO'
    and column_default is null
    and (table_name, column_name) in (
      ('game_players','bets'), ('game_players','penalties'), ('game_players','sand'),
      ('game_players','is_marker'), ('game_players','group_locked'), ('game_players','is_guest'),
      ('games','allowance_pct'), ('games','team_score_mode'), ('games','trifecta_scoring'),
      ('groups','is_default'), ('groups','money_simplify'),
      ('group_members','is_support'),
      ('group_guests','archived'),
      ('rounds','status'),
      ('holes','sand'),
      ('group_invites','multi'), ('group_invites','use_count')
    );
  if missing is not null then
    raise exception 'Robustness check FAILED — NOT-NULL columns missing a default: %', missing;
  end if;
  raise notice 'Robustness check: all state-column defaults present.';
end $$;
