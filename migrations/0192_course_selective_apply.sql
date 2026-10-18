-- 0192_course_selective_apply.sql
--
-- Choose which provider changes to apply (209.1). Owner decisions (Oct 2026): each change gets its own tick
-- box; changes to something corrected by hand, and removed tees, start unticked; everything else ticked.
-- Stroke-index changes are one item (providers swap indexes between holes; half a swap breaks the course).
-- Changes left unticked are REMEMBERED and not asked about again unless the provider changes them again.
--
--   * course_freshness.declined — { change key: the provider value that was declined }.
--   * apply_course_freshness_selected_as(actor, course, revision, merged, applied, declined) — SERVER ONLY
--     (service role), called by /api/courses/apply-selected after it builds the merged course with the same
--     comparison code the review screen uses (lib/course-merge). Re-checks everything the all-or-nothing
--     apply checks: club admin (or system admin) for the ACTOR, still pending, same revision, course not
--     edited since the check. Writes one course history version listing exactly what was taken.
--   * course_review_detail(course) — what the review screen needs for the tick boxes (read-only).
--   * course_tee_usage(course, year) — how often each tee of the course was played this year (aggregates
--     only), for the removed-tee line. Club admin / system admin.
--
-- AUTHORIZATION: apply_course_freshness_selected_as — service role only, actor re-checked inside.
-- course_review_detail, course_tee_usage — authenticated; refuse unless the caller may administer the course.
--
-- Idempotent; safe to re-run.

begin;

alter table public.course_freshness add column if not exists declined jsonb not null default '{}'::jsonb;

create or replace function public.apply_course_freshness_selected_as(
  p_actor uuid, p_course_id uuid, p_revision bigint, p_merged jsonb, p_applied text[], p_declined jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f record; v_now text; v_si int[]; v_n int;
begin
  if not (coalesce(current_setting('role', true), 'none') = 'service_role'
          or (session_user in ('postgres', 'supabase_admin') and coalesce(current_setting('role', true), 'none') in ('none', 'postgres', 'supabase_admin'))) then
    raise exception 'selected changes are applied by the server' using errcode = '42501';
  end if;
  if not exists (select 1 from favorite_courses where id = p_course_id and coalesce(deleted, false) = false) then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from profiles where id = p_actor and account_status = 'active' and (
        coalesce(is_admin, false)
        or exists (select 1 from public.course_owner_groups(p_course_id) g
                    join group_members gm on gm.group_id = g and gm.user_id = p_actor and gm.role = 'admin' and gm.status = 'active'))) then
    raise exception 'club admin required' using errcode = '42501';
  end if;
  if coalesce(array_length(p_applied, 1), 0) = 0 then raise exception 'no changes selected' using errcode = '22023'; end if;
  select * into f from course_freshness where course_id = p_course_id for update;
  if not found or f.api_data is null then raise exception 'no provider data recorded for this course' using errcode = 'P0002'; end if;
  if f.status <> 'pending' then raise exception 'this update is not pending review (it is %) — re-check the course', f.status using errcode = '55000'; end if;
  if f.revision is distinct from p_revision then raise exception 'the course was re-checked since you reviewed it — review the latest changes' using errcode = '40001'; end if;
  if f.check_state <> 'ok' then raise exception 'the provider''s data was incomplete — nothing to apply' using errcode = '55000'; end if;
  select md5(coalesce(data::text, '')) into v_now from favorite_courses where id = p_course_id for update;
  if v_now is distinct from f.base_hash then raise exception 'the course was edited after this check — re-check it before applying' using errcode = '40001'; end if;
  -- The merged course must still be a valid course: 9 or 18 holes, pars 3–6, a full set of stroke indexes.
  v_n := jsonb_array_length(coalesce(p_merged->'holes', '[]'));
  if v_n not in (9, 18) then raise exception 'the merged course has % holes', v_n using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_merged->'holes') h where (h->>'par')::int not between 3 and 6) then
    raise exception 'the merged course has a hole without a valid par' using errcode = '22023';
  end if;
  select array_agg((h->>'si')::int order by (h->>'si')::int) into v_si from jsonb_array_elements(p_merged->'holes') h where h->>'si' is not null;
  if v_si is not null and coalesce(array_length(v_si, 1), 0) = v_n and v_n = 18
     and v_si is distinct from (select array_agg(i order by i) from generate_series(1, 18) i) then
    raise exception 'stroke indexes must be 1 to 18, each once — take the provider''s stroke-index changes together' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_merged->'tees', '[]')) = 0 then raise exception 'the merged course has no tees' using errcode = '22023'; end if;

  perform set_config('bnn.course_change', jsonb_build_object('source', 'provider_update', 'ref', 'revision ' || f.revision,
    'reason', 'Provider update — selected: ' || array_to_string(p_applied, ', '))::text, true);
  update favorite_courses set data = p_merged where id = p_course_id;
  update course_freshness set status = 'applied', updated_at = now(), decided_by = p_actor, decided_at = now(),
         decision_reason = 'Applied ' || array_length(p_applied, 1) || ' selected change' || case when array_length(p_applied, 1) = 1 then '' else 's' end,
         declined = coalesce(declined, '{}'::jsonb) || coalesce(p_declined, '{}'::jsonb)
   where course_id = p_course_id;
  return jsonb_build_object('applied', p_applied, 'declined', (select count(*) from jsonb_object_keys(coalesce(p_declined, '{}'::jsonb))));
end $$;
revoke all on function public.apply_course_freshness_selected_as(uuid, uuid, bigint, jsonb, text[], jsonb) from public, anon, authenticated;
grant execute on function public.apply_course_freshness_selected_as(uuid, uuid, bigint, jsonb, text[], jsonb) to service_role;

-- "Keep current data" also remembers what was declined (the whole list), so the next check doesn't re-ask.
create or replace function public.remember_course_declines_as(p_actor uuid, p_course_id uuid, p_declined jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (coalesce(current_setting('role', true), 'none') = 'service_role'
          or (session_user in ('postgres', 'supabase_admin') and coalesce(current_setting('role', true), 'none') in ('none', 'postgres', 'supabase_admin'))) then
    raise exception 'declines are recorded by the server' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = p_actor and account_status = 'active' and (
        coalesce(is_admin, false)
        or exists (select 1 from public.course_owner_groups(p_course_id) g
                    join group_members gm on gm.group_id = g and gm.user_id = p_actor and gm.role = 'admin' and gm.status = 'active'))) then
    raise exception 'club admin required' using errcode = '42501';
  end if;
  update course_freshness set declined = coalesce(declined, '{}'::jsonb) || coalesce(p_declined, '{}'::jsonb) where course_id = p_course_id;
end $$;
revoke all on function public.remember_course_declines_as(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.remember_course_declines_as(uuid, uuid, jsonb) to service_role;

-- What the review screen needs to build the tick boxes: the stored course, the provider's new data, the
-- provider's LAST version from history (provider_update / initial / created; hand changes are manual_edit /
-- member_correction / restore) (where today's value differs from it, someone corrected it by hand),
-- when hand corrections were made since, and what was declined before. Read-only.
create or replace function public.course_review_detail(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_last record; v_out jsonb;
begin
  if not (public.is_admin() or exists (select 1 from public.course_owner_groups(p_course_id) g where public.is_group_admin(g, auth.uid()))) then
    raise exception 'club admin required' using errcode = '42501';
  end if;
  select version, data, created_at into v_last from course_versions
   where course_id = p_course_id and source in ('provider_update', 'initial', 'created') order by version desc limit 1;
  select jsonb_build_object(
           'stored', fc.data, 'api', cf.api_data, 'revision', cf.revision, 'declined', coalesce(cf.declined, '{}'::jsonb),
           'last_provider', v_last.data, 'last_provider_at', v_last.created_at,
           'corrected_at', (select min(v.created_at) from course_versions v where v.course_id = p_course_id
                              and v.source in ('manual_edit', 'member_correction', 'restore') and v.version > coalesce(v_last.version, 0)))
    into v_out
    from favorite_courses fc left join course_freshness cf on cf.course_id = fc.id
   where fc.id = p_course_id;
  return v_out;
end $$;
revoke all on function public.course_review_detail(uuid) from public, anon;
grant execute on function public.course_review_detail(uuid) to authenticated;

create or replace function public.course_tee_usage(p_course_id uuid, p_year integer)
returns table (tee_name text, rounds bigint, players bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_name text;
begin
  if not (public.is_admin() or exists (select 1 from public.course_owner_groups(p_course_id) g where public.is_group_admin(g, auth.uid()))) then
    raise exception 'club admin required' using errcode = '42501';
  end if;
  select coalesce(data->>'name', name) into v_name from favorite_courses where id = p_course_id;
  return query
  select r.tee_name, count(*), count(distinct r.user_id)
    from rounds r
   where r.course = v_name and r.tee_name is not null and r.deleted_at is null
     and extract(year from r.played_at) = p_year
   group by r.tee_name;
end $$;
revoke all on function public.course_tee_usage(uuid, integer) from public, anon;
grant execute on function public.course_tee_usage(uuid, integer) to authenticated;

select public.record_migration('0192_course_selective_apply');

commit;
