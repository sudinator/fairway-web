-- 0154_round_manual_course_handicap.sql
--
-- Manual course handicaps for SOLO ROUNDS, completing what 0153 did for games.
--
-- A posted round is not a game: it lives in `rounds`, with its own course_handicap, handicap_index,
-- slope and rating. 0153 added the manual/derived source to game_players only, so a round's handicap
-- could not be overridden at all — and a posted round is precisely what feeds a player's handicap,
-- which makes GHIN parity matter MORE here than in a casual game.
--
-- Same semantics as 0153, and deliberately the same column names so one rule reads both:
--   * the entered number IS the course handicap for this course and this hole count;
--   * NOT halved for a nine — a nine-hole round's figure is already the nine-hole figure;
--   * allowance still applies where a format applies one (a solo round has none);
--   * it feeds the round's own scoring and its posting.
--
-- AUTHORIZATION: rounds are governed by the existing RLS (own rounds full access, group admins, and
-- system admins — 0137/SCHEMA). No new grants and no new functions; this migration only adds
-- columns, so there is no privileged code path to authorize.
--
-- Idempotent; safe to re-run.

begin;

alter table public.rounds
  add column if not exists course_handicap_source text not null default 'derived';

alter table public.rounds drop constraint if exists rounds_ch_source_chk;
alter table public.rounds
  add constraint rounds_ch_source_chk
  check (course_handicap_source in ('derived', 'manual'));

alter table public.rounds
  add column if not exists course_handicap_set_by uuid references auth.users(id);
alter table public.rounds
  add column if not exists course_handicap_set_at timestamptz;

comment on column public.rounds.course_handicap_source is
  'derived = course_handicap computed from index/slope/rating; manual = entered as the authoritative '
  'course handicap for this round and hole count (not re-derived, not halved for a nine). Mirrors '
  'game_players.course_handicap_source (0153) so one rule serves rounds and games alike.';

select public.record_migration('0154_round_manual_course_handicap');

commit;
