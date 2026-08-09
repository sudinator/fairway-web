-- 0133_testing_and_money_atomicity.sql
-- Reliability follow-up for v177.14.
-- 1) Reconciles the group_courses key required by ON CONFLICT(group_id, course_id).
-- 2) Makes TGC bet post/re-post/un-post atomic instead of browser-orchestrated multi-write flows.
--
-- AUTHORIZATION:
--   save_bet_expense_atomic / delete_bet_expense_atomic — game organizer or active group admin.

-- Fresh/staging databases must have the conflict arbiter used by submit_course_correction().
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class t on t.oid=i.indrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public'
      and t.relname='group_courses'
      and i.indisunique
      and (
        select array_agg(a.attname order by k.ord)
        from unnest(i.indkey::smallint[]) with ordinality k(attnum,ord)
        join pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum
        where k.attnum > 0
      ) = array['group_id','course_id']::name[]
  ) then
    -- Refuse to hide historical duplicates; they must be reconciled deliberately.
    if exists (
      select 1 from public.group_courses
      group by group_id, course_id
      having count(*) > 1
    ) then
      raise exception 'group_courses contains duplicate (group_id, course_id) rows; reconcile before 0133';
    end if;
    alter table public.group_courses
      add constraint group_courses_group_id_course_id_key unique(group_id, course_id);
  end if;
end $$;

create or replace function public.save_bet_expense_atomic(
  p_replace_expense uuid,
  p_group uuid,
  p_game uuid,
  p_event uuid,
  p_description text,
  p_amount_cents integer,
  p_payers jsonb,
  p_shares jsonb
)
returns table(id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_created timestamptz;
  v_sum_payers bigint;
  v_sum_shares bigint;
  v_primary uuid;
  v_game_group uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_description,'')), '') is null then
    raise exception 'description required' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_payers,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_payers,'[]'::jsonb)) = 0
     or jsonb_typeof(coalesce(p_shares,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_shares,'[]'::jsonb)) = 0 then
    raise exception 'payers and shares required' using errcode='22023';
  end if;

  select group_id into v_game_group from public.games where id=p_game for update;
  if v_game_group is null or v_game_group <> p_group then
    raise exception 'game not found for group' using errcode='P0002';
  end if;
  if not exists(select 1 from public.games where id=p_game and created_by=auth.uid())
     and not public.is_group_admin(p_group, auth.uid()) then
    raise exception 'game organizer or group admin required' using errcode='42501';
  end if;
  if p_event is not null and not exists(
    select 1 from public.group_events where id=p_event and group_id=p_group
  ) then
    raise exception 'event not found for group' using errcode='22023';
  end if;

  select coalesce(sum((x->>'paid_cents')::bigint),0)
    into v_sum_payers from jsonb_array_elements(p_payers) x;
  select coalesce(sum((x->>'share_cents')::bigint),0)
    into v_sum_shares from jsonb_array_elements(p_shares) x;
  if v_sum_payers <> p_amount_cents or v_sum_shares <> p_amount_cents then
    raise exception 'payers and shares must equal amount' using errcode='22023';
  end if;

  -- Each payer/share is exactly one member or group guest. Guest lines require an active sponsor.
  if exists (
    select 1 from jsonb_array_elements(p_payers) x
    where coalesce((x->>'paid_cents')::integer,0) <= 0
      or ((nullif(x->>'user_id','') is null) = (nullif(x->>'guest_id','') is null))
      or (nullif(x->>'user_id','') is not null and not public.is_group_member(p_group,(x->>'user_id')::uuid))
      or (nullif(x->>'guest_id','') is not null and not exists(
            select 1 from public.group_guests gg where gg.id=(x->>'guest_id')::uuid and gg.group_id=p_group))
      or (nullif(x->>'guest_id','') is not null and
          (nullif(x->>'sponsor_user_id','') is null or not public.is_group_member(p_group,(x->>'sponsor_user_id')::uuid)))
  ) then
    raise exception 'invalid bet payer' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_shares) x
    where coalesce((x->>'share_cents')::integer,-1) < 0
      or ((nullif(x->>'user_id','') is null) = (nullif(x->>'guest_id','') is null))
      or (nullif(x->>'user_id','') is not null and not public.is_group_member(p_group,(x->>'user_id')::uuid))
      or (nullif(x->>'guest_id','') is not null and not exists(
            select 1 from public.group_guests gg where gg.id=(x->>'guest_id')::uuid and gg.group_id=p_group))
      or (nullif(x->>'guest_id','') is not null and
          (nullif(x->>'sponsor_user_id','') is null or not public.is_group_member(p_group,(x->>'sponsor_user_id')::uuid)))
  ) then
    raise exception 'invalid bet share' using errcode='22023';
  end if;

  select coalesce(
    (select (x->>'user_id')::uuid from jsonb_array_elements(p_payers) x where nullif(x->>'user_id','') is not null limit 1),
    (select (x->>'sponsor_user_id')::uuid from jsonb_array_elements(p_payers) x where nullif(x->>'sponsor_user_id','') is not null limit 1)
  ) into v_primary;
  if v_primary is null then
    raise exception 'member payer required' using errcode='22023';
  end if;

  if p_replace_expense is not null then
    perform 1 from public.expenses
      where id=p_replace_expense and group_id=p_group and source_game_id=p_game and source_kind='tgc_bet'
      for update;
    if not found then
      raise exception 'bet expense not found' using errcode='P0002';
    end if;
    delete from public.expenses where id=p_replace_expense;
  end if;

  insert into public.expenses(
    group_id, created_by, payer_user_id, amount_cents, description, category, split_type,
    source_game_id, source_kind, event_id, updated_at
  ) values(
    p_group, auth.uid(), v_primary, p_amount_cents, btrim(p_description), 'bet', 'custom',
    p_game, 'tgc_bet', p_event, now()
  ) returning expenses.id, expenses.created_at into v_id, v_created;

  insert into public.expense_payers(expense_id,user_id,guest_id,sponsor_user_id,paid_cents)
  select v_id, nullif(x->>'user_id','')::uuid, nullif(x->>'guest_id','')::uuid,
         nullif(x->>'sponsor_user_id','')::uuid, (x->>'paid_cents')::integer
  from jsonb_array_elements(p_payers) x;

  insert into public.expense_shares(expense_id,user_id,guest_id,sponsor_user_id,share_cents)
  select v_id, nullif(x->>'user_id','')::uuid, nullif(x->>'guest_id','')::uuid,
         nullif(x->>'sponsor_user_id','')::uuid, (x->>'share_cents')::integer
  from jsonb_array_elements(p_shares) x;

  return query select v_id, v_created;
end $$;

revoke all on function public.save_bet_expense_atomic(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb) from public;
revoke all on function public.save_bet_expense_atomic(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb) from anon;
grant execute on function public.save_bet_expense_atomic(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb) to authenticated;

create or replace function public.delete_bet_expense_atomic(p_expense uuid, p_game uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_group uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select group_id into v_group from public.games where id=p_game;
  if v_group is null then raise exception 'game not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.games where id=p_game and created_by=auth.uid())
     and not public.is_group_admin(v_group,auth.uid()) then
    raise exception 'game organizer or group admin required' using errcode='42501';
  end if;
  delete from public.expenses
   where id=p_expense and group_id=v_group and source_game_id=p_game and source_kind='tgc_bet';
  if not found then raise exception 'bet expense not found' using errcode='P0002'; end if;
end $$;

revoke all on function public.delete_bet_expense_atomic(uuid,uuid) from public;
revoke all on function public.delete_bet_expense_atomic(uuid,uuid) from anon;
grant execute on function public.delete_bet_expense_atomic(uuid,uuid) to authenticated;

select public.record_migration('0133_testing_and_money_atomicity');
