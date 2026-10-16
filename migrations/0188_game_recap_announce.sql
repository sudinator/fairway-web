-- 0188_game_recap_announce.sql
--
-- Completion announcements (207.2). The "game is final" notification was built in SQL from raw strokes
-- (0165 notify_game_finished): team games said "open the game for the match result"; individual
-- games were ranked by NET STROKES even when the format was Stableford; and it linked to the Games
-- tab, not the game. It is retired. The app's server (/api/games/[id]/completed) now builds the
-- recap with the SAME results functions as the Results screen and announces it.
--
--   * games.recap_signature / recap_announced_at: the outcome last announced.
--   * claim_game_recap(game, signature): atomically decides what to announce for this completion —
--     'final' the first time, 'updated' when a re-ended game's outcome differs from what was
--     announced, 'same' otherwise — and records it. Two devices ending a game at once cannot both
--     announce.
--
-- AUTHORIZATION: claim_game_recap is SECURITY DEFINER, service_role only (the server route verifies
-- the caller is the game's organizer or a club admin before claiming).
--
-- Idempotent; safe to re-run.

begin;

drop trigger if exists trg_notify_game_finished on public.games;

alter table public.games add column if not exists recap_signature text;
alter table public.games add column if not exists recap_announced_at timestamptz;

create or replace function public.claim_game_recap(p_game uuid, p_signature text)
returns text language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select id, status, recap_signature into g from games where id = p_game for update;
  if not found then raise exception 'no such game' using errcode = 'P0002'; end if;
  if g.status is distinct from 'ended' then return 'not_ended'; end if;
  if g.recap_signature is not distinct from p_signature then return 'same'; end if;
  update games set recap_signature = p_signature, recap_announced_at = now() where id = p_game;
  return case when g.recap_signature is null then 'final' else 'updated' end;
end $$;
revoke all on function public.claim_game_recap(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_game_recap(uuid, text) to service_role;

select public.record_migration('0188_game_recap_announce');

commit;
