-- ci/assert-historical-baseline-columns.sql
-- Fresh-rebuild hard gate for columns that existed in the historical live database
-- before complete migration capture. These definitions are sourced from the
-- Production-derived 177.14 bootstrap and are required either by historical
-- migrations or by the current application schema.
do $$
declare
  missing text;
begin
  with expected(table_name, column_name, data_type, nullable, default_fragment) as (
    values
      ('profiles','deactivated','boolean','NO','false'),
      ('profiles','dashboard_ai','jsonb','YES',null),
      ('favorite_courses','external_id','text','YES',null),
      ('favorite_courses','facility','text','YES',null),
      ('favorite_courses','corrected','boolean','NO','false'),
      ('rounds','ai_analysis','text','YES',null),
      ('rounds','game_id','uuid','YES',null),
      ('games','score_epoch','integer','NO','0'),
      ('game_players','no_show','boolean','NO','false')
  ), actual as (
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema='public'
  )
  select string_agg(e.table_name || '.' || e.column_name, ', ' order by e.table_name, e.column_name)
    into missing
  from expected e
  left join actual a using (table_name,column_name)
  where a.column_name is null
     or a.data_type <> e.data_type
     or a.is_nullable <> e.nullable
     or (e.default_fragment is not null and coalesce(a.column_default,'') not ilike '%' || e.default_fragment || '%');

  if missing is not null then
    raise exception 'Historical baseline column contract mismatch: %', missing;
  end if;
  raise notice 'Historical baseline column contract: PASS (9 compatibility columns).';
end $$;
