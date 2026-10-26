-- 0220_draft_games_private.sql
--
-- 212.41 — a saved DRAFT is private at the SERVER, not just hidden by the app (owner, Oct 25 2026: "let's do this the
-- right way"). A draft is a game created with "Save draft" (create_game_complete with p_announce = false, 0219):
-- games.players_notified_at is null until announce_game_players sends it. Until then ONLY its organizer, the club's
-- admins and system admins can read or change anything about it — the game, its players, its scramble / alternate-shot
-- scores, its contests. Before this, every club member could read any club game (games: "find or member games").
--
-- How: one RESTRICTIVE policy per table. Restrictive policies are ANDed with the existing permissive ones, so nothing
-- about who sees an announced game changes — every existing rule stays exactly as it is; this only adds "and, if it's a
-- draft, you must be its organizer or an admin". FOR ALL: reading, joining, editing and scoring are all closed.
-- Every game made the old way, and every game already in the database, is announced (0219), so none is affected.
-- set_game_share (the line-up and live scores links) refuses a draft — nothing can be shared before it is sent.
--
-- AUTHORIZATION: adds restrictive policies on games, game_players, game_alt_shot_scores, game_contests, for signed-in
-- members (authenticated) — signed-out visitors (anon) have no grant on any of these tables at all, so need no rule.
-- game_announced_or_mine(uuid): SECURITY DEFINER helper the policies call (it reads games without RLS, so the
-- game_players policy can't recurse into the games policy); executable by authenticated only (policies run with the
-- caller's rights), never anon (ci/assert-anon-boundary); it reveals only a yes/no about the caller's own access.
-- set_game_share: unchanged rights, plus the draft refusal. No grants on tables change.
-- TESTS: ci/assert-draft-private.sql
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.game_announced_or_mine(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select g.players_notified_at is not null or g.created_by = auth.uid()
                          or public.is_group_admin(g.group_id, auth.uid()) or public.is_admin()
                     from games g where g.id = p_game), true)
$$;
revoke all on function public.game_announced_or_mine(uuid) from public;
revoke all on function public.game_announced_or_mine(uuid) from anon;
grant execute on function public.game_announced_or_mine(uuid) to authenticated;

drop policy if exists drafts_private on public.games;
create policy drafts_private on public.games as restrictive for all to authenticated
  using (players_notified_at is not null or created_by = auth.uid() or public.is_group_admin(group_id, auth.uid()) or public.is_admin())
  with check (players_notified_at is not null or created_by = auth.uid() or public.is_group_admin(group_id, auth.uid()) or public.is_admin());

drop policy if exists drafts_private on public.game_players;
create policy drafts_private on public.game_players as restrictive for all to authenticated
  using (public.game_announced_or_mine(game_id)) with check (public.game_announced_or_mine(game_id));

drop policy if exists drafts_private on public.game_alt_shot_scores;
create policy drafts_private on public.game_alt_shot_scores as restrictive for all to authenticated
  using (public.game_announced_or_mine(game_id)) with check (public.game_announced_or_mine(game_id));

drop policy if exists drafts_private on public.game_contests;
create policy drafts_private on public.game_contests as restrictive for all to authenticated
  using (public.game_announced_or_mine(game_id)) with check (public.game_announced_or_mine(game_id));

CREATE OR REPLACE FUNCTION public.set_game_share(p_game uuid, p_on boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_token text; v_slug text;
begin
  if not exists (select 1 from games g where g.id = p_game and g.created_by = auth.uid()) then
    raise exception 'only the organizer can share this game';
  end if;
  -- 0220: a draft can't be shared — it isn't anyone else's to see until it is sent to the players
  if exists (select 1 from games g where g.id = p_game and g.players_notified_at is null) then
    raise exception 'send the game to its players before sharing it' using errcode = '55000';
  end if;
  if p_on then
    select share_token, lineup_slug into v_token, v_slug from games where id = p_game;
    if v_token is null then
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      update games set share_token = v_token where id = p_game;
    end if;
    if v_slug is null then
      update games set lineup_slug = public.make_lineup_slug(p_game) where id = p_game;
    end if;
    return v_token;
  else
    update games set share_token = null, lineup_slug = null where id = p_game;
    return null;
  end if;
end;
$function$;

select public.record_migration('0220_draft_games_private');

commit;
