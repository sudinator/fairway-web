-- 0240_hole_parent_and_penalty_confirmation_guards.sql
-- 212.131: two member-write doors the external review found, closed.
--
-- 1. A HOLE NEVER CHANGES ROUNDS (guard_posted_round_holes). 0228's guard looked up the parent of the NEW row only, so
--    `update holes set round_id = <my personal round> where id = <a hole of my posted round>` passed: the destination
--    was personal, the source was the posted card, which lost the hole while keeping its posted total. The app never
--    re-parents a hole (holes are inserted with their round and edited in place), so for a member any change of
--    round_id is refused outright, and the posted-round check now runs against BOTH parents. Admin and server paths
--    (definer functions, the organizer's re-post) are untouched: the guard still steps aside for them as before.
--
-- 2. PENALTY CONFIRMATION ONLY THROUGH ITS RPC (guard_penalty_confirmation). 0236's set_round_penalties_tracked checks
--    the card is complete and that the member reviewed the snapshot they are confirming; but rounds.penalties_tracked
--    is a plain column under the own-round policy, and the posted-round guard deliberately leaves it out (an owner may
--    confirm penalties on a posted card), so a direct `update rounds set penalties_tracked = true` skipped the review
--    and could put legacy zeros into the penalty averages. A member may now change the flag only inside the RPC: the
--    RPC marks the transaction (set_config 'bnn.penalty_confirmation' = the round id, local) and the trigger refuses a
--    member's change without that mark; an insert by a member must leave it false. The RPC body is otherwise 0236's.
--    The server-side invalidation on score edits (0236, a definer trigger) is untouched.
-- AUTHORIZATION: no new privileges. Both guards are INVOKER triggers that only ever REFUSE a member's direct write.
-- Idempotent; safe to re-run.
-- TESTS: ci/assert-posted-rounds.sql (the three re-parent cases; the posted card keeps all 18 holes),
--        ci/assert-penalty-tracking.sql (direct writes of the flag refused; the RPC path unchanged)
begin;

create or replace function public.guard_posted_round_holes() returns trigger
language plpgsql security invoker set search_path = public as $$   -- INVOKER: runs as the writer, so a direct write is seen as one
declare v_round uuid; v_game uuid; v_group uuid;
begin
  if current_user <> 'authenticated' or auth.uid() is null or public.is_admin() then return coalesce(new, old); end if;
  -- 0240: a member never moves a hole to another round (the app never does; the old check saw only the destination)
  if tg_op = 'UPDATE' and new.round_id is distinct from old.round_id then
    raise exception 'A hole belongs to its round and can''t be moved to another.' using errcode = '42501';
  end if;
  v_round := case when tg_op = 'DELETE' then old.round_id else new.round_id end;
  select game_id, group_id into v_game, v_group from rounds where id = v_round;
  if v_game is null then return coalesce(new, old); end if;
  if v_group is not null and public.is_group_admin(v_group, auth.uid()) then return coalesce(new, old); end if;
  raise exception 'A round posted from a game can''t be changed here — ask the organizer to correct the score in the game.' using errcode = '42501';
end $$;

create or replace function public.guard_penalty_confirmation() returns trigger
language plpgsql security invoker set search_path = public as $$   -- INVOKER: a member's direct write is seen as one
begin
  if current_user <> 'authenticated' or auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.penalties_tracked then raise exception 'Penalties are confirmed from the completed card, not on save.' using errcode = '42501'; end if;
    return new;
  end if;
  if new.penalties_tracked is distinct from old.penalties_tracked
     and current_setting('bnn.penalty_confirmation', true) is distinct from new.id::text then
    raise exception 'Penalty confirmation is changed by reviewing the card, not directly.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_penalty_confirmation on public.rounds;
create trigger trg_guard_penalty_confirmation before insert or update on public.rounds for each row execute function public.guard_penalty_confirmation();
revoke all on function public.guard_penalty_confirmation() from public, anon, authenticated;

create or replace function public.set_round_penalties_tracked(p_round uuid,p_tracked boolean,p_expected jsonb default null)
returns boolean language plpgsql security invoker set search_path=public as $$
declare r rounds%rowtype; n int; valid int; snapshot jsonb;
begin
 if auth.uid() is null or p_tracked is null then raise exception 'Round owner and confirmation required' using errcode='42501'; end if;
 if not exists(select 1 from profiles where id=auth.uid() and account_status='active' and not coalesce(banned,false) and not coalesce(deactivated,false)) then raise exception 'An active account is required' using errcode='42501'; end if;
 select * into r from rounds where id=p_round and user_id=auth.uid() and deleted_at is null for update;
 if not found then raise exception 'Round is unavailable' using errcode='42501'; end if;
 if p_tracked then
  select count(*),count(*) filter(where strokes>0 and penalties is not null and penalties>=0) into n,valid from holes where round_id=p_round;
  select jsonb_agg(jsonb_build_array(hole_number,strokes,penalties) order by hole_number) into snapshot from holes where round_id=p_round;
  if p_expected is null or p_expected is distinct from snapshot then raise exception 'The card changed. Reload it and review penalties again.' using errcode='22023'; end if;
  if coalesce(r.status,'final')<>'final' or n not in(9,18) or valid<>n then raise exception 'Confirm penalties only after completing every hole on the card' using errcode='22023'; end if;
 end if;
 -- 0240: the mark guard_penalty_confirmation looks for — this transaction, this round, cleared straight after
 perform set_config('bnn.penalty_confirmation', p_round::text, true);
 update rounds set penalties_tracked=p_tracked where id=p_round and user_id=auth.uid();
 get diagnostics n=row_count;
 perform set_config('bnn.penalty_confirmation', '', true);
 if n<>1 then raise exception 'Confirmation was not saved' using errcode='42501'; end if;
 return p_tracked;
end $$;
revoke all on function public.set_round_penalties_tracked(uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.set_round_penalties_tracked(uuid,boolean,jsonb) to authenticated;

select public.record_migration('0240_hole_parent_and_penalty_confirmation_guards');

commit;
