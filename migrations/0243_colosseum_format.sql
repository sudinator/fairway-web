-- 0243_colosseum_format.sql
-- 212.136 (owner, Nov 27, 2026): the Colosseum — everyone plays everyone. An own-ball format: every player keeps their
-- own card (one marker per group, as today); every pair of players is a match read off those cards, net v net on each
-- player's OWN strokes (full course handicap × allowance, the Stableford basis). 1 point a win, ½ a halve; the table
-- decides. No pairings, no teams, no shared-ball scores: the server already stores and posts everything a Colosseum
-- needs, exactly as it does for Stableford. This migration only teaches the ONE server rule that enumerates own-card
-- formats about the new one: the setup lock that lets an organizer re-read the same cards under another own-card
-- format (Stableford ↔ stroke ↔ individual skins) once scoring has started, and refuses team ↔ individual.
-- AUTHORIZATION: no grants or policies change; guard_game_setup_locks keeps its definer body with two lists widened.
--   game_type has no check constraint (free text, read by the app through lib/game-shape GAME_TYPES); the Cup session
--   format check gains 'colosseum'.
-- Additive. No history rewrite.
-- TESTS: ci/assert-setup-locks.sql (the body below is 0222's guard verbatim, with the two own-card lists widened)
begin;

create or replace function public.guard_game_setup_locks()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_setup_changed boolean;
begin
  if public.setup_lock_exempt() then return new; end if;
  v_setup_changed := (old.course, old.course_par, old.holes_meta, old.game_type, old.allowance_pct, old.team_score_mode, old.skins_mode, old.stroke_basis,
                      old.scramble_mode, old.scramble_handicap, old.scramble_allowance, old.scramble_team_size, old.scramble_min_drives,
                      old.leg_config, old.flight_mode, old.flights, old.trifecta_scoring)
                  is distinct from
                     (new.course, new.course_par, new.holes_meta, new.game_type, new.allowance_pct, new.team_score_mode, new.skins_mode, new.stroke_basis,
                      new.scramble_mode, new.scramble_handicap, new.scramble_allowance, new.scramble_team_size, new.scramble_min_drives,
                      new.leg_config, new.flight_mode, new.flights, new.trifecta_scoring)
                  or public.team_keys(old.teams) is distinct from public.team_keys(new.teams)
                  or public.pairings_norm(old.pairings) is distinct from public.pairings_norm(new.pairings)
                  or public.foursomes_norm(old.foursomes) is distinct from public.foursomes_norm(new.foursomes);
  -- 1: an ended game (still ended after this change)
  if old.status = 'ended' and new.status = 'ended' then
    if v_setup_changed then raise exception 'This game has ended. Reopen it before editing this setting.' using errcode = '55000'; end if;
    return new;
  end if;
  if not v_setup_changed or not public.game_scoring_started(new.id) then return new; end if;
  -- 2, 3
  if (old.course, old.course_par, old.holes_meta) is distinct from (new.course, new.course_par, new.holes_meta) then
    raise exception 'The course and the number of holes are locked once scoring begins.' using errcode = '55000';
  end if;
  -- 4: within the family only
  if old.game_type is distinct from new.game_type then
    -- 0243: the Colosseum is an own-card format like Stableford — the same cards, reread
    if not ((public.game_view(old.game_type, old.teams, old.foursomes) in ('stableford', 'stroke', 'skins_individual', 'colosseum')
             and public.game_view(new.game_type, new.teams, new.foursomes) in ('stableford', 'stroke', 'skins_individual', 'colosseum'))
         or (public.game_view(old.game_type, old.teams, old.foursomes) in ('fourball', 'trifecta')
             and public.game_view(new.game_type, new.teams, new.foursomes) in ('fourball', 'trifecta')
             and jsonb_typeof(old.foursomes) = 'array' and jsonb_array_length(old.foursomes) > 0)) then
      raise exception 'The format can''t switch between team and individual once scoring has started. Clear the scores first, or create a new game.' using errcode = '55000';
    end if;
  end if;
  -- 5, 6
  if public.team_keys(old.teams) is distinct from public.team_keys(new.teams) then
    raise exception 'The team structure is locked once scoring starts — skins style and individual/team matches can''t change mid-round.' using errcode = '55000';
  end if;
  -- 7
  if public.pairings_norm(old.pairings) is distinct from public.pairings_norm(new.pairings) then
    raise exception 'Matchups are frozen once scoring starts. Existing scores must stay attached to the opponents they were played against.' using errcode = '55000';
  end if;
  -- 8
  if public.foursomes_norm(old.foursomes) is distinct from public.foursomes_norm(new.foursomes) then
    raise exception 'Foursomes are frozen once scoring starts. Existing scores must stay attached to the teams and foursomes that played them.' using errcode = '55000';
  end if;
  return new;
end $$;

-- the Ryder Cup (owner, Nov 27): a Colosseum session — everyone on one side against everyone on the other, |A| × |B|
-- matches, each worth the session's points. The session guard needs nothing new: a Cup Colosseum keeps the Cup's two
-- teams (lib/game-shape usesTeams) and has no foursomes or pairings to validate.
alter table public.competition_sessions drop constraint if exists competition_sessions_format_check;
alter table public.competition_sessions add constraint competition_sessions_format_check
  check (format = any (array['fourball'::text, 'alt_shot'::text, 'match'::text, 'trifecta'::text, 'scramble'::text, 'colosseum'::text]));

select public.record_migration('0243_colosseum_format');
commit;
