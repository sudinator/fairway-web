-- 0162_primary_scoring_device.sql
-- AUTHORIZATION: claim is scoped strictly to auth.uid(); blocked accounts cannot claim.
-- Tokens never grant scoring rights: existing RPC authorization and RLS remain in force.
-- Triggers also cover SECURITY DEFINER scoring RPCs and direct row updates.
begin;
create table if not exists public.scoring_devices (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token uuid not null,
  claimed_at timestamptz not null default now()
);
alter table public.scoring_devices enable row level security;
revoke all on public.scoring_devices from public, anon, authenticated;

create or replace function public.claim_scoring_device(
  p_token uuid, p_previous uuid default null, p_takeover boolean default false
) returns jsonb language plpgsql security definer set search_path=public
as $function$
declare v_uid uuid := auth.uid(); v_token uuid;
begin
  if v_uid is null or p_token is null or p_takeover is null then
    raise exception 'Authenticated device identity required' using errcode='42501';
  end if;
  if exists(select 1 from public.profiles where id=v_uid and coalesce(banned,false)) then
    raise exception 'Account is blocked' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,162));
  select token into v_token from public.scoring_devices where user_id=v_uid;
  if v_token is null or v_token=p_token or (p_previous is not null and v_token=p_previous) or p_takeover then
    insert into public.scoring_devices(user_id,token) values(v_uid,p_token)
      on conflict(user_id) do update set token=excluded.token,claimed_at=now();
    return jsonb_build_object('active',true,'resumed',v_token is not null and v_token=p_previous);
  end if;
  return jsonb_build_object('active',false);
end;
$function$;
revoke all on function public.claim_scoring_device(uuid,uuid,boolean) from public,anon;
grant execute on function public.claim_scoring_device(uuid,uuid,boolean) to authenticated;

create or replace function public.assert_primary_scoring_device()
returns void language plpgsql security definer set search_path=public
as $function$
declare v_uid uuid := auth.uid(); v_token text;
begin
  -- Trusted server jobs/migration sessions have no end-user identity. Existing RLS/grants
  -- still decide whether those sessions can write. Never bypass based on current_user:
  -- SECURITY DEFINER scoring RPCs execute as their owner but retain auth.uid().
  if v_uid is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,162));
  v_token := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-bnn-scoring-device';
  if not exists(select 1 from public.scoring_devices where user_id=v_uid and token::text=v_token) then
    raise exception 'Scoring is active on another device. Make this device primary to continue; your local scores are preserved.' using errcode='P0001';
  end if;
end;
$function$;
revoke all on function public.assert_primary_scoring_device() from public,anon,authenticated;

create or replace function public.guard_primary_scoring_device()
returns trigger language plpgsql security definer set search_path=public
as $function$
declare v_old jsonb; v_new jsonb; v_needs boolean := false;
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
  if tg_table_name='games' then
    if tg_op='UPDATE' then
      v_needs := (v_old->'status',v_old->'scores_reset_at',v_old->'marker_user_id',v_old->'alt_shot_scoring_started_at')
        is distinct from (v_new->'status',v_new->'scores_reset_at',v_new->'marker_user_id',v_new->'alt_shot_scoring_started_at');
    end if;
  elsif tg_table_name='game_alt_shot_scores' then
    v_needs:=true;
  elsif tg_table_name='game_players' then
    if tg_op='UPDATE' then
      v_needs := (v_old->'scores',v_old->'putts',v_old->'fairways',v_old->'penalties',v_old->'sand',v_old->'clock_start',v_old->'clock_end',v_old->'is_marker')
        is distinct from (v_new->'scores',v_new->'putts',v_new->'fairways',v_new->'penalties',v_new->'sand',v_new->'clock_start',v_new->'clock_end',v_new->'is_marker');
    elsif tg_op in ('INSERT','DELETE') then
      if tg_op='DELETE' then v_new:=v_old; end if;
      -- Setup/join with empty arrays is allowed on viewing devices.
      select exists(select 1 from jsonb_array_elements(coalesce(v_new->'scores','[]') ||
        coalesce(v_new->'putts','[]') || coalesce(v_new->'fairways','[]') ||
        coalesce(v_new->'penalties','[]') || coalesce(v_new->'sand','[]')) x
        where x <> 'null'::jsonb and x <> '0'::jsonb and x <> 'false'::jsonb) into v_needs;
    end if;
  elsif tg_table_name='rounds' then
    -- Analysis caching is viewing, not scoring. Score/history mutations remain fenced.
    v_needs := tg_op <> 'UPDATE' or
      (v_old - array['ai_analysis','updated_at']) is distinct from (v_new - array['ai_analysis','updated_at']);
  elsif tg_table_name='holes' then
    v_needs := true;
  end if;
  if v_needs then perform public.assert_primary_scoring_device(); end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;
revoke all on function public.guard_primary_scoring_device() from public,anon,authenticated;
drop trigger if exists primary_scoring_device on public.rounds;
create trigger primary_scoring_device before insert or update or delete on public.rounds
  for each row execute function public.guard_primary_scoring_device();
drop trigger if exists primary_scoring_device on public.holes;
create trigger primary_scoring_device before insert or update or delete on public.holes
  for each row execute function public.guard_primary_scoring_device();
drop trigger if exists primary_scoring_device on public.game_players;
create trigger primary_scoring_device before insert or update or delete on public.game_players
  for each row execute function public.guard_primary_scoring_device();
drop trigger if exists primary_scoring_device on public.game_alt_shot_scores;
create trigger primary_scoring_device before insert or update or delete on public.game_alt_shot_scores
  for each row execute function public.guard_primary_scoring_device();
drop trigger if exists primary_scoring_device on public.games;
create trigger primary_scoring_device before update on public.games
  for each row execute function public.guard_primary_scoring_device();
select public.record_migration('0162_primary_scoring_device');
commit;
