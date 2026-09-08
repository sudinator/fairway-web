-- 0150_trifecta_single_rule.sql
-- Trifecta has ONE rule (183.0): two genuine 1-v-1 singles plus a four-ball, one point each,
-- decided as matches. The former per-hole variant (one net per player off the foursome low,
-- three points a hole) is removed from the application. No production game ever used it
-- (verified Sep 2026: zero rows with trifecta_scoring = 'per_hole').
--
-- The column stays: the Ryder Cup contract trigger (0146/0147) requires trifecta_scoring = 'match'
-- on Cup sessions, and the live-scorecard RPC (0047) returns it. This migration:
--   1. flips the column default from 'per_hole' (0024, re-asserted by 0062) to 'match', so any
--      insert path that omits it no longer creates a row the Cup trigger would reject;
--   2. rewrites any historical non-'match' Trifecta rows to 'match' (expected: none);
--   3. adds a CHECK so the value can only be 'match' or null.
-- Idempotent; safe to re-run.

begin;

alter table public.games alter column trifecta_scoring set default 'match';

update public.games
   set trifecta_scoring = 'match'
 where trifecta_scoring is not null
   and trifecta_scoring <> 'match';

alter table public.games drop constraint if exists games_trifecta_scoring_single_rule;
alter table public.games
  add constraint games_trifecta_scoring_single_rule
  check (trifecta_scoring is null or trifecta_scoring = 'match');

select public.record_migration('0150_trifecta_single_rule');

commit;
