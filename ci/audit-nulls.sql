-- ci/audit-nulls.sql (read-only): every NOT-NULL column with no default. Columns the
-- app always sets itself (ids, names, amounts) are fine here; watch the "state" columns.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and is_nullable = 'NO'
  and column_default is null
  and table_name in (
    'game_players','games','groups','group_members','group_invites','group_guests',
    'tee_times','tee_time_rsvps','rounds','holes','expenses','expense_payers','expense_shares','profiles'
  )
order by table_name, column_name;
