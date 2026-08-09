-- 0130_workflow_atomicity.sql
-- Fresh workflow review (Aug 2026): make multi-write business actions atomic and deterministic.
-- Fixes partial Money edits, end-game/post-round split brain, partial club deletion, course-correction
-- orphaning, and tee-time RSVP signup-order races. All functions are SECURITY DEFINER with explicit
-- caller checks and PUBLIC/anon revoked.
--
-- AUTHORIZATION:
--   save_expense_atomic       active group member creating; creator or active admin editing.
--   finish_game_and_post_rounds organizer only.
--   delete_group_safely      active group admin only; group must have no other active members.
--   submit_course_correction active member of owning group; course must already be linked to group.
--   upsert_tee_time_rsvp     self, or tee-time creator/active group admin for another member.

create or replace function public.save_expense_atomic(
  p_expense uuid,
  p_group uuid,
  p_description text,
  p_amount_cents integer,
  p_split_type text,
  p_event uuid,
  p_shares jsonb,
  p_payers jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_creator uuid;
  v_group uuid;
  v_share_sum bigint;
  v_payer_sum bigint;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'amount must be positive' using errcode='22023'; end if;
  if p_split_type not in ('even','custom') then raise exception 'invalid split type' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_description,'')), '') is null then raise exception 'description required' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_shares,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_shares,'[]'::jsonb)) = 0 then
    raise exception 'at least one share required' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_payers,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_payers,'[]'::jsonb)) = 0 then
    raise exception 'at least one payer required' using errcode='22023';
  end if;

  select coalesce(sum((x->>'share_cents')::bigint),0) into v_share_sum from jsonb_array_elements(p_shares) x;
  select coalesce(sum((x->>'paid_cents')::bigint),0) into v_payer_sum from jsonb_array_elements(p_payers) x;
  if v_share_sum <> p_amount_cents then raise exception 'shares must equal amount' using errcode='22023'; end if;
  if v_payer_sum <> p_amount_cents then raise exception 'payers must equal amount' using errcode='22023'; end if;

  if p_event is not null and not exists(select 1 from group_events where id=p_event and group_id=p_group) then
    raise exception 'event not found for this group' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payers) x
    where nullif(x->>'user_id','') is null
       or not public.is_group_member(p_group, (x->>'user_id')::uuid)
       or coalesce((x->>'paid_cents')::integer,0) <= 0
  ) then raise exception 'every payer must be an active group member with a positive amount' using errcode='22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_shares) x
    where coalesce((x->>'share_cents')::integer,-1) < 0
       or ((nullif(x->>'user_id','') is null) = (nullif(x->>'guest_id','') is null))
       or (nullif(x->>'user_id','') is not null and not public.is_group_member(p_group,(x->>'user_id')::uuid))
       or (nullif(x->>'guest_id','') is not null and not exists(
            select 1 from group_guests gg where gg.id=(x->>'guest_id')::uuid and gg.group_id=p_group))
       or (nullif(x->>'guest_id','') is not null and (
            nullif(x->>'sponsor_user_id','') is null
            or not public.is_group_member(p_group,(x->>'sponsor_user_id')::uuid)))
  ) then raise exception 'invalid expense share participant' using errcode='22023'; end if;

  if p_expense is null then
    if not public.is_group_member(p_group, auth.uid()) then raise exception 'active group member required' using errcode='42501'; end if;
    insert into expenses(group_id, created_by, payer_user_id, description, amount_cents, split_type, event_id, updated_at)
    values (p_group, auth.uid(), (p_payers->0->>'user_id')::uuid, btrim(p_description), p_amount_cents, p_split_type, p_event, now())
    returning id into v_id;
  else
    select group_id, created_by into v_group, v_creator from expenses where id = p_expense for update;
    if v_group is null then raise exception 'expense not found' using errcode='P0002'; end if;
    if v_group <> p_group then raise exception 'expense group mismatch' using errcode='22023'; end if;
    if not public.is_group_member(v_group, auth.uid()) then raise exception 'active group member required' using errcode='42501'; end if;
    if auth.uid() is distinct from v_creator and not public.is_group_admin(v_group, auth.uid()) then
      raise exception 'expense creator or group admin required' using errcode='42501';
    end if;
    v_id := p_expense;
    update expenses set payer_user_id=(p_payers->0->>'user_id')::uuid, description=btrim(p_description),
      amount_cents=p_amount_cents, split_type=p_split_type, event_id=p_event, updated_at=now()
      where id=v_id;
    delete from expense_shares where expense_id=v_id;
    delete from expense_payers where expense_id=v_id;
  end if;

  insert into expense_shares(expense_id,user_id,guest_id,sponsor_user_id,share_cents)
  select v_id,
         nullif(x->>'user_id','')::uuid,
         nullif(x->>'guest_id','')::uuid,
         nullif(x->>'sponsor_user_id','')::uuid,
         (x->>'share_cents')::integer
  from jsonb_array_elements(p_shares) x;

  insert into expense_payers(expense_id,user_id,paid_cents)
  select v_id, (x->>'user_id')::uuid, (x->>'paid_cents')::integer
  from jsonb_array_elements(p_payers) x;

  return v_id;
end $$;
revoke all on function public.save_expense_atomic(uuid,uuid,text,integer,text,uuid,jsonb,jsonb) from public;
revoke all on function public.save_expense_atomic(uuid,uuid,text,integer,text,uuid,jsonb,jsonb) from anon;
grant execute on function public.save_expense_atomic(uuid,uuid,text,integer,text,uuid,jsonb,jsonb) to authenticated;

create or replace function public.finish_game_and_post_rounds(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists (select 1 from games g where g.id=p_game and g.created_by=auth.uid()) then
    raise exception 'only the organizer can end the whole game' using errcode='42501';
  end if;
  update games set status='ended' where id=p_game;
  perform public.post_game_rounds_internal(p_game, false);
  update game_players set clock_end=coalesce(clock_end, now())
   where game_id=p_game and clock_start is not null and clock_end is null;
end $$;
revoke all on function public.finish_game_and_post_rounds(uuid) from public;
revoke all on function public.finish_game_and_post_rounds(uuid) from anon;
grant execute on function public.finish_game_and_post_rounds(uuid) to authenticated;


create or replace function public.finish_tee_group_and_post(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_group smallint;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select tee_group into v_group from game_players
   where game_id=p_game and user_id=auth.uid() and is_marker=true;
  if v_group is null then raise exception 'only this group''s marker can finish the group' using errcode='42501'; end if;
  update game_players set group_locked=true where game_id=p_game and tee_group=v_group;
  perform public.post_group_rounds(p_game, v_group);
end $$;
revoke all on function public.finish_tee_group_and_post(uuid) from public;
revoke all on function public.finish_tee_group_and_post(uuid) from anon;
grant execute on function public.finish_tee_group_and_post(uuid) to authenticated;

create or replace function public.delete_group_safely(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_others int;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.is_group_admin(p_group, auth.uid()) then raise exception 'active group admin required' using errcode='42501'; end if;
  select count(*) into v_others from group_members where group_id=p_group and status='active' and user_id is distinct from auth.uid();
  if v_others > 0 then raise exception 'remove all other active members before deleting this club' using errcode='23514'; end if;

  update profiles set active_group_id=null where active_group_id=p_group;
  update rounds set group_id=null where group_id=p_group;
  update favorite_courses set group_id=null where group_id=p_group;
  update games set group_id=null where group_id=p_group;
  update notifications set group_id=null where group_id=p_group;
  delete from groups where id=p_group;
  if not found then raise exception 'group not found' using errcode='P0002'; end if;
end $$;
revoke all on function public.delete_group_safely(uuid) from public;
revoke all on function public.delete_group_safely(uuid) from anon;
grant execute on function public.delete_group_safely(uuid) to authenticated;

create or replace function public.submit_course_correction(
  p_group uuid,
  p_course uuid,
  p_name text,
  p_location text,
  p_data jsonb,
  p_reason text,
  p_change_summary text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_request uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.is_group_member(p_group, auth.uid()) then raise exception 'active group member required' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_reason,'')), '') is null then raise exception 'reason required' using errcode='22023'; end if;
  if not exists(select 1 from favorite_courses where id=p_course and coalesce(deleted,false)=false) then raise exception 'course not found' using errcode='P0002'; end if;

  insert into group_courses(group_id,course_id,added_by)
    values(p_group,p_course,auth.uid()) on conflict(group_id,course_id) do nothing;
  insert into group_course_overrides(group_id,course_id,name,location,data,updated_by,updated_at)
    values(p_group,p_course,p_name,coalesce(p_location,''),p_data,auth.uid(),now())
    on conflict(group_id,course_id) do update set name=excluded.name,location=excluded.location,data=excluded.data,updated_by=excluded.updated_by,updated_at=now();
  insert into course_change_requests(course_id,group_id,submitted_by,proposed_name,proposed_location,proposed_data,reason,change_summary,status)
    values(p_course,p_group,auth.uid(),p_name,coalesce(p_location,''),p_data,btrim(p_reason),p_change_summary,'pending')
    returning id into v_request;
  return v_request;
end $$;
revoke all on function public.submit_course_correction(uuid,uuid,text,text,jsonb,text,text) from public;
revoke all on function public.submit_course_correction(uuid,uuid,text,text,jsonb,text,text) from anon;
grant execute on function public.submit_course_correction(uuid,uuid,text,text,jsonb,text,text) to authenticated;

create or replace function public.upsert_tee_time_rsvp(
  p_tee_time uuid,
  p_user uuid,
  p_choice text,
  p_guest_names text[] default '{}'
) returns integer language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_creator uuid; v_order integer; v_existing integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_choice not in ('in','out','maybe') then raise exception 'invalid RSVP choice' using errcode='22023'; end if;
  select group_id,created_by into v_group,v_creator from tee_times where id=p_tee_time;
  if v_group is null then raise exception 'tee time not found' using errcode='P0002'; end if;
  if not public.is_group_member(v_group, auth.uid()) then raise exception 'active group member required' using errcode='42501'; end if;
  if p_user is distinct from auth.uid() and auth.uid() is distinct from v_creator and not public.is_group_admin(v_group,auth.uid()) then
    raise exception 'not authorized to RSVP for this member' using errcode='42501';
  end if;
  if not public.is_group_member(v_group,p_user) then raise exception 'target must be an active group member' using errcode='42501'; end if;

  perform pg_advisory_xact_lock(hashtext(p_tee_time::text));
  select signup_order into v_existing from tee_time_rsvps where tee_time_id=p_tee_time and user_id=p_user for update;
  if found then v_order:=v_existing;
  else select coalesce(max(signup_order),0)+1 into v_order from tee_time_rsvps where tee_time_id=p_tee_time;
  end if;

  insert into tee_time_rsvps(tee_time_id,user_id,choice,guest_names,signup_order,responded_at)
  values(p_tee_time,p_user,p_choice,case when p_choice='in' then coalesce(p_guest_names,'{}') else '{}'::text[] end,v_order,now())
  on conflict(tee_time_id,user_id) do update set choice=excluded.choice,guest_names=excluded.guest_names,responded_at=excluded.responded_at;
  return v_order;
end $$;
revoke all on function public.upsert_tee_time_rsvp(uuid,uuid,text,text[]) from public;
revoke all on function public.upsert_tee_time_rsvp(uuid,uuid,text,text[]) from anon;
grant execute on function public.upsert_tee_time_rsvp(uuid,uuid,text,text[]) to authenticated;

-- Internal posting body should not be directly callable by app identities; wrappers above own authorization.
revoke all on function public.post_game_rounds_internal(uuid, boolean) from public;
revoke all on function public.post_game_rounds_internal(uuid, boolean) from anon;
revoke all on function public.post_game_rounds_internal(uuid, boolean) from authenticated;

select record_migration('0130_workflow_atomicity');
