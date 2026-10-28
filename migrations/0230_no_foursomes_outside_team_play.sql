-- 0230_no_foursomes_outside_team_play.sql
--
-- 212.64 — data repair (owner, Oct 27, staging game 411862): games created through the one-step flow for match play,
-- skins, Stableford and stroke play (212.58–212.63) could carry FOURSOMES — the Create screen's scramble-team suggestion
-- ran for them too and the save stored its "teams" as foursomes, which the game room drew as 2 v 2 match boxes on top of
-- the real singles matchups. v1.0 never stored foursomes for these formats. Clear them. (The 2 v 2 best-ball team-skins
-- variant — teams and no 1 v 1 pairings — keeps its foursomes.)
--
-- AUTHORIZATION: data only; no grants or policies change.
-- TESTS: the Create walkthrough asserts the save carries no foursomes for these formats.
--
-- Idempotent; safe to re-run.

begin;

update public.games
   set foursomes = null
 where foursomes is not null
   and (game_type in ('match', 'stableford', 'stroke')
        -- skins: team 1:1 (pairings) and individual (no teams) never have foursomes; 2 v 2 best-ball team skins (teams, no pairings) keeps them
        or (game_type = 'skins' and (teams is null or coalesce(jsonb_array_length(pairings), 0) > 0)));

select public.record_migration('0230_no_foursomes_outside_team_play');

commit;
