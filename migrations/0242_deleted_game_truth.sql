-- 0242_deleted_game_truth.sql
-- 212.135 (owner, Nov 27, 2026): game 610175 on staging — deleted by the system admin from the phone at 11:11 pm, yet the
-- phone kept its copy (the admin delete path never cleared it), the Profile kept listing its scores as "not yet synced",
-- the game room still opened from the snapshot with the repair buttons, Delete said "Couldn't delete that … P0001"
-- ("Game not found", hidden by the toast), and Reopen "succeeded" — the app logged "System admin reopened game" after
-- an update that changed zero rows, because admin_reopen_game returned quietly. Three server-side pieces of the fix:
--  1. game_exists(id) — SECURITY DEFINER, authenticated: does this game still exist at all? The app asks this when a
--     game it holds locally cannot be read while online, to tell "deleted" from "hidden from me" or "no connection"
--     (the first is cleared from the phone automatically — the owner's decision; the others are left alone).
--  2. games_states(ids) — SECURITY DEFINER, authenticated: id + status for the given games, for the Profile's unsynced
--     notice to sort its items into still-scoring / ended / deleted. Returns only id and status, only for games the
--     caller holds a player row in (a member can only have local backups for games they were in).
--  3. admin_reopen_game raises 'Game not found' (P0002) when there is no row, and records the device in the activity
--     log; admin_delete_game records the device too. The device is the scoring-device token header the app sends with
--     every request (0162), so the log can say which phone an action came from — the log never recorded this before.
-- AUTHORIZATION: game_exists reveals one bit (a row exists) for an id the caller already holds; games_states is
--   restricted to games the caller is a player in. The admin functions keep their is_admin() checks. No table grants change.
-- Additive. No history rewrite.
-- TESTS: ci/assert-deleted-game-truth.sql
begin;

create or replace function public.game_exists(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.games g where g.id = p_game);
$$;
revoke all on function public.game_exists(uuid) from public, anon;
grant execute on function public.game_exists(uuid) to authenticated;

-- status of each game the member plays in; a game that exists but the member is not in comes back as 'not_member'
-- (the review: a member REMOVED from an active game must not be told the game was deleted). An absent id is a game
-- the server has no row for. Nothing else about a non-member game is revealed.
create or replace function public.games_states(p_games uuid[])
returns table (id uuid, status text) language sql stable security definer set search_path = public as $$
  select g.id,
         case when exists (select 1 from public.game_players gp where gp.game_id = g.id and gp.user_id = auth.uid())
              then g.status else 'not_member' end
    from public.games g
   where g.id = any(p_games);
$$;
revoke all on function public.games_states(uuid[]) from public, anon;
grant execute on function public.games_states(uuid[]) to authenticated;

-- the device that made a logged admin action, from the request headers lib/supabase sets: the scoring-device token
-- (as 0162 reads it), and 212.135's per-installation id and decipherable name ("iPhone - home-screen app")
create or replace function public.request_device()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',    left(h ->> 'x-bnn-device-id', 64),
    'name',  left(h ->> 'x-bnn-device-name', 80),
    'token', left(h ->> 'x-bnn-scoring-device', 128)))
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as h) r;
$$;
revoke all on function public.request_device() from public, anon, authenticated;

-- (owner, Nov 27: "for ALL activity that we track, include device ID and name") Every activity row, whoever writes it —
-- the app's logActivity, a server function, a trigger — is stamped with the device behind the request when the row
-- arrives without one. A scheduled job has no request headers and gets no device, which is the truth.
create or replace function public.activity_log_stamp_device()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_device jsonb;
begin
  if new.details is null or new.details->'device' is null then
    v_device := nullif(public.request_device(), '{}'::jsonb);
    if v_device is not null then new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('device', v_device); end if;
  end if;
  return new;
end $$;
revoke all on function public.activity_log_stamp_device() from public, anon, authenticated;
drop trigger if exists activity_log_stamp_device on public.activity_log;
create trigger activity_log_stamp_device before insert on public.activity_log
  for each row execute function public.activity_log_stamp_device();

create or replace function public.admin_reopen_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_game public.games%rowtype; v_actor text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only a system admin can reopen this game' using errcode = '42501';
  end if;
  select * into v_game from public.games g where g.id = p_game for update;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;
  update public.games set status = 'active', ended_at = null where id = p_game;
  select coalesce(nullif(btrim(p.display_name), ''), 'Someone') into v_actor from public.profiles p where p.id = auth.uid();
  insert into public.activity_log (actor_id, actor_name, action, summary, group_id, details)
  values (auth.uid(), coalesce(v_actor, 'Someone'), 'admin_game_repair', format('System admin reopened game "%s"', v_game.name), v_game.group_id,
          jsonb_strip_nulls(jsonb_build_object('game_id', p_game, 'code', v_game.code)));
end $$;
revoke all on function public.admin_reopen_game(uuid) from public, anon;
grant execute on function public.admin_reopen_game(uuid) to authenticated;

create or replace function public.admin_delete_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_game public.games%rowtype;
  v_actor text;
  v_removed_alt_rounds integer := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only a system admin can delete this game';
  end if;
  select * into v_game from public.games g where g.id = p_game for update;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;
  if v_game.game_type = 'alt_shot' then
    select count(*)::integer into v_removed_alt_rounds from public.rounds r where r.game_id = p_game;
    delete from public.holes h where h.round_id in (select r.id from public.rounds r where r.game_id = p_game);
    delete from public.rounds r where r.game_id = p_game;
  end if;
  delete from public.game_players gp where gp.game_id = p_game;
  delete from public.games g where g.id = p_game;
  select coalesce(nullif(btrim(p.display_name), ''), 'Someone') into v_actor from public.profiles p where p.id = auth.uid();
  insert into public.activity_log (actor_id, actor_name, action, summary, group_id, details)
  values (
    auth.uid(), coalesce(v_actor, 'Someone'), 'admin_game_repair',
    case when v_game.game_type = 'alt_shot'
      then format('System admin deleted game "%s" and %s Alternate Shot shared-ball round%s', v_game.name, v_removed_alt_rounds, case when v_removed_alt_rounds = 1 then '' else 's' end)
      else format('System admin deleted game "%s" and preserved posted own-ball rounds', v_game.name) end,
    v_game.group_id,
    jsonb_strip_nulls(jsonb_build_object('game_id', p_game, 'code', v_game.code))
  );
end $$;
revoke all on function public.admin_delete_game(uuid) from public, anon;
grant execute on function public.admin_delete_game(uuid) to authenticated;

select public.record_migration('0242_deleted_game_truth');

commit;
