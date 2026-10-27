-- 0225_organizer_corrects_ended_game.sql
--
-- 212.54 — after a game has ENDED, the organizer can correct any score, logged, and the players' posted rounds are
-- re-posted once the organizer confirms (owner, Oct 27: "once the game has ended and marked as such, the ability to edit
-- any score and logged accordingly, with the changes flowing through"; "Ask the organizer to confirm the re-post").
--
-- Refines the 0222 late-score rule: an ended game's scores can be changed by ITS ORGANIZER (and system admins) — any
-- player's card, any scramble / alternate-shot team score — without reopening it. Scores from any other phone are still
-- refused (BN164); setup on an ended game stays locked for everyone, the organizer included. Every hole changed is already
-- logged by the score audit (old value, new value, who, when — Manage Game → Score history).
--   games.scores_corrected_at  set when an ended game's scores change (a correction); maintenance work doesn't set it
--   games.rounds_reposted_at   set when the organizer re-posts the players' rounds after corrections
--   repost_game_rounds(game)   the organizer's re-post: updates every player's posted round from the corrected scores
--                              (post_game_rounds_internal — an update, never a duplicate) and records the time
-- The app shows "re-post" while scores_corrected_at is after the last re-post (or the end).
--
-- AUTHORIZATION: repost_game_rounds — authenticated, the game's organizer only (checked inside; system admins have their
-- own tools). mark_scores_corrected — a trigger function, callable by no one.
-- TESTS: ci/assert-setup-locks.sql (organizer correction vs late scores), ci/assert-game-permissions.sql (re-post: organizer)
--
-- Idempotent; safe to re-run.

begin;

alter table public.games add column if not exists scores_corrected_at timestamptz;
alter table public.games add column if not exists rounds_reposted_at timestamptz;

CREATE OR REPLACE FUNCTION public.guard_player_setup_locks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g record;
begin
  if public.setup_lock_exempt() then return new; end if;
  select status, game_type, teams, foursomes, alt_shot_scoring_started_at into g from games where id = new.game_id;
  if tg_op = 'INSERT' then
    if g.status = 'ended' then raise exception 'This game has ended. Reopen it before adding players.' using errcode = '55000'; end if;
    if public.game_scoring_started(new.game_id) and public.game_view(g.game_type, g.teams, g.foursomes) not in ('stableford', 'stroke', 'skins_individual') then
      raise exception 'Players can''t be added after scoring starts in a match or team contest — that would change the competitive structure.' using errcode = '55000';
    end if;
    return new;
  end if;
  if g.status = 'ended' then
    -- 1: late scores — any new or changed score or stat (clearing them all, as a reset does, is allowed)
    if (old.scores, old.putts, old.fairways, old.penalties, old.sand) is distinct from (new.scores, new.putts, new.fairways, new.penalties, new.sand)
       and not exists (select 1 from games og where og.id = new.game_id and og.created_by = auth.uid())   -- 0225: the organizer corrects
       and (public.jsonb_has_value(new.scores) or public.jsonb_has_value(new.putts) or public.jsonb_has_value(new.fairways)
            or public.jsonb_has_value(new.penalties) or public.jsonb_has_value(new.sand)) then
      raise exception 'This game has ended, so its scores can''t change. Ask the organizer to reopen it.' using errcode = 'BN164';
    end if;
    -- 1: setup on an ended game
    if (old.team, old.tee_group, old.handicap_index, old.rating, old.slope, old.tee_name, old.course_handicap, old.course_handicap_source, old.no_show, old.flight)
       is distinct from (new.team, new.tee_group, new.handicap_index, new.rating, new.slope, new.tee_name, new.course_handicap, new.course_handicap_source, new.no_show, new.flight) then
      raise exception 'This game has ended. Reopen it before editing this setting.' using errcode = '55000';
    end if;
    return new;
  end if;
  -- 11: a scored player's team (a direct change; apply_game_structure already refuses it)
  if old.team is distinct from new.team
     and (public.jsonb_has_value(old.scores) or (g.game_type in ('alt_shot', 'scramble') and g.alt_shot_scoring_started_at is not null)) then
    raise exception '% already has scores. Team membership is frozen once that player''s scoring begins.', coalesce(new.display_name, 'This player') using errcode = '55000';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_side_scores_ended()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.setup_lock_exempt() then return new; end if;
  if exists (select 1 from games g where g.id = new.game_id and g.status = 'ended' and g.created_by is distinct from auth.uid()) then   -- 0225: not the organizer
    raise exception 'This game has ended, so its scores can''t change. Ask the organizer to reopen it.' using errcode = 'BN164';
  end if;
  return new;
end $function$;

-- a change to an ENDED game's scores is a correction: note when, so the app can offer the re-post
create or replace function public.mark_scores_corrected() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;   -- maintenance work isn't a correction
  update games set scores_corrected_at = now() where id = new.game_id and status = 'ended';
  return null;
end $$;
drop trigger if exists trg_mark_scores_corrected on public.game_players;
create trigger trg_mark_scores_corrected after update of scores, putts, fairways, penalties, sand on public.game_players
  for each row when ((old.scores, old.putts, old.fairways, old.penalties, old.sand) is distinct from (new.scores, new.putts, new.fairways, new.penalties, new.sand))
  execute function public.mark_scores_corrected();
drop trigger if exists trg_mark_side_scores_corrected on public.game_alt_shot_scores;
create trigger trg_mark_side_scores_corrected after insert or update on public.game_alt_shot_scores
  for each row execute function public.mark_scores_corrected();

-- the organizer's re-post after corrections
create or replace function public.repost_game_rounds(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select id, created_by, status into g from games where id = p_game for update;
  if g.id is null then raise exception 'no such game' using errcode = 'P0002'; end if;
  if g.created_by is distinct from auth.uid() then raise exception 'only the organizer can re-post the rounds' using errcode = '42501'; end if;
  if g.status is distinct from 'ended' then raise exception 'the game is still being played — rounds are posted when it ends' using errcode = '55000'; end if;
  perform public.post_game_rounds_internal(p_game, false);
  update games set rounds_reposted_at = now() where id = p_game;
end $$;

revoke all on function public.mark_scores_corrected() from public, anon, authenticated;
revoke all on function public.repost_game_rounds(uuid) from public, anon;
grant execute on function public.repost_game_rounds(uuid) to authenticated;

select public.record_migration('0225_organizer_corrects_ended_game');

commit;
