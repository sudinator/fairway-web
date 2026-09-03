-- 0146_ryder_cup_trifecta.sql
-- Adds Trifecta sessions to the Ryder Cup contract. Each linked foursome must
-- contain two players per Cup side and is fixed to match-scored, best-ball play.
-- AUTHORIZATION: no new browser mutation path; internal validation functions are revoked from app roles and existing Cup RLS/RPC permissions remain authoritative.

begin;

alter table public.competition_sessions
  drop constraint if exists competition_sessions_format_check;
alter table public.competition_sessions
  add constraint competition_sessions_format_check
  check (format in ('fourball','alt_shot','match','trifecta'));

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
          or jsonb_array_length(f->'a') <> 2
          or jsonb_array_length(f->'b') <> 2
     );
$$;
revoke all on function public.valid_cup_trifecta_structure(public.games) from public, anon, authenticated;

create or replace function public.validate_competition_session_game()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.competitions%rowtype;
  g public.games%rowtype;
begin
  if new.game_id is null then return new; end if;
  select * into c from public.competitions where id = new.competition_id;
  if not found then raise exception 'Competition not found'; end if;
  select * into g from public.games where id = new.game_id;
  if not found then raise exception 'Game not found'; end if;
  if g.group_id is distinct from c.group_id then raise exception 'Cup session game must belong to the same club'; end if;
  if g.game_type::text <> new.format then raise exception 'Cup session format must match the linked game'; end if;
  if new.format = 'trifecta' and not public.valid_cup_trifecta_structure(g) then
    raise exception 'Cup Trifecta requires complete 2-v-2 foursomes, match scoring and best ball';
  end if;
  if jsonb_array_length(coalesce(to_jsonb(g.teams), '[]'::jsonb)) <> 2 then raise exception 'Cup session game must have exactly two teams'; end if;
  if coalesce(g.teams->0->>'key','') <> 'A' or coalesce(g.teams->1->>'key','') <> 'B'
     or coalesce(g.teams->0->>'name','') <> c.team_a_name or coalesce(g.teams->1->>'name','') <> c.team_b_name then
    raise exception 'Cup session game team identities must match the Cup';
  end if;
  if exists (
    select 1 from public.game_players gp
    left join public.competition_players cp
      on cp.competition_id = new.competition_id and cp.user_id = gp.user_id
    where gp.game_id = new.game_id
      and (gp.user_id is null or cp.user_id is null or gp.team is distinct from cp.team_key)
  ) then
    raise exception 'Every Cup session player must be on the Cup roster and keep the same team';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_competition_session_game() from public, anon, authenticated;

create or replace function public.guard_competition_game_structure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cs public.competition_sessions%rowtype;
  c public.competitions%rowtype;
begin
  select * into cs from public.competition_sessions where game_id = old.id limit 1;
  if not found then return new; end if;
  select * into c from public.competitions where id = cs.competition_id;
  if new.group_id is distinct from c.group_id then raise exception 'Cup session game must remain in the Cup club'; end if;
  if new.game_type::text <> cs.format then raise exception 'Cup session format cannot change after linking'; end if;
  if cs.format = 'trifecta' and not public.valid_cup_trifecta_structure(new) then
    raise exception 'Cup Trifecta requires complete 2-v-2 foursomes, match scoring and best ball';
  end if;
  if jsonb_array_length(coalesce(to_jsonb(new.teams), '[]'::jsonb)) <> 2
     or coalesce(new.teams->0->>'key','') <> 'A'
     or coalesce(new.teams->1->>'key','') <> 'B'
     or coalesce(new.teams->0->>'name','') <> c.team_a_name
     or coalesce(new.teams->1->>'name','') <> c.team_b_name then
    raise exception 'Cup session team names cannot change after linking';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_competition_game_structure() from public, anon, authenticated;

drop trigger if exists competition_game_structure_contract on public.games;
create trigger competition_game_structure_contract
before update of group_id, game_type, teams, foursomes, trifecta_scoring, team_score_mode on public.games
for each row execute function public.guard_competition_game_structure();

select public.record_migration('0146_ryder_cup_trifecta');
commit;
