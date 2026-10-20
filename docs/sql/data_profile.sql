-- data_profile.sql — READ-ONLY. Run on PRODUCTION before any statistics feature ships (210.5 rule).
-- Part 1: how BIG things are getting (the next 1,000-row style limit, seen coming).
-- Part 2: how MESSY the finished games are (which real-world cases actually occur).
-- Nothing is changed. Each section is one result table.

-- ── Part 1 · Size ────────────────────────────────────────────────────────────────────────────────────
select 'members (profiles)'                       as what, count(*)::text as value from public.profiles
union all select 'clubs (active)',                count(*)::text from public.groups where status = 'active'
union all select 'courses (shared list)',         count(*)::text from public.favorite_courses where not coalesce(deleted, false)
union all select 'games (finished)',              count(*)::text from public.games where status = 'ended'
union all select 'most rounds by one member',     coalesce(max(n), 0)::text from (select count(*) n from public.rounds where deleted_at is null group by user_id) x
union all select 'most hole rows by one member',  coalesce(max(n), 0)::text from (select count(*) n from public.holes h join public.rounds r on r.id = h.round_id where r.deleted_at is null group by r.user_id) x
union all select 'most games by one member',      coalesce(max(n), 0)::text from (select count(*) n from public.game_players where user_id is not null group by user_id) x
union all select 'most expenses in one club',     coalesce(max(n), 0)::text from (select count(*) n from public.expenses where deleted_at is null group by group_id) x
union all select 'most money-audit rows, one club', coalesce(max(n), 0)::text from (select count(*) n from public.money_audit group by group_id) x
union all select 'most tee times in one club',    coalesce(max(n), 0)::text from (select count(*) n from public.tee_times group by group_id) x
union all select 'largest club (active members)', coalesce(max(n), 0)::text from (select count(*) n from public.group_members where status = 'active' group by group_id) x;

-- ── Part 2 · Messiness of finished games ────────────────────────────────────────────────────────────
with gp as (
  select g.id as game_id, g.game_type, jsonb_array_length(coalesce(g.holes_meta, '[]'::jsonb)) as holes,
         p.user_id, p.no_show, coalesce(p.is_guest, p.user_id is null) as guest, p.handicap_index, p.course_handicap_source,
         (select count(*) from jsonb_array_elements(case when jsonb_typeof(p.scores) = 'array' then p.scores else '[]'::jsonb end) with ordinality e(v, i)
           where i <= jsonb_array_length(coalesce(g.holes_meta, '[]'::jsonb)) and jsonb_typeof(e.v) = 'number' and (e.v)::numeric > 0) as scored
    from public.games g join public.game_players p on p.game_id = g.id
   where g.status = 'ended'
)
select 'player-cards in finished games'                    as what, count(*)::text as value from gp
union all select '  · no-shows',                           count(*) filter (where no_show)::text from gp
union all select '  · guests',                             count(*) filter (where guest)::text from gp
union all select '  · NOT a round (fewer than 9 holes)',   count(*) filter (where not no_show and scored < least(9, holes))::text from gp
union all select '  ·   of which empty (0 holes)',         count(*) filter (where not no_show and scored = 0)::text from gp
union all select '  · valid but shortened (9+ holes, not full)', count(*) filter (where not no_show and scored >= least(9, holes) and scored < holes)::text from gp
union all select '  · full cards',                         count(*) filter (where not no_show and scored = holes and holes > 0)::text from gp
union all select '  · members with NO handicap index',     count(*) filter (where not guest and handicap_index is null)::text from gp
union all select '  · derived (calculated) course handicap', count(*) filter (where course_handicap_source = 'derived')::text from gp
union all select 'finished games, by format',              string_agg(distinct game_type, ', ') from gp
union all select '  · alternate-shot games',               count(distinct game_id) filter (where game_type = 'alt_shot')::text from gp
union all select '  · 9-hole games',                       count(distinct game_id) filter (where holes = 9)::text from gp
union all select '  · games with no holes recorded',       count(distinct game_id) filter (where holes = 0)::text from gp;
