-- SMOKE_TEST.sql — run this in the Supabase SQL editor after applying any new
-- migrations, BEFORE telling members to use a new build. It catches the class of
-- bug that hit `bets`: a NOT-NULL column whose default silently went missing, so an
-- insert that omits it fails. Everything here is READ-ONLY (or rolled back) — it
-- never changes your data and is safe to run on the live database.

-- ============================================================================
-- CHECK 1 (primary, zero-risk): NOT-NULL columns that have NO default.
-- The app leans on DB defaults for these "state" columns. If any of them appear
-- below, that default has drifted away and inserts omitting it can fail. After
-- running migration 0062 this list should NOT contain any of:
--   game_players: bets, penalties, sand, is_marker, group_locked, is_guest
--   games: allowance_pct, team_score_mode, trifecta_scoring
--   groups: is_default, money_simplify
--   group_members: is_support
--   rounds: status
--   holes: sand
--   group_invites: multi, use_count
-- (Columns the app ALWAYS sets explicitly — game_id, user_id, display_name, etc. —
--  may legitimately show up here; those are fine. Watch the state columns above.)
-- ============================================================================
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

-- ============================================================================
-- CHECK 2 (optional, deeper): actually attempt the app's game_players inserts
-- with the columns OMITTED that the app expects the DB to default, then ROLL BACK
-- so nothing is saved. If a default is missing, the matching INSERT raises an
-- error and you'll see it — that's the smoke alarm. If both "OK" notices print,
-- the insert paths are safe. Uses an existing group + member to satisfy foreign
-- keys; if your DB has no groups/profiles yet, this block is skipped.
-- ============================================================================
do $$
declare
  gid uuid; uid uuid; game uuid;
begin
  select id into gid from public.groups limit 1;
  select id into uid from public.profiles limit 1;
  if gid is null or uid is null then
    raise notice 'CHECK 2 skipped (no group/profile to reference yet).';
    return;
  end if;

  insert into public.games (group_id, created_by, name, status, holes_meta)
  values (gid, uid, '__smoke_test__', 'setup', '[]'::jsonb)
  returning id into game;

  -- Member row: omit bets / penalties / sand / is_marker / group_locked / is_guest
  -- on purpose, forcing the DB defaults to do their job.
  insert into public.game_players (game_id, user_id, display_name, scores, putts, fairways)
  values (game, uid, '__smoke_member__', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
  raise notice 'CHECK 2: member insert OK (all NOT-NULL defaults present).';

  -- Guest row (no user_id): same omissions.
  insert into public.game_players (game_id, user_id, is_guest, display_name, scores, putts, fairways)
  values (game, null, true, '__smoke_guest__', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
  raise notice 'CHECK 2: guest insert OK.';

  raise exception 'SMOKE_TEST_ROLLBACK';  -- deliberately abort so nothing is saved
exception
  when others then
    if sqlerrm = 'SMOKE_TEST_ROLLBACK' then
      raise notice 'CHECK 2 finished — all inserts succeeded, changes rolled back.';
    else
      raise notice 'CHECK 2 FAILED: %  (this is the drift to fix before shipping)', sqlerrm;
    end if;
end $$;
