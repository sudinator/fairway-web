-- 0236_confirmed_penalty_tracking.sql
-- AUTHORIZATION: existing own-round RLS, active-account and primary-device rules
-- remain authoritative. The caller can confirm only their own completed round.
-- TESTS: ci/assert-penalty-tracking.sql
begin;
alter table public.rounds add column penalties_tracked boolean not null default false;

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
 update rounds set penalties_tracked=p_tracked where id=p_round and user_id=auth.uid();
 get diagnostics n=row_count;
 if n<>1 then raise exception 'Confirmation was not saved' using errcode='42501'; end if;
 return p_tracked;
end $$;
revoke all on function public.set_round_penalties_tracked(uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.set_round_penalties_tracked(uuid,boolean,jsonb) to authenticated;

-- Scores/penalties changed since confirmation: require a fresh review. Putts,
-- fairways and rating/slope edits do not discard the penalty confirmation.
create or replace function public.invalidate_penalty_confirmation() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and (old.round_id,old.strokes,old.penalties) is not distinct from (new.round_id,new.strokes,new.penalties) then return new; end if;
 if tg_op<>'INSERT' then update rounds set penalties_tracked=false where id=old.round_id and penalties_tracked; end if;
 if tg_op<>'DELETE' then update rounds set penalties_tracked=false where id=new.round_id and penalties_tracked; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.invalidate_penalty_confirmation() from public,anon,authenticated;
create trigger invalidate_penalty_confirmation after insert or update or delete on public.holes for each row execute function public.invalidate_penalty_confirmation();
select public.record_migration('0236_confirmed_penalty_tracking');
commit;
