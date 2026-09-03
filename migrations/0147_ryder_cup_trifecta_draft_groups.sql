-- 0147_ryder_cup_trifecta_draft_groups.sql
-- Allows a Ryder Cup Trifecta foursome to be assembled incrementally while
-- retaining the fixed match-scoring, best-ball and maximum 2-v-2 contract.
-- AUTHORIZATION: no grants or browser mutation paths are added; the validator
-- remains revoked and the existing Cup/game RLS and organizer checks apply.

begin;

create or replace function public.valid_cup_trifecta_structure(p_game public.games)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_game.game_type::text, '') = 'trifecta'
     and coalesce(p_game.trifecta_scoring, '') = 'match'
     and coalesce(p_game.team_score_mode, '') = 'best_ball'
     and not exists (
       select 1
       from jsonb_array_elements(coalesce(to_jsonb(p_game.foursomes), '[]'::jsonb)) as f
       where jsonb_typeof(f->'a') is distinct from 'array'
          or jsonb_typeof(f->'b') is distinct from 'array'
          or jsonb_array_length(f->'a') > 2
          or jsonb_array_length(f->'b') > 2
     );
$$;

revoke all on function public.valid_cup_trifecta_structure(public.games) from public, anon, authenticated;

select public.record_migration('0147_ryder_cup_trifecta_draft_groups');
commit;
