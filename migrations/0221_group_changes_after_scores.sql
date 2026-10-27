-- 0221_group_changes_after_scores.sql
--
-- 212.47 — once scoring has started, the SERVER refuses group changes the app's setup rules already refuse (owner,
-- Oct 26: "yes" to a server rule for group changes, as for drafts). Before this the server refused TEAM changes for a
-- player with scores (apply_game_structure, 0184) but group changes were protected by the app's rules only.
--
-- One trigger on game_players covers every route that changes a group — set_tee_group, set_tee_groups,
-- apply_game_structure and the app's direct updates. It mirrors lib/game-setup-policy ("set_tee_group"):
--   * a scramble or alternate-shot game whose team scoring has started: groups are frozen (reset scores first);
--   * a player who has scores, or whose group has finished and locked: their group is frozen;
--   * nobody can be moved into a group that has finished and locked.
-- A late player with no scores may still join an active group (allowed by the app with confirmation), and resetting
-- the scores (reset_game_scores clears scores and the lock first) frees everything again. Maintenance work without a
-- signed-in caller (migrations, service jobs) is unaffected.
--
-- AUTHORIZATION: guard_tee_group_change() is a trigger function — not callable by anon or authenticated.
-- TESTS: ci/assert-group-changes-after-scores.sql
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.guard_tee_group_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if tg_op = 'UPDATE' and new.tee_group is not distinct from old.tee_group then return new; end if;
  if auth.uid() is null then return new; end if;   -- migrations, service jobs
  select game_type, alt_shot_scoring_started_at into g from games where id = new.game_id;
  if tg_op = 'UPDATE' then
    if g.game_type in ('alt_shot', 'scramble') and g.alt_shot_scoring_started_at is not null then
      raise exception 'Groups are frozen once team scoring has started. Reset the scores before moving players.' using errcode = '55000';
    end if;
    if coalesce(new.group_locked, false) or exists (select 1 from jsonb_array_elements(coalesce(new.scores, '[]'::jsonb)) s where s <> 'null'::jsonb) then
      raise exception '%''s group is frozen because they have scores. Reset the scores before moving them.', coalesce(new.display_name, 'This player') using errcode = '55000';
    end if;
  end if;
  if new.tee_group is not null and exists (select 1 from game_players p where p.game_id = new.game_id and p.id <> new.id and p.tee_group = new.tee_group and p.group_locked) then
    raise exception 'Group % has already finished and is locked. Add the player to an active group instead.', new.tee_group using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function public.guard_tee_group_change() from public, anon, authenticated;

drop trigger if exists trg_guard_tee_group_change on public.game_players;
create trigger trg_guard_tee_group_change before insert or update of tee_group on public.game_players
  for each row execute function public.guard_tee_group_change();

select public.record_migration('0221_group_changes_after_scores');

commit;
