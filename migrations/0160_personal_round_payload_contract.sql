-- 0160_personal_round_payload_contract.sql
-- AUTHORIZATION: retains SECURITY INVOKER and all 0159 authorization/RLS rules.
-- Parse only fields used by the save operation. New RoundSetup objects contain id="";
-- that ignored client field must never be coerced to the rounds.id UUID type.
-- Round/user/game/hole identity is controlled separately, not accepted from JSON.
begin;
create or replace function public.save_personal_round(
  p_round_id uuid, p_round jsonb, p_final boolean, p_metadata_only boolean default false
) returns jsonb language plpgsql security invoker set search_path = public
as $function$
declare
  v_old public.rounds%rowtype;
  v_new public.rounds%rowtype;
  v_h public.holes%rowtype;
  v_json jsonb;
  v_exists boolean;
  v_was_final boolean := false;
  v_count integer;
begin
  if auth.uid() is null or p_round_id is null then
    raise exception 'Authenticated round identity required' using errcode='42501';
  end if;
  if p_round is null or jsonb_typeof(p_round) <> 'object' or p_final is null
     or p_metadata_only is null then
    raise exception 'Invalid round payload' using errcode='22023';
  end if;
  if exists(select 1 from public.profiles where id=auth.uid() and coalesce(banned,false)) then
    raise exception 'Account is blocked' using errcode='42501';
  end if;
  -- Stable client-generated UUID + transaction lock make retries use one row.
  perform pg_advisory_xact_lock(hashtextextended(p_round_id::text, 159));
  select * into v_old from public.rounds where id=p_round_id for update;
  v_exists := found;
  if v_exists then
    if v_old.deleted_at is not null then
      raise exception 'Round was deleted' using errcode='22023';
    end if;
    if v_old.user_id <> auth.uid() and not public.is_admin()
       and not (p_metadata_only and public.is_group_admin(v_old.group_id, auth.uid())) then
      raise exception 'Cannot edit this round' using errcode='42501';
    end if;
    v_was_final := coalesce(v_old.status,'final') <> 'in_progress';
    if not p_final and v_was_final then
      raise exception 'Background saving cannot change a completed round' using errcode='22023';
    end if;
  elsif p_metadata_only then
    raise exception 'Metadata edit requires an existing round' using errcode='22023';
  end if;
  select * into v_new from jsonb_populate_record(null::public.rounds,jsonb_build_object(
    'course',p_round->'course', 'tee_name',p_round->'tee_name',
    'rating',p_round->'rating', 'slope',p_round->'slope', 'course_par',p_round->'course_par',
    'handicap_index',p_round->'handicap_index', 'course_handicap',p_round->'course_handicap',
    'course_handicap_source',p_round->'course_handicap_source',
    'played_at',p_round->'played_at', 'group_id',p_round->'group_id'
  ));
  if v_new.played_at is null or coalesce(trim(v_new.course),'')='' then
    raise exception 'Course and play date required' using errcode='22023';
  end if;
  if p_metadata_only and (not p_final or not v_was_final or v_old.gross_score is null) then
    raise exception 'Metadata edit requires a completed total-only round' using errcode='22023';
  end if;
  if not p_metadata_only then
    if jsonb_typeof(p_round->'holes') is distinct from 'array'
       or jsonb_array_length(p_round->'holes') not between 1 and 18 then
      raise exception 'One to eighteen holes required' using errcode='22023';
    end if;
    if (select count(distinct (x->>'hole_number')::int) from jsonb_array_elements(p_round->'holes') x)
       <> jsonb_array_length(p_round->'holes') then
      raise exception 'Duplicate or missing hole number' using errcode='22023';
    end if;
  end if;
  if not v_exists then
    insert into public.rounds(id,user_id,course,tee_name,rating,slope,course_par,handicap_index,
      course_handicap,course_handicap_source,played_at,group_id,status)
    values(p_round_id,auth.uid(),v_new.course,v_new.tee_name,v_new.rating,v_new.slope,v_new.course_par,
      v_new.handicap_index,v_new.course_handicap,coalesce(v_new.course_handicap_source,'derived'),
      v_new.played_at,v_new.group_id,case when p_final then 'final' else 'in_progress' end);
  end if;
  if not p_metadata_only then
    for v_json in select value from jsonb_array_elements(p_round->'holes') loop
      select * into v_h from jsonb_populate_record(null::public.holes,jsonb_build_object(
        'hole_number',v_json->'hole_number', 'par',v_json->'par',
        'stroke_index',v_json->'stroke_index', 'yardage',v_json->'yardage',
        'strokes',v_json->'strokes', 'putts',v_json->'putts', 'fairway',v_json->'fairway',
        'penalties',v_json->'penalties', 'sand',v_json->'sand'
      ));
      if v_h.hole_number is null or v_h.hole_number not between 1 and 18
         or v_h.par is null or v_h.par not between 1 and 9
         or v_h.strokes < 0 or v_h.putts < 0 or v_h.penalties < 0 then
        raise exception 'Invalid hole values' using errcode='22023';
      end if;
      -- Preserve existing course-hole metadata; this endpoint saves score/stat edits.
      if exists(select 1 from public.holes where round_id=p_round_id and hole_number=v_h.hole_number) then
        update public.holes set strokes=v_h.strokes, putts=v_h.putts, fairway=v_h.fairway,
          penalties=coalesce(v_h.penalties,0),sand=coalesce(v_h.sand,false)
        where round_id=p_round_id and hole_number=v_h.hole_number;
      else
        insert into public.holes(round_id,hole_number,par,stroke_index,yardage,strokes,putts,fairway,penalties,sand)
        values(p_round_id,v_h.hole_number,v_h.par,v_h.stroke_index,v_h.yardage,
          v_h.strokes,v_h.putts,v_h.fairway,coalesce(v_h.penalties,0),coalesce(v_h.sand,false));
      end if;
      get diagnostics v_count=row_count;
      if v_count <> 1 then raise exception 'Hole write was not confirmed'; end if;
    end loop;
  end if;
  update public.rounds set rating=v_new.rating,slope=v_new.slope,course_par=v_new.course_par,
    course_handicap=v_new.course_handicap,course_handicap_source=coalesce(v_new.course_handicap_source,'derived'),
    played_at=v_new.played_at,gross_score=case when p_metadata_only then v_old.gross_score else null end,
    status=case when p_final then 'final' else 'in_progress' end
  where id=p_round_id;
  get diagnostics v_count=row_count;
  if v_count <> 1 then raise exception 'Round write was not confirmed'; end if;
  return jsonb_build_object('id',p_round_id,'was_final',v_was_final);
end;
$function$;
revoke all on function public.save_personal_round(uuid,jsonb,boolean,boolean) from public, anon;
grant execute on function public.save_personal_round(uuid,jsonb,boolean,boolean) to authenticated;

select public.record_migration('0160_personal_round_payload_contract');
commit;
