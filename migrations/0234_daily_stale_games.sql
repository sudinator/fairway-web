-- 0234_daily_stale_games.sql
-- AUTHORIZATION: maintenance is server-only; no browser execute grants. Tracking
-- triggers are not directly callable and do not widen any scoring permission.
-- TESTS: ci/assert-daily-stale-games.sql
-- Reuses the existing posting engines, game reset lock (163), personal save lock
-- (159), notification route and pg_cron. Test clubs are excluded throughout.
begin;

alter table public.games add column if not exists last_score_change_at timestamptz;
alter table public.games add column if not exists stale_review_notified_at timestamptz;
alter table public.rounds add column if not exists last_score_change_at timestamptz;
-- Existing unfinished cards get a conservative install-time baseline: their last
-- personal/initial-insert score time was not durably recorded before this release.
update public.games g set last_score_change_at = greatest(case when g.status is distinct from 'ended' then now() else g.created_at end,
  (select max(a.changed_at) from public.score_audit a where a.game_id=g.id and a.field='score'),
  (select max(s.updated_at) from public.game_alt_shot_scores s where s.game_id=g.id))
where last_score_change_at is null;
update public.rounds set last_score_change_at=case when status='in_progress' then now() else coalesce(created_at,now()) end where last_score_change_at is null;
alter table public.games alter column last_score_change_at set default now();
alter table public.rounds alter column last_score_change_at set default now();

create or replace function public.guard_stale_maintenance_fields() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op='INSERT' then
      new.last_score_change_at:=now();
      if tg_table_name='games' then new.created_at:=now(); new.stale_review_notified_at:=null; end if;
    else
      new.last_score_change_at:=old.last_score_change_at;
      if tg_table_name='games' then new.created_at:=old.created_at; new.stale_review_notified_at:=old.stale_review_notified_at; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_stale_maintenance_fields on public.games;
create trigger guard_stale_maintenance_fields before insert or update on public.games
for each row execute function public.guard_stale_maintenance_fields();
drop trigger if exists guard_stale_maintenance_fields on public.rounds;
create trigger guard_stale_maintenance_fields before insert or update on public.rounds
for each row execute function public.guard_stale_maintenance_fields();

create or replace function public.track_stale_score_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_changed boolean:=false;
begin
  if tg_table_name='game_players' then
    v_id:=case when tg_op='DELETE' then old.game_id else new.game_id end;
    if tg_op='UPDATE' then v_changed:=(old.scores,old.no_show) is distinct from (new.scores,new.no_show);
    elsif tg_op='INSERT' then v_changed:=public.jsonb_has_value(new.scores);
    else v_changed:=public.jsonb_has_value(old.scores); end if;
  elsif tg_table_name='game_alt_shot_scores' then
    v_id:=case when tg_op='DELETE' then old.game_id else new.game_id end;
    if tg_op='UPDATE' then v_changed:=old.strokes is distinct from new.strokes; else v_changed:=true; end if;
  else
    v_id:=case when tg_op='DELETE' then old.round_id else new.round_id end;
    if tg_op='UPDATE' then v_changed:=old.strokes is distinct from new.strokes;
    elsif tg_op='INSERT' then v_changed:=new.strokes is not null;
    else v_changed:=old.strokes is not null; end if;
    if v_changed then update public.rounds set last_score_change_at=now() where id=v_id; end if;
    return coalesce(new,old);
  end if;
  if v_changed then update public.games set last_score_change_at=now(),stale_review_notified_at=null where id=v_id; end if;
  return coalesce(new,old);
end $$;
drop trigger if exists track_stale_score_change on public.game_players;
create trigger track_stale_score_change after insert or update or delete on public.game_players for each row execute function public.track_stale_score_change();
drop trigger if exists track_stale_score_change on public.game_alt_shot_scores;
create trigger track_stale_score_change after insert or update or delete on public.game_alt_shot_scores for each row execute function public.track_stale_score_change();
drop trigger if exists track_stale_score_change on public.holes;
create trigger track_stale_score_change after insert or update or delete on public.holes for each row execute function public.track_stale_score_change();

create table if not exists public.stale_game_job_runs (
  id bigint generated always as identity primary key,
  job_date date not null, started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null check(status in ('running','complete','partial')),
  completed_games integer not null default 0, deleted_games integer not null default 0,
  reviewed_games integer not null default 0, completed_rounds integer not null default 0,
  failures integer not null default 0, details jsonb not null default '[]'::jsonb
);
alter table public.stale_game_job_runs enable row level security;
revoke all on public.stale_game_job_runs from public,anon,authenticated;
revoke all on sequence public.stale_game_job_runs_id_seq from public,anon,authenticated;
grant select on public.stale_game_job_runs to authenticated;
drop policy if exists stale_job_admin_read on public.stale_game_job_runs;
create policy stale_job_admin_read on public.stale_game_job_runs for select to authenticated using(public.is_admin());
create index if not exists stale_game_job_date_idx on public.stale_game_job_runs(job_date desc);

-- This helper reads actual scheduled cards. Unknown/malformed data fails closed.
create or replace function public.stale_game_card_state(p_game uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare g public.games%rowtype; p record; f jsonb; v_side text; i integer; n integer;
  occupied boolean:=false; complete boolean:=true; players integer:=0; sides integer:=0; keys text[]:='{}'; k text;
begin
  select * into g from games where id=p_game;
  if not found then return jsonb_build_object('occupied',true,'complete',false); end if;
  n:=jsonb_array_length(coalesce(g.holes_meta,'[]'::jsonb));
  occupied:=exists(select 1 from game_alt_shot_scores where game_id=p_game)
    or exists(select 1 from game_players gp where game_id=p_game and (
      public.jsonb_has_value(gp.scores)
      or exists(select 1 from jsonb_array_elements(coalesce(gp.putts,'[]')) x where x<>'null'::jsonb)
      or public.jsonb_has_value(gp.fairways) or public.jsonb_has_value(gp.penalties) or public.jsonb_has_value(gp.sand)));
  if n not in (9,18) then return jsonb_build_object('occupied',occupied,'complete',false); end if;
  for p in select * from game_players where game_id=p_game and not coalesce(no_show,false) loop
    players:=players+1;
    keys:=array_append(keys,coalesce(p.user_id,p.id)::text);
    for i in 0..n-1 loop
      if jsonb_typeof(p.scores->i) is distinct from 'number' or coalesce(public._jint(p.scores->i),0)<=0 then complete:=false; end if;
    end loop;
  end loop;
  if players=0 then complete:=false; end if;
  if g.game_type in ('alt_shot','scramble') and exists(select 1 from game_alt_shot_scores where game_id=p_game) then
    complete:=true;
    for f in select value from jsonb_array_elements(coalesce(g.foursomes,'[]')) loop
      foreach v_side in array array['a','b'] loop
        if not exists(select 1 from jsonb_array_elements_text(coalesce(f->v_side,'[]')) m where m=any(keys)) then continue; end if;
        sides:=sides+1;
        if (select count(*) from game_alt_shot_scores s where s.game_id=p_game and s.foursome_id=f->>'id' and s.side=v_side and s.hole_index>=0 and s.hole_index<n and s.strokes>0)<>n then complete:=false; end if;
      end loop;
    end loop;
    foreach k in array keys loop
      if (select count(*) from jsonb_array_elements(coalesce(g.foursomes,'[]')) ff,
          jsonb_array_elements_text(coalesce(ff->'a','[]')||coalesce(ff->'b','[]')) m where m=k)<>1 then complete:=false; end if;
    end loop;
    if sides=0 or players=0 then complete:=false; end if;
  end if;
  return jsonb_build_object('occupied',occupied,'complete',complete,'players',players);
end $$;

-- Compute next 4 a.m. Eastern in the scheduler's own timezone. Re-schedule the
-- same named DAILY job after each run; do not change cron.timezone for other jobs.
create or replace function public.stale_job_next_schedule(p_now timestamptz) returns text
language sql stable set search_path=public as $$
  with t as (select ((p_now at time zone 'America/New_York')::date
    +case when (p_now at time zone 'America/New_York')::time>=time '04:00' then 1 else 0 end
    +time '04:00') at time zone 'America/New_York' as due),
  z as(select due at time zone coalesce(nullif(current_setting('cron.timezone',true),''),'GMT') as due from t)
  select format('%s %s * * *',extract(minute from due)::int,extract(hour from due)::int) from z;
$$;

-- A scheduled completion is the same posting operation used by existing games.
-- Personal rounds require all saved slots AND the course-par length basis used
-- by lib/golf roundHoleCount (<=50 identifies nine; otherwise eighteen). A legacy
-- 18-hole partial with only nine stored rows must NOT become a complete nine.
create or replace function public.finish_stale_rounds() returns integer
language plpgsql security definer set search_path=public as $$
declare r record; n integer; scored integer; locked integer; done integer:=0;
begin
  for r in select rr.id,rr.course_par from rounds rr where rr.game_id is null and rr.status='in_progress' and rr.deleted_at is null
    and not public.is_test_group(rr.group_id) and coalesce(rr.last_score_change_at,rr.created_at)<=now()-interval '24 hours'
    and (rr.played_at at time zone 'America/New_York')::date<=(now() at time zone 'America/New_York')::date loop
    if not pg_try_advisory_xact_lock(hashtextextended(r.id::text,159)) then continue; end if;
    select count(*) into n from holes where round_id=r.id;
    select count(*) into locked from (select id from holes where round_id=r.id for update skip locked) h;
    if locked<>n then continue; end if;
    perform 1 from rounds where id=r.id for update;
    select count(*) filter(where strokes>0) into scored from holes where round_id=r.id;
    if n=(case when r.course_par between 1 and 50 then 9 else 18 end) and scored=n then
      update rounds set status='final',gross_score=(select sum(strokes) from holes where round_id=r.id),finished_by='system:auto',finished_at=now()
      where id=r.id and status='in_progress' and deleted_at is null and last_score_change_at<=now()-interval '24 hours';
      if found then done:=done+1; end if;
    end if;
  end loop;
  return done;
end $$;

create or replace function public.run_daily_stale_games(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare g public.games%rowtype; v_id uuid; state jsonb; run_id bigint;
  completed integer:=0; deleted integer:=0; reviewed integer:=0; failed integer:=0; personals integer:=0;
  entries jsonb:='[]'; action text; err text; d date:=(p_now at time zone 'America/New_York')::date;
begin
  if p_now is null then raise exception 'Maintenance time required'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('daily-stale-games',234)) then return jsonb_build_object('skipped','busy'); end if;
  if exists(select 1 from stale_game_job_runs where job_date=d and status='complete') then
    perform cron.schedule('bnn-daily-stale-games',public.stale_job_next_schedule(p_now),'select public.run_daily_stale_games();');
    return jsonb_build_object('skipped','already complete');
  end if;
  insert into stale_game_job_runs(job_date,status) values(d,'running') returning id into run_id;
  for v_id in select id from games where status is distinct from 'ended' and not public.is_test_group(group_id) order by id loop
    if not pg_try_advisory_xact_lock(hashtextextended(v_id::text,163)) then
      if jsonb_array_length(entries)<200 then entries:=entries||jsonb_build_array(jsonb_build_object('game_id',v_id,'result','busy')); end if;
      continue;
    end if;
    action:=null;
    begin
      select * into g from games where id=v_id for update;
      if not found or g.status='ended' or public.is_test_group(g.group_id) then continue; end if;
      if coalesce(g.played_at,d)>d then continue; end if;
      perform 1 from game_players where game_id=v_id for update;
      perform 1 from game_alt_shot_scores where game_id=v_id for update;
      state:=public.stale_game_card_state(v_id);
      if not (state->>'occupied')::boolean
         and d>=greatest((g.created_at at time zone 'America/New_York')::date,coalesce(g.played_at,(g.created_at at time zone 'America/New_York')::date))+7
         and not exists(select 1 from rounds where game_id=v_id and deleted_at is null)
         and not exists(select 1 from team_round_email_log where game_id=v_id)
         and not exists(select 1 from expenses where source_game_id=v_id)
         and not exists(select 1 from group_events where source_game_id=v_id)
         and not exists(select 1 from game_contest_entries e join game_contests c on c.id=e.contest_id where c.game_id=v_id) then
        update competition_sessions set game_id=null where game_id=v_id;
        update rounds set game_id=null where game_id=v_id; -- preserve soft-deleted history
        delete from game_players where game_id=v_id;
        delete from games where id=v_id;
        deleted:=deleted+1; action:='deleted';
      elsif (state->>'complete')::boolean and coalesce(g.last_score_change_at,g.created_at)<=p_now-interval '24 hours' then
        perform public.post_game_rounds_internal(v_id,true);
        update games set status='ended' where id=v_id;
        update game_players set clock_end=coalesce(clock_end,p_now) where game_id=v_id and clock_start is not null and clock_end is null;
        completed:=completed+1; action:='completed';
      elsif (state->>'occupied')::boolean and not (state->>'complete')::boolean
        and coalesce(g.last_score_change_at,g.created_at)<=p_now-interval '48 hours'
        and g.stale_review_notified_at is null and g.created_by is not null then
        insert into notifications(user_id,message,group_id,type,link)
        values(g.created_by,'Your game "'||coalesce(g.name,g.course,'Untitled game')||'" has unfinished scorecards. Resume scoring, or review and end it as played. Existing scores are preserved.',g.group_id,'game_stale_review',case when g.code ~ '^[0-9]{6}$' then '/?tab=games&game='||g.code else '/?tab=games' end);
        update games set stale_review_notified_at=p_now where id=v_id;
        reviewed:=reviewed+1; action:='review';
      elsif not (state->>'occupied')::boolean and d>=greatest((g.created_at at time zone 'America/New_York')::date,coalesce(g.played_at,(g.created_at at time zone 'America/New_York')::date))+7 then
        action:='protected history';
      end if;
    exception when others then
      get stacked diagnostics err=returned_sqlstate;
      failed:=failed+1; action:='error:'||err;
    end;
    if action is not null and jsonb_array_length(entries)<200 then entries:=entries||jsonb_build_array(jsonb_build_object('game_id',v_id,'result',action)); end if;
  end loop;
  begin personals:=public.finish_stale_rounds();
  exception when others then
    get stacked diagnostics err=returned_sqlstate;
    failed:=failed+1; entries:=entries||jsonb_build_array(jsonb_build_object('personal_rounds','error:'||err));
  end;
  update stale_game_job_runs set finished_at=now(),status=case when failed=0 then 'complete' else 'partial' end,
    completed_games=completed,deleted_games=deleted,reviewed_games=reviewed,completed_rounds=personals,failures=failed,details=entries where id=run_id;
  delete from stale_game_job_runs where started_at<now()-interval '90 days';
  perform cron.schedule('bnn-daily-stale-games',public.stale_job_next_schedule(p_now),'select public.run_daily_stale_games();');
  return jsonb_build_object('run_id',run_id,'completed',completed,'deleted',deleted,'reviewed',reviewed,'personal_rounds',personals,'failures',failed);
end $$;

create or replace function public.get_ops_metrics()
returns jsonb
language sql security definer set search_path = public as $fn$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'nudge_shown_7d',    (select count(*) from activity_log where action = 'profile_nudge_shown'   and created_at > now() - interval '7 days'),
    'nudge_clicked_7d',  (select count(*) from activity_log where action = 'profile_nudge_clicked' and created_at > now() - interval '7 days'),
    'nudge_shown_28d',   (select count(*) from activity_log where action = 'profile_nudge_shown'   and created_at > now() - interval '28 days'),
    'nudge_clicked_28d', (select count(*) from activity_log where action = 'profile_nudge_clicked' and created_at > now() - interval '28 days'),
    'profiles_incomplete', (select count(*) from profiles
                              where coalesce(deactivated, false) = false
                                and (avatar_url is null or handicap_index is null)),
    'stale_ready', (select count(*) from rounds r where r.status='in_progress' and r.deleted_at is null and not public.is_test_group(r.group_id)
      and r.last_score_change_at<=now()-interval '24 hours'
      and (select count(*) from holes h where h.round_id=r.id)=case when r.course_par between 1 and 50 then 9 else 18 end
      and not exists(select 1 from holes h where h.round_id=r.id and coalesce(h.strokes,0)<=0)),
    'stale_partial', (select count(*) from rounds r where r.status='in_progress' and r.deleted_at is null and not public.is_test_group(r.group_id)
      and r.last_score_change_at<=now()-interval '24 hours'
      and not ((select count(*) from holes h where h.round_id=r.id)=case when r.course_par between 1 and 50 then 9 else 18 end
        and not exists(select 1 from holes h where h.round_id=r.id and coalesce(h.strokes,0)<=0))),
    'stale_job', (select jsonb_build_object('scheduled',coalesce((select active from cron.job where jobname='bnn-daily-stale-games'),false),
      'schedule',(select schedule from cron.job where jobname='bnn-daily-stale-games'),
      'last_run',(select to_jsonb(j) from stale_game_job_runs j order by id desc limit 1))),
    'auto_finished_7d', (select count(*) from rounds where finished_by = 'system:auto' and finished_at > now() - interval '7 days')
  ) end;
$fn$;


-- Keep the existing Operations list, but use the same canonical classification.
create or replace function public.admin_stale_games()
returns table(game_id uuid,name text,course text,club text,organizer text,holes int,
 created_at timestamptz,age_days numeric,players int,complete int,partial int,not_started int,verdict text,rounds_posted int)
language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then return; end if;
 return query
 with ag as(select g.*,public.stale_game_card_state(g.id) as card from games g
   where g.status is distinct from 'ended' and g.created_at<now()-interval '24 hours'
   and not public.is_test_group(g.group_id) and coalesce(g.played_at,(now() at time zone 'America/New_York')::date)<=(now() at time zone 'America/New_York')::date),
 cards as(select a.id,gp.id as player_id,jsonb_array_length(coalesce(a.holes_meta,'[]')) as planned,
   case when a.game_type in ('alt_shot','scramble') and exists(select 1 from game_alt_shot_scores x where x.game_id=a.id) then
     (select count(*) from game_alt_shot_scores sc join jsonb_array_elements(coalesce(a.foursomes,'[]')) f on f->>'id'=sc.foursome_id
      where sc.game_id=a.id and sc.hole_index>=0 and sc.hole_index<jsonb_array_length(coalesce(a.holes_meta,'[]')) and sc.strokes>0
      and ((sc.side='a' and exists(select 1 from jsonb_array_elements_text(coalesce(f->'a','[]')) m where m=coalesce(gp.user_id,gp.id)::text))
        or (sc.side='b' and exists(select 1 from jsonb_array_elements_text(coalesce(f->'b','[]')) m where m=coalesce(gp.user_id,gp.id)::text))))
   else (select count(*) from jsonb_array_elements(coalesce(gp.scores,'[]')) with ordinality x(v,pos)
     where pos<=jsonb_array_length(coalesce(a.holes_meta,'[]')) and jsonb_typeof(v)='number' and public._jint(v)>0) end as entered
   from ag a left join game_players gp on gp.game_id=a.id and not coalesce(gp.no_show,false)),
 counts as(select id,count(player_id)::int as total,count(player_id) filter(where entered=planned)::int as full_cards,
   count(player_id) filter(where entered>0)::int as started from cards group by id)
 select a.id,coalesce(a.name,'(unnamed)')::text,a.course::text,coalesce(gr.name,a.group_id::text)::text,
   coalesce(p.display_name,p.email,a.created_by::text)::text,jsonb_array_length(coalesce(a.holes_meta,'[]')),
   a.created_at,round(extract(epoch from(now()-a.created_at))/86400.0,1),c.total,
   case when (a.card->>'complete')::boolean then c.total else c.full_cards end,
   case when (a.card->>'complete')::boolean then 0 else greatest(0,c.started-c.full_cards) end,
   greatest(0,c.total-c.started),
   case when (a.card->>'complete')::boolean then 'fully_scored' when (a.card->>'occupied')::boolean then 'in_progress' when c.total=0 then 'empty' else 'no_scores' end,
   (select count(*)::int from rounds r where r.game_id=a.id and r.deleted_at is null)
 from ag a join counts c on c.id=a.id left join groups gr on gr.id=a.group_id left join profiles p on p.id=a.created_by
 order by (a.card->>'complete')::boolean desc,a.created_at;
end $$;

-- Backward-compatible private name; old browsers cannot initiate maintenance.
create or replace function public.sweep_stale_games() returns integer
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin result:=public.run_daily_stale_games(); return coalesce((result->>'completed')::int,0); end $$;
revoke all on function public.guard_stale_maintenance_fields(),public.track_stale_score_change(),public.stale_game_card_state(uuid),public.stale_job_next_schedule(timestamptz),public.run_daily_stale_games(timestamptz),public.sweep_stale_games(),public.finish_stale_rounds() from public,anon,authenticated;
grant execute on function public.run_daily_stale_games(timestamptz) to service_role;
select cron.schedule('bnn-daily-stale-games',public.stale_job_next_schedule(now()),'select public.run_daily_stale_games();');
select public.record_migration('0234_daily_stale_games');
commit;
