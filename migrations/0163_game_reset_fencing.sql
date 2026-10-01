-- 0163_game_reset_fencing.sql
-- AUTHORIZATION: score bundle writes retain caller RLS; stats and Alternate Shot
-- retain their existing ownership/side guards. Reset rights remain organizer/admin.
-- The reset version supplements primary-device enforcement; it grants no access.
begin;
alter table public.games add column if not exists scoring_version integer not null default 0;

create or replace function public.begin_game_score_write(p_game uuid, p_version integer)
returns void language plpgsql security definer set search_path=public as $$
declare v_version integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform public.assert_primary_scoring_device();
  if not exists(select 1 from public.games where id=p_game and
    (created_by=auth.uid() or public.is_admin() or exists(select 1 from public.game_players where game_id=p_game and user_id=auth.uid()))) then
    raise exception 'Game membership required' using errcode='42501';
  end if;
  -- Serialize BEFORE any player/side row locks. Resets use the same order.
  perform pg_advisory_xact_lock(hashtextextended(p_game::text,163));
  select scoring_version into v_version from public.games where id=p_game;
  if p_version is null or p_version is distinct from v_version then
    raise exception 'Game scores were reset. Reload before scoring; old scores were not saved.' using errcode='BN163';
  end if;
  perform set_config('bnn.game_score_context',jsonb_build_object('game',p_game,'version',p_version)::text,true);
end $$;
revoke all on function public.begin_game_score_write(uuid,integer) from public,anon;
grant execute on function public.begin_game_score_write(uuid,integer) to authenticated;

create or replace function public.guard_game_reset_version()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_game uuid; v_context jsonb; v_version integer; v_changed boolean;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name='game_players' then
    if tg_op='INSERT' then
      select exists(select 1 from jsonb_array_elements(coalesce(new.scores,'[]') || coalesce(new.putts,'[]') || coalesce(new.fairways,'[]') || coalesce(new.penalties,'[]') || coalesce(new.sand,'[]')) x where x<>'null'::jsonb and x<>'0'::jsonb and x<>'false'::jsonb) into v_changed;
      v_changed:=v_changed or new.clock_start is not null or new.clock_end is not null;
    else
    v_changed := (old.scores,old.putts,old.fairways,old.penalties,old.sand,old.clock_start,old.clock_end)
      is distinct from (new.scores,new.putts,new.fairways,new.penalties,new.sand,new.clock_start,new.clock_end);
    end if;
    if not v_changed then return new; end if;
  end if;
  v_game:=new.game_id;
  v_context:=coalesce(nullif(current_setting('bnn.game_score_context',true),''),'{}')::jsonb;
  select scoring_version into v_version from public.games where id=v_game;
  if v_context->>'game' is distinct from v_game::text or
     (v_context->>'version')::integer is distinct from v_version then
    raise exception 'Game scores were reset. Reload before scoring; old scores were not saved.' using errcode='BN163';
  end if;
  perform public.assert_primary_scoring_device();
  return new;
end $$;
revoke all on function public.guard_game_reset_version() from public,anon,authenticated;
drop trigger if exists game_reset_version on public.game_players;
create trigger game_reset_version before insert or update on public.game_players for each row execute function public.guard_game_reset_version();
drop trigger if exists game_reset_version on public.game_alt_shot_scores;
create trigger game_reset_version before insert or update on public.game_alt_shot_scores for each row execute function public.guard_game_reset_version();

-- Browser row updates cannot rewind or invent a reset version.
create or replace function public.guard_game_scoring_version()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_context jsonb;
begin
  if auth.uid() is null then return new; end if;
  if tg_op='INSERT' then
    if new.scoring_version<>0 then raise exception 'Initial scoring version must be zero' using errcode='42501'; end if;
  elsif new.scoring_version is distinct from old.scoring_version then
    v_context:=coalesce(nullif(current_setting('bnn.game_score_context',true),''),'{}')::jsonb;
    if v_context->>'game' is distinct from new.id::text or v_context->>'reset' is distinct from 'true' or new.scoring_version<>old.scoring_version+1 then
      raise exception 'Scoring version is managed by reset' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_game_scoring_version() from public,anon,authenticated;
drop trigger if exists game_scoring_version on public.games;
create trigger game_scoring_version before insert or update on public.games for each row execute function public.guard_game_scoring_version();

create or replace function public.save_game_score_bundle(p_player uuid,p_version integer,p_patch jsonb,p_stats_only boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_game uuid; v_key text; v_result jsonb;
 v_previous text:=coalesce(current_setting('bnn.game_score_context',true),'');
begin
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_stats_only is null then raise exception 'Invalid score patch'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('scores','putts','fairways','penalties','sand','clock_start','clock_end') then raise exception 'Invalid score column'; end if;
    if v_key not in ('clock_start','clock_end') and jsonb_typeof(p_patch->v_key)<>'array' then raise exception 'Score columns require arrays'; end if;
  end loop;
  select game_id into v_game from public.game_players where id=p_player;
  if v_game is null then raise exception 'Player not found or inaccessible' using errcode='42501'; end if;
  perform public.begin_game_score_write(v_game,p_version);
  if p_stats_only then
    if p_patch ?| array['scores','clock_start','clock_end'] then raise exception 'Stats cannot change scores or clock'; end if;
    perform public.save_hole_stats(p_player,p_patch->'putts',p_patch->'fairways',p_patch->'penalties',p_patch->'sand');
  else
    update public.game_players set
      scores=case when p_patch?'scores' then p_patch->'scores' else scores end,
      putts=case when p_patch?'putts' then p_patch->'putts' else putts end,
      fairways=case when p_patch?'fairways' then p_patch->'fairways' else fairways end,
      penalties=case when p_patch?'penalties' then p_patch->'penalties' else penalties end,
      sand=case when p_patch?'sand' then p_patch->'sand' else sand end,
      clock_start=case when p_patch?'clock_start' then (p_patch->>'clock_start')::timestamptz else clock_start end,
      clock_end=case when p_patch?'clock_end' then (p_patch->>'clock_end')::timestamptz else clock_end end
    where id=p_player and game_id=v_game;
    if not found then raise exception 'Score update denied' using errcode='42501'; end if;
  end if;
  select jsonb_build_object('id',id,'scores',scores,'putts',putts,'fairways',fairways,'penalties',penalties,'sand',sand) into v_result from public.game_players where id=p_player;
  perform set_config('bnn.game_score_context',v_previous,true);
  return v_result;
end $$;
revoke all on function public.save_game_score_bundle(uuid,integer,jsonb,boolean) from public,anon;
grant execute on function public.save_game_score_bundle(uuid,integer,jsonb,boolean) to authenticated;

create or replace function public.save_alt_shot_score_fenced(p_game uuid,p_version integer,p_foursome_id text,p_side text,p_hole_index integer,p_strokes integer)
returns void language plpgsql security definer set search_path=public as $$
declare v_previous text:=coalesce(current_setting('bnn.game_score_context',true),'');
begin
  perform public.begin_game_score_write(p_game,p_version);
  perform public.save_alt_shot_side_score(p_game,p_foursome_id,p_side,p_hole_index,p_strokes);
  perform set_config('bnn.game_score_context',v_previous,true);
end $$;
revoke all on function public.save_alt_shot_score_fenced(uuid,integer,text,text,integer,integer) from public,anon;
grant execute on function public.save_alt_shot_score_fenced(uuid,integer,text,text,integer,integer) to authenticated;

create or replace function public.reset_game_scores(p_game uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_previous text:=coalesce(current_setting('bnn.game_score_context',true),'');
begin
  if not exists (
    select 1
      from public.games g
     where g.id = p_game
       and g.created_by = auth.uid()
  ) then
    raise exception 'Only the game organizer can reset scores';
  end if;


  -- Existing per-player scoring/stat state.
  perform public.assert_primary_scoring_device();
  perform pg_advisory_xact_lock(hashtextextended(p_game::text,163));
  perform set_config('bnn.game_score_context',
    (select jsonb_build_object('game',id,'version',scoring_version+1,'reset',true)::text from public.games where id=p_game),true);
  update public.games set scoring_version=scoring_version+1 where id=p_game;

  update public.game_players
     set scores       = '[]'::jsonb,
         putts        = '[]'::jsonb,
         fairways     = '[]'::jsonb,
         penalties    = '[]'::jsonb,
         sand         = '[]'::jsonb,
         clock_start  = null,
         clock_end    = null,
         group_locked = false,
         no_show      = false
   where game_id = p_game;


  -- Canonical Alternate Shot scoring state.
  delete from public.game_alt_shot_scores
   where game_id = p_game;


  -- Reopen an ended game and stamp the reset. Clearing
  -- alt_shot_scoring_started_at allows a truly reset Alternate Shot game to
  -- return to its pre-scoring setup state.
  update public.games
     set status =
           case
             when status = 'ended' then 'active'
             else status
           end,
         scores_reset_at = now(),
         alt_shot_scoring_started_at = null
   where id = p_game;
  perform set_config('bnn.game_score_context',v_previous,true);
end;
$$;
revoke all on function public.reset_game_scores(uuid) from public,anon;
grant execute on function public.reset_game_scores(uuid) to authenticated;

create or replace function public.admin_reset_game(p_game uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_previous text:=coalesce(current_setting('bnn.game_score_context',true),'');
begin
  if not public.is_admin() then
    return;
  end if;


  perform public.assert_primary_scoring_device();
  perform pg_advisory_xact_lock(hashtextextended(p_game::text,163));
  perform set_config('bnn.game_score_context',
    (select jsonb_build_object('game',id,'version',scoring_version+1,'reset',true)::text from public.games where id=p_game),true);
  update public.games set scoring_version=scoring_version+1 where id=p_game;

  update public.game_players
     set scores       = '[]'::jsonb,
         putts        = '[]'::jsonb,
         fairways     = '[]'::jsonb,
         penalties    = '[]'::jsonb,
         sand         = '[]'::jsonb,
         clock_start  = null,
         clock_end    = null,
         group_locked = false,
         no_show      = false
   where game_id = p_game;


  delete from public.game_alt_shot_scores
   where game_id = p_game;


  update public.games
     set status =
           case
             when status = 'ended' then 'active'
             else status
           end,
         scores_reset_at = now(),
         alt_shot_scoring_started_at = null
   where id = p_game;
  perform set_config('bnn.game_score_context',v_previous,true);
end;
$$;
revoke all on function public.admin_reset_game(uuid) from public,anon;
grant execute on function public.admin_reset_game(uuid) to authenticated;
create or replace function public.change_game_course_before_scoring(
  p_game uuid,
  p_course text,
  p_course_par integer,
  p_holes_meta jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous text:=coalesce(current_setting('bnn.game_score_context',true),'');
  v_game public.games%rowtype;
  v_n integer;
  v_blank jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Preserve organizer denial before attempting the scoring locks.
  if exists(select 1 from public.games where id=p_game and created_by is distinct from auth.uid()) then
    raise exception 'only the organizer can change the course' using errcode='42501';
  end if;
  if exists(select 1 from public.games where id=p_game) then
    perform public.begin_game_score_write(p_game,(select scoring_version from public.games where id=p_game));
  end if;

  select * into v_game
  from public.games
  where id = p_game
  for update;

  if not found then
    raise exception 'game not found' using errcode = 'P0002';
  end if;
  if v_game.created_by is distinct from auth.uid() then
    raise exception 'only the organizer can change the course' using errcode = '42501';
  end if;
  if coalesce(v_game.status, 'active') = 'ended' then
    raise exception 'ended games cannot change course' using errcode = '23514';
  end if;
  if nullif(btrim(p_course), '') is null then
    raise exception 'course is required' using errcode = '23514';
  end if;
  if p_course_par is null or p_course_par <= 0 then
    raise exception 'valid course par is required' using errcode = '23514';
  end if;
  if p_holes_meta is null or jsonb_typeof(p_holes_meta) <> 'array' or jsonb_array_length(p_holes_meta) = 0 then
    raise exception 'valid hole metadata is required' using errcode = '23514';
  end if;

  -- Lock player rows and re-check the authoritative score state inside this transaction.
  perform 1 from public.game_players where game_id = p_game for update;
  if exists (
    select 1
    from public.game_players gp,
         lateral jsonb_array_elements(coalesce(gp.scores, '[]'::jsonb)) s(value)
    where gp.game_id = p_game and s.value <> 'null'::jsonb
  ) then
    raise exception 'course cannot change after scoring begins' using errcode = '23514';
  end if;

  v_n := jsonb_array_length(p_holes_meta);
  select coalesce(jsonb_agg(null::jsonb), '[]'::jsonb)
    into v_blank
    from generate_series(1, v_n);

  update public.games
     set course = btrim(p_course),
         course_par = p_course_par,
         holes_meta = p_holes_meta
   where id = p_game;

  update public.game_players
     set tee_name = null,
         rating = null,
         slope = null,
         course_handicap = null,
         scores = v_blank,
         putts = v_blank,
         fairways = v_blank,
         penalties = v_blank,
         sand = v_blank,
         clock_start = null,
         clock_end = null,
         group_locked = false
   where game_id = p_game;
  perform set_config('bnn.game_score_context',v_previous,true);
end;
$$;

create or replace function public.change_game_match_length_before_scoring(
  p_game uuid,
  p_holes_meta jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous text:=coalesce(current_setting('bnn.game_score_context',true),'');
  v_game public.games%rowtype;
  v_n integer;
  v_blank jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- Preserve organizer denial before attempting the scoring locks.
  if exists(select 1 from public.games where id=p_game and created_by is distinct from auth.uid()) then
    raise exception 'Only the game organizer can change the number of holes';
  end if;
  if exists(select 1 from public.games where id=p_game) then
    perform public.begin_game_score_write(p_game,(select scoring_version from public.games where id=p_game));
  end if;

  select * into v_game
    from public.games
   where id = p_game
   for update;

  if not found then raise exception 'Game not found'; end if;
  if v_game.created_by is distinct from auth.uid() then
    raise exception 'Only the game organizer can change the number of holes';
  end if;
  if coalesce(v_game.status, 'active') = 'ended' then
    raise exception 'Ended games cannot change the number of holes';
  end if;

  if p_holes_meta is null
     or jsonb_typeof(p_holes_meta) <> 'array'
     or jsonb_array_length(p_holes_meta) not in (9, 18)
     or exists (
       select 1
         from jsonb_array_elements(p_holes_meta) h
        where jsonb_typeof(h) <> 'object'
           or coalesce((h->>'n')::integer, 0) <= 0
           or coalesce((h->>'par')::integer, 0) <= 0
     )
     or (
       select count(distinct h->>'n')
         from jsonb_array_elements(p_holes_meta) h
     ) <> jsonb_array_length(p_holes_meta) then
    raise exception 'Valid unique metadata for 9 or 18 holes is required';
  end if;

  perform 1 from public.game_players where game_id = p_game for update;

  if v_game.alt_shot_scoring_started_at is not null
     or exists (
       select 1
         from public.game_players gp,
              lateral jsonb_array_elements(coalesce(gp.scores, '[]'::jsonb)) s(value)
        where gp.game_id = p_game
          and s.value <> 'null'::jsonb
     )
     or exists (
       select 1 from public.game_alt_shot_scores ass where ass.game_id = p_game
     ) then
    raise exception 'The number of holes is locked once scoring begins';
  end if;

  v_n := jsonb_array_length(p_holes_meta);
  select coalesce(jsonb_agg(null::jsonb), '[]'::jsonb)
    into v_blank
    from generate_series(1, v_n);

  update public.games
     set holes_meta = p_holes_meta
   where id = p_game;

  update public.game_players
     set scores = v_blank,
         putts = v_blank,
         fairways = v_blank,
         penalties = v_blank,
         sand = v_blank,
         clock_start = null,
         clock_end = null,
         group_locked = false,
         -- Preserve 0153: a manual figure belongs to its selected hole count.
         course_handicap_source = 'derived',
         course_handicap_set_by = null,
         course_handicap_set_at = null
   where game_id = p_game;
  perform set_config('bnn.game_score_context',v_previous,true);
end;
$$;

select public.record_migration('0163_game_reset_fencing');
commit;
