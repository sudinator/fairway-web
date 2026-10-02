-- 0166_device_heartbeat_and_scheduled_freshness.sql
--
-- Two follow-ups from 195.0, both about work the user should not have to do by hand.
--
-- 1. SCORING DEVICE LIVENESS. 0162 records who claimed the scoring lease last; it cannot tell
--    whether that device is still open. After scoring on a laptop, the phone was asked "make this
--    device primary?" the next day although the laptop was long closed. The primary now reports
--    itself alive on every check (the client already checks every 20 seconds, on focus and on
--    reconnect, so no new traffic): last_seen_at. A device whose holder has not been heard from
--    for IDLE_WINDOW (6 hours) takes the lease silently and the result says so (superseded: true)
--    so the client archives, rather than resumes, any old outbox it holds. Six hours: a phone
--    scoring offline through a full round is not superseded by a laptop opened at the clubhouse;
--    yesterday's laptop never prompts today's phone. An explicit takeover still works at any time.
--
-- 2. SCHEDULED COURSE FRESHNESS. The upstream-change check (0124) ran only when someone picked the
--    course in New Round, so Pinch Brook sat pending from Aug 29 to Oct 1 because nobody happened
--    to start a round there. The daily contract monitor already fetches each golden course's full
--    detail payload (five a day, inside the 35/day budget); it now runs the same diff against the
--    stored record and records it through record_course_freshness_system, which shares ONE body
--    (record_course_freshness_internal) with the user-triggered path. Same table, same status
--    rules, same admin notification, same Courses review section.
--
-- AUTHORIZATION:
--   * claim_scoring_device: unchanged gate (auth.uid(), not banned). The idle supersession is a
--     relaxation ONLY for a lease whose holder has been silent for six hours; a live holder still
--     fences every other device exactly as before.
--   * record_course_freshness (authenticated): unchanged gate, is_group_member(v_group, auth.uid()),
--     checked BEFORE delegating to the internal body.
--   * record_course_freshness_system: service_role only (current_setting('role')), never granted to
--     app roles. It resolves provider id -> favorite_courses.external_id and writes only through the
--     shared body. The internal body is granted to nobody.
--
-- Idempotent; safe to re-run.

begin;

-- ── 1. Heartbeat ─────────────────────────────────────────────────────────────────────────────────
alter table public.scoring_devices add column if not exists last_seen_at timestamptz not null default now();

create or replace function public.claim_scoring_device(
  p_token uuid, p_previous uuid default null, p_takeover boolean default false
) returns jsonb language plpgsql security definer set search_path=public
as $function$
declare
  v_uid uuid := auth.uid(); v_token uuid; v_seen timestamptz;
  idle_window constant interval := interval '6 hours';
begin
  if v_uid is null or p_token is null or p_takeover is null then
    raise exception 'Authenticated device identity required' using errcode='42501';
  end if;
  if exists(select 1 from public.profiles where id=v_uid and coalesce(banned,false)) then
    raise exception 'Account is blocked' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,162));
  select token, last_seen_at into v_token, v_seen from public.scoring_devices where user_id=v_uid;

  -- The holder checking in: refresh the heartbeat, nothing else changes.
  if v_token is not null and v_token = p_token then
    update public.scoring_devices set last_seen_at = now() where user_id = v_uid;
    return jsonb_build_object('active', true, 'resumed', false);
  end if;

  -- First claim, same-installation resume, explicit takeover: as 0162.
  if v_token is null or (p_previous is not null and v_token = p_previous) or p_takeover then
    insert into public.scoring_devices(user_id, token, claimed_at, last_seen_at) values (v_uid, p_token, now(), now())
      on conflict (user_id) do update set token = excluded.token, claimed_at = now(), last_seen_at = now();
    return jsonb_build_object('active', true, 'resumed', coalesce(v_token is not null and v_token = p_previous, false));
  end if;

  -- The holder has been silent for the idle window: this device takes over without asking. The
  -- client treats superseded exactly like a takeover (start from server scores, archive old work).
  if coalesce(v_seen, '-infinity'::timestamptz) < now() - idle_window then
    update public.scoring_devices set token = p_token, claimed_at = now(), last_seen_at = now() where user_id = v_uid;
    return jsonb_build_object('active', true, 'resumed', false, 'superseded', true);
  end if;

  return jsonb_build_object('active', false);
end;
$function$;
revoke all on function public.claim_scoring_device(uuid,uuid,boolean) from public,anon;
grant execute on function public.claim_scoring_device(uuid,uuid,boolean) to authenticated;

-- ── 2. One freshness body, two entry points ──────────────────────────────────────────────────────
create or replace function public.record_course_freshness_internal(
  p_course_id uuid, p_api_data jsonb, p_diff jsonb, p_has_changes boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_name text;
  was_changed boolean;
  v_tees integer;
  v_yards integer;
  v_first text;
  v_detail text;
begin
  -- No caller check here: the two public entry points below authorise (member, or service_role).
  select group_id, name into v_group, v_name
  from favorite_courses
  where id = p_course_id and coalesce(deleted, false) = false;
  if v_group is null then
    raise exception 'course not found' using errcode = 'P0002';
  end if;

  select has_changes into was_changed from course_freshness where course_id = p_course_id;

  insert into course_freshness (course_id, group_id, checked_at, api_data, diff, has_changes, status, updated_at)
    values (p_course_id, v_group, now(), p_api_data, p_diff, p_has_changes,
            case when p_has_changes then 'pending' else 'none' end, now())
  on conflict (course_id) do update set
    checked_at  = now(),
    group_id    = v_group,
    api_data    = excluded.api_data,
    diff        = excluded.diff,
    has_changes = excluded.has_changes,
    status      = case when excluded.has_changes
                       then (case when course_freshness.status in ('dismissed', 'applied')
                                  then course_freshness.status else 'pending' end)
                       else 'none' end,
    updated_at  = now();

  if p_has_changes and coalesce(was_changed, false) = false then
    -- Summarise the diff the client computed (lib/course-diff.ts shape: {tees:[{name, ratingFrom,
    -- ratingTo, slopeFrom, slopeTo, ratingChanged, slopeChanged, yardageChanges:[{hole,from,to}]}]}).
    select count(*),
           coalesce(sum(jsonb_array_length(coalesce(t->'yardageChanges', '[]'::jsonb))), 0)
      into v_tees, v_yards
      from jsonb_array_elements(coalesce(p_diff->'tees', '[]'::jsonb)) t;
    select string_agg(x, ', ') into v_first from (
      select (t->>'name') ||
             case when (t->>'ratingChanged')::boolean then ' rating ' || (t->>'ratingFrom') || '→' || (t->>'ratingTo') else '' end ||
             case when (t->>'slopeChanged')::boolean then
                  case when (t->>'ratingChanged')::boolean then ',' else '' end || ' slope ' || (t->>'slopeFrom') || '→' || (t->>'slopeTo') else '' end as x
        from jsonb_array_elements(coalesce(p_diff->'tees', '[]'::jsonb)) t
       where (t->>'ratingChanged')::boolean or (t->>'slopeChanged')::boolean
       limit 2) s;
    select string_agg(x, E'\n') into v_detail from (
      select (t->>'name') || ': ' || concat_ws('; ',
               case when (t->>'ratingChanged')::boolean then 'rating ' || (t->>'ratingFrom') || ' → ' || (t->>'ratingTo') end,
               case when (t->>'slopeChanged')::boolean then 'slope ' || (t->>'slopeFrom') || ' → ' || (t->>'slopeTo') end,
               nullif((select string_agg('hole ' || (y->>'hole') || ' ' || coalesce(y->>'from', '—') || '→' || coalesce(y->>'to', '—'), ', ' order by (y->>'hole')::int)
                         from jsonb_array_elements(coalesce(t->'yardageChanges', '[]'::jsonb)) y), '')) as x
        from jsonb_array_elements(coalesce(p_diff->'tees', '[]'::jsonb)) t) d;

    insert into notifications (user_id, message, group_id, type, link, detail)
    select gm.user_id,
           coalesce(v_name, 'A course') || ': GolfCourseAPI now lists different data' ||
           case when v_first is not null then ' — ' || v_first else '' end ||
           case when v_yards > 0 then '; ' || v_yards || ' yardage change' || case when v_yards = 1 then '' else 's' end ||
                                       ' across ' || v_tees || ' tee' || case when v_tees = 1 then '' else 's' end else '' end ||
           '. Review in Courses.',
           v_group, 'course_change', '/?tab=courses', left(v_detail, 2000)
    from group_members gm
    join profiles p on p.id = gm.user_id
    where gm.group_id = v_group and gm.role = 'admin' and gm.status = 'active'
      and gm.user_id is not null and not coalesce(p.banned, false);
  end if;
end $$;
revoke all on function public.record_course_freshness_internal(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;

create or replace function public.record_course_freshness(
  p_course_id uuid, p_api_data jsonb, p_diff jsonb, p_has_changes boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select group_id into v_group from favorite_courses where id = p_course_id and coalesce(deleted, false) = false;
  if v_group is null then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if not public.is_group_member(v_group, auth.uid()) then
    raise exception 'not an active member of this course''s group' using errcode = '42501';
  end if;
  perform public.record_course_freshness_internal(p_course_id, p_api_data, p_diff, p_has_changes);
end $$;
revoke all on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) from public;
revoke all on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) from anon;
grant execute on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) to authenticated;

-- The monitor's entry point: by provider id, as service_role. Returns the number of library
-- courses updated (0 when the provider id is not in the library).
create or replace function public.record_course_freshness_system(
  p_provider_id text, p_api_data jsonb, p_diff jsonb, p_has_changes boolean
) returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  for r in select id from favorite_courses where external_id = trim(p_provider_id) and coalesce(deleted, false) = false loop
    perform public.record_course_freshness_internal(r.id, p_api_data, p_diff, p_has_changes);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.record_course_freshness_system(text, jsonb, jsonb, boolean) from public;
revoke all on function public.record_course_freshness_system(text, jsonb, jsonb, boolean) from anon, authenticated;
grant execute on function public.record_course_freshness_system(text, jsonb, jsonb, boolean) to service_role;

select public.record_migration('0166_device_heartbeat_and_scheduled_freshness');

commit;
