-- 0152_competition_share.sql
-- Public live-share link for a Ryder Cup / team competition.
--
-- AUTHORIZATION: two functions with different contracts.
--
--   set_competition_share(p_competition, p_on) — organizer or system admin only, enforced with
--   auth.uid() against competitions.created_by and public.is_admin(). Mints or clears the token.
--   Mirrors set_game_share (0018) but ALSO admits a system admin, per the product decision that an
--   admin can share on an organizer's behalf.
--
--   get_live_competition(p_token) — token-scoped PUBLIC read. The caller is anonymous by design, so
--   there is no auth.uid() to check: the authorization is the unguessable token. It rejects absent
--   or short tokens, looks the competition up BY that token only, and returns nothing else. EXECUTE
--   is revoked from public and granted explicitly to anon and authenticated.
--
-- Shape: the Cup, its sessions in order, and for each linked game everything the public Cup page
-- needs to render the session INLINE — players (with handicaps and scores), pairings, foursomes and
-- Alternate Shot side scores. That is the same data get_live_scorecard returns per game, so the page
-- can reuse lib/live-scoring for every session and stays held to the app's answers by the existing
-- parity harness. Sessions with no linked game, or a linked game with no scores, are returned with
-- game = null / empty scores so the page can show them as "not started" rather than hiding them.
--
-- Guests: the player map carries BOTH user_id and game_players.id keys. Mapping only user_id — as
-- get_live_scorecard did until 0151 — silently drops every guest, because a guest has no user_id and
-- is referenced in pairings/foursomes by their row id. Written correctly here from the start.
--
-- Idempotent; safe to re-run.

begin;

alter table public.competitions add column if not exists share_token text;

create unique index if not exists competitions_share_token_key
  on public.competitions (share_token) where share_token is not null;

-- ── Mint / clear the token ───────────────────────────────────────────────────────────────────────
create or replace function public.set_competition_share(p_competition uuid, p_on boolean)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare v_token text;
begin
  if not exists (
    select 1 from competitions c
    where c.id = p_competition
      -- is_admin() takes NO arguments and reads auth.uid() itself. Calling it as is_admin(auth.uid())
      -- raises "function public.is_admin(uuid) does not exist" and the whole call fails, which is
      -- exactly what happened: the Create live link button did nothing (188.2).
      and (c.created_by = auth.uid() or public.is_admin())
  ) then
    raise exception 'only the organizer or an admin can share this competition';
  end if;

  if p_on then
    select share_token into v_token from competitions where id = p_competition;
    if v_token is null then
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      update competitions set share_token = v_token where id = p_competition;
    end if;
    return v_token;
  else
    update competitions set share_token = null where id = p_competition;
    return null;
  end if;
end;
$function$;

revoke all on function public.set_competition_share(uuid, boolean) from public;
grant execute on function public.set_competition_share(uuid, boolean) to authenticated;

-- ── Public read ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.get_live_competition(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  c        competitions%rowtype;
  v_sessions jsonb;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  select * into c from competitions where share_token = p_token;
  if c.id is null then
    return null;
  end if;
  -- Same retention as a game link: a finished Cup stops resolving after three days.
  if c.status = 'complete' and c.completed_at is not null and c.completed_at < now() - interval '3 days' then
    return null;
  end if;

  select coalesce(jsonb_agg(sess order by sess_order), '[]'::jsonb)
  into v_sessions
  from (
    select
      s.session_order as sess_order,
      jsonb_build_object(
        'id',                  s.id,
        'name',                s.name,
        'format',              s.format,
        'session_order',       s.session_order,
        'play_date',           s.play_date,
        'points_per_match',    s.points_per_match,
        'planned_match_count', s.planned_match_count,
        -- null when the session has no linked game yet: the page shows it as not started.
        'game', case when g.id is null then null else jsonb_build_object(
          'name',             g.name,
          'course',           g.course,
          'course_par',       g.course_par,
          'game_type',        g.game_type,
          'status',           g.status,
          'allowance_pct',    g.allowance_pct,
          'team_score_mode',  g.team_score_mode,
          'trifecta_scoring', g.trifecta_scoring,
          'stroke_basis',     g.stroke_basis,
          'teams',            coalesce(g.teams, '[]'::jsonb),
          'holes_meta',       coalesce(g.holes_meta, '[]'::jsonb),
          'played_at',        g.played_at,
          'ended_at',         g.ended_at
        ) end,
        'players',   coalesce(pl.players, '[]'::jsonb),
        'pairings',  coalesce(pr.pairings, '[]'::jsonb),
        'foursomes', coalesce(fo.foursomes, '[]'::jsonb),
        'alt_shot_scores', coalesce(al.rows, '[]'::jsonb)
      ) as sess
    from competition_sessions s
    left join games g on g.id = s.game_id
    left join lateral (
      select
        jsonb_agg(jsonb_build_object(
          'id',              gp.id,
          'display_name',    gp.display_name,
          'avatar_url',      gp.avatar_url,
          'course_handicap', gp.course_handicap,
          'ch', case
                  when gp.handicap_index is not null and gp.slope is not null
                       and gp.rating is not null and g.course_par is not null
                  then gp.handicap_index * (gp.slope / 113.0) + (gp.rating - g.course_par)
                  else coalesce(gp.course_handicap, 0)
                end,
          'team',      gp.team,
          'tee_group', gp.tee_group,
          'no_show',   coalesce(gp.no_show, false),
          'scores',    coalesce(gp.scores, '[]'::jsonb)
        ) order by gp.created_at) as players,
        coalesce(jsonb_object_agg(gp.user_id::text, gp.id::text) filter (where gp.user_id is not null), '{}'::jsonb)
          || coalesce(jsonb_object_agg(gp.id::text, gp.id::text), '{}'::jsonb) as umap
      from game_players gp where gp.game_id = g.id
    ) pl on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('a', pl.umap ->> (x ->> 'a'), 'b', pl.umap ->> (x ->> 'b'))) as pairings
      from jsonb_array_elements(coalesce(g.pairings, '[]'::jsonb)) x
    ) pr on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', f ->> 'id', 'name', f ->> 'name',
               'swap', coalesce((f ->> 'swap')::boolean, false),
               'a', (select coalesce(jsonb_agg(pl.umap ->> uid) filter (where pl.umap ->> uid is not null), '[]'::jsonb)
                     from jsonb_array_elements_text(coalesce(f -> 'a', '[]'::jsonb)) uid),
               'b', (select coalesce(jsonb_agg(pl.umap ->> uid) filter (where pl.umap ->> uid is not null), '[]'::jsonb)
                     from jsonb_array_elements_text(coalesce(f -> 'b', '[]'::jsonb)) uid)
             )) as foursomes
      from jsonb_array_elements(coalesce(g.foursomes, '[]'::jsonb)) f
    ) fo on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'foursome_id', a.foursome_id, 'side', a.side,
               'hole_index', a.hole_index, 'strokes', a.strokes
             ) order by a.foursome_id, a.side, a.hole_index) as rows
      from game_alt_shot_scores a where a.game_id = g.id
    ) al on true
    where s.competition_id = c.id
  ) q;

  return jsonb_build_object(
    'competition', jsonb_build_object(
      'name',            c.name,
      'location',        c.location,
      'start_date',      c.start_date,
      'status',          c.status,
      'team_a_name',     c.team_a_name,
      'team_b_name',     c.team_b_name,
      'tie_rule',        c.tie_rule,
      'schedule_status', c.schedule_status,
      'completed_at',    c.completed_at
    ),
    'sessions', v_sessions
  );
end;
$function$;

revoke all on function public.get_live_competition(text) from public;
grant execute on function public.get_live_competition(text) to anon, authenticated;

select public.record_migration('0152_competition_share');

commit;
