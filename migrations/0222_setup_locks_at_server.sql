-- 0222_setup_locks_at_server.sql
--
-- 212.49 — the SERVER refuses every setup change the app's rules refuse (owner, Oct 26: "do a full inventory … and
-- ensure the server side is handled similarly in order to keep the app in sync"; "Yes, enforce rules 1–11"), and
-- scores that arrive after a game has ended (owner: "Refuse them: once ended, scores only change if the organizer
-- reopens"). The app checks these rules before it sends anything (lib/game-setup-policy); the server is the safety net
-- for a phone with an out-of-date picture — offline, a second phone, an old app version — or anything bypassing it.
--
-- Mirrors lib/game-setup-policy "block" rules ("confirm" rules — handicap, tee, allowance, scoring mode, skins ties,
-- side games, no-show, a format change within its family — are allowed changes and stay allowed):
--   1  an ENDED game: no setup changes (its name, sharing and date excepted) and no new scores — reopen it first
--   2  the course, and 3 the number of holes: locked once scoring starts
--   4  the format: once scoring starts, only within its family (individual ↔ individual; four-ball ↔ trifecta)
--   5  skins style, and 6 individual ↔ team match: the team structure is locked once scoring starts
--   7  matchups, and 8 foursomes (incl. first drivers and trifecta singles): locked once scoring starts
--   9  no players added once scoring starts in a match or team format
--   10 no removing a player who has scores (mark them No-show / Out instead)
--   11 no team change for a player who has scores
--   (groups: 0221)
-- "Scoring has started" = any player has a score, or a scramble / alternate shot's team scoring has begun.
-- Exempt: maintenance work with no signed-in caller (migrations, service jobs) and system admins (the admin tools).
-- Team names and colours can always change; clearing scores (a reset) is always allowed; deleting a whole game (every
-- player) is allowed. A late score for an ended game is refused with code BN164 — the app keeps it on the phone and
-- says so.
--
-- AUTHORIZATION: the guard functions are trigger functions and helpers — callable by no one (anon / authenticated
-- revoked). No grants or policies change.
-- TESTS: ci/assert-setup-locks.sql
--
-- Idempotent; safe to re-run.

begin;

-- an array that holds at least one value (a score, a stat)
create or replace function public.jsonb_has_value(a jsonb) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(jsonb_typeof(a) = 'array' and exists (select 1 from jsonb_array_elements(a) e where e <> 'null'::jsonb), false)
$$;

-- the app's game "view" (lib/game-shape): the format, except skins — individual / 1:1 team / 2 v 2 team
create or replace function public.game_view(p_type text, p_teams jsonb, p_foursomes jsonb) returns text
language sql immutable set search_path = public as $$
  select case when p_type <> 'skins' then p_type
              when coalesce(jsonb_typeof(p_teams) = 'array' and jsonb_array_length(p_teams) = 2, false) is not true then 'skins_individual'
              when jsonb_typeof(p_foursomes) = 'array' then 'skins_team_2v2' else 'skins_team_11' end
$$;

-- the team STRUCTURE (keys, in order) — names and colours may always change
create or replace function public.team_keys(p_teams jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p_teams) <> 'array' then 'null'::jsonb
              else coalesce((select jsonb_agg(e->'key' order by o) from jsonb_array_elements(p_teams) with ordinality x(e, o)), '[]'::jsonb) end
$$;

-- matchups as a set of unordered pairs; foursomes without their display names
create or replace function public.pairings_norm(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) <> 'array' then 'null'::jsonb
              else coalesce((select jsonb_agg(jsonb_build_array(least(e->>'a', e->>'b'), greatest(e->>'a', e->>'b')) order by least(e->>'a', e->>'b'), greatest(e->>'a', e->>'b'))
                             from jsonb_array_elements(p) e), '[]'::jsonb) end
$$;
create or replace function public.foursomes_norm(f jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(f) <> 'array' then 'null'::jsonb
              else coalesce((select jsonb_agg(e - 'name' order by o) from jsonb_array_elements(f) with ordinality x(e, o)), '[]'::jsonb) end
$$;

-- scoring has started: a player's score, or a scramble / alternate shot's team scoring
create or replace function public.game_scoring_started(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from game_players p where p.game_id = p_game and public.jsonb_has_value(p.scores))
      or exists (select 1 from games g where g.id = p_game and g.game_type in ('alt_shot', 'scramble') and g.alt_shot_scoring_started_at is not null)
$$;

create or replace function public.setup_lock_exempt() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is null or coalesce(public.is_admin(), false)
$$;

-- ── games: rules 1–8 ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_game_setup_locks() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_setup_changed boolean;
begin
  if public.setup_lock_exempt() then return new; end if;
  v_setup_changed := (old.course, old.course_par, old.holes_meta, old.game_type, old.allowance_pct, old.team_score_mode, old.skins_mode, old.stroke_basis,
                      old.scramble_mode, old.scramble_handicap, old.scramble_allowance, old.scramble_team_size, old.scramble_min_drives,
                      old.leg_config, old.flight_mode, old.flights, old.trifecta_scoring)
                  is distinct from
                     (new.course, new.course_par, new.holes_meta, new.game_type, new.allowance_pct, new.team_score_mode, new.skins_mode, new.stroke_basis,
                      new.scramble_mode, new.scramble_handicap, new.scramble_allowance, new.scramble_team_size, new.scramble_min_drives,
                      new.leg_config, new.flight_mode, new.flights, new.trifecta_scoring)
                  or public.team_keys(old.teams) is distinct from public.team_keys(new.teams)
                  or public.pairings_norm(old.pairings) is distinct from public.pairings_norm(new.pairings)
                  or public.foursomes_norm(old.foursomes) is distinct from public.foursomes_norm(new.foursomes);
  -- 1: an ended game (still ended after this change)
  if old.status = 'ended' and new.status = 'ended' then
    if v_setup_changed then raise exception 'This game has ended. Reopen it before editing this setting.' using errcode = '55000'; end if;
    return new;
  end if;
  if not v_setup_changed or not public.game_scoring_started(new.id) then return new; end if;
  -- 2, 3
  if (old.course, old.course_par, old.holes_meta) is distinct from (new.course, new.course_par, new.holes_meta) then
    raise exception 'The course and the number of holes are locked once scoring begins.' using errcode = '55000';
  end if;
  -- 4: within the family only
  if old.game_type is distinct from new.game_type then
    if not ((public.game_view(old.game_type, old.teams, old.foursomes) in ('stableford', 'stroke', 'skins_individual')
             and public.game_view(new.game_type, new.teams, new.foursomes) in ('stableford', 'stroke', 'skins_individual'))
         or (public.game_view(old.game_type, old.teams, old.foursomes) in ('fourball', 'trifecta')
             and public.game_view(new.game_type, new.teams, new.foursomes) in ('fourball', 'trifecta')
             and jsonb_typeof(old.foursomes) = 'array' and jsonb_array_length(old.foursomes) > 0)) then
      raise exception 'The format can''t switch between team and individual once scoring has started. Clear the scores first, or create a new game.' using errcode = '55000';
    end if;
  end if;
  -- 5, 6
  if public.team_keys(old.teams) is distinct from public.team_keys(new.teams) then
    raise exception 'The team structure is locked once scoring starts — skins style and individual/team matches can''t change mid-round.' using errcode = '55000';
  end if;
  -- 7
  if public.pairings_norm(old.pairings) is distinct from public.pairings_norm(new.pairings) then
    raise exception 'Matchups are frozen once scoring starts. Existing scores must stay attached to the opponents they were played against.' using errcode = '55000';
  end if;
  -- 8
  if public.foursomes_norm(old.foursomes) is distinct from public.foursomes_norm(new.foursomes) then
    raise exception 'Foursomes are frozen once scoring starts. Existing scores must stay attached to the teams and foursomes that played them.' using errcode = '55000';
  end if;
  return new;
end $$;

-- ── game_players: rules 1, 9, 11 (insert / update) ───────────────────────────────────────────────────────────────
create or replace function public.guard_player_setup_locks() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if public.setup_lock_exempt() then return new; end if;
  select status, game_type, teams, foursomes, alt_shot_scoring_started_at into g from games where id = new.game_id;
  if tg_op = 'INSERT' then
    if g.status = 'ended' then raise exception 'This game has ended. Reopen it before adding players.' using errcode = '55000'; end if;
    if public.game_scoring_started(new.game_id) and public.game_view(g.game_type, g.teams, g.foursomes) not in ('stableford', 'stroke', 'skins_individual') then
      raise exception 'Players can''t be added after scoring starts in a match or team contest — that would change the competitive structure.' using errcode = '55000';
    end if;
    return new;
  end if;
  if g.status = 'ended' then
    -- 1: late scores — any new or changed score or stat (clearing them all, as a reset does, is allowed)
    if (old.scores, old.putts, old.fairways, old.penalties, old.sand) is distinct from (new.scores, new.putts, new.fairways, new.penalties, new.sand)
       and (public.jsonb_has_value(new.scores) or public.jsonb_has_value(new.putts) or public.jsonb_has_value(new.fairways)
            or public.jsonb_has_value(new.penalties) or public.jsonb_has_value(new.sand)) then
      raise exception 'This game has ended, so its scores can''t change. Ask the organizer to reopen it.' using errcode = 'BN164';
    end if;
    -- 1: setup on an ended game
    if (old.team, old.tee_group, old.handicap_index, old.rating, old.slope, old.tee_name, old.course_handicap, old.course_handicap_source, old.no_show, old.flight)
       is distinct from (new.team, new.tee_group, new.handicap_index, new.rating, new.slope, new.tee_name, new.course_handicap, new.course_handicap_source, new.no_show, new.flight) then
      raise exception 'This game has ended. Reopen it before editing this setting.' using errcode = '55000';
    end if;
    return new;
  end if;
  -- 11: a scored player's team (a direct change; apply_game_structure already refuses it)
  if old.team is distinct from new.team
     and (public.jsonb_has_value(old.scores) or (g.game_type in ('alt_shot', 'scramble') and g.alt_shot_scoring_started_at is not null)) then
    raise exception '% already has scores. Team membership is frozen once that player''s scoring begins.', coalesce(new.display_name, 'This player') using errcode = '55000';
  end if;
  return new;
end $$;

-- ── game_players: rules 1, 10 (removal) — judged per statement, so deleting a whole game stays possible ────────
create or replace function public.guard_player_removal() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; g record;
begin
  if public.setup_lock_exempt() then return null; end if;
  for r in select distinct game_id from removed loop
    -- every player of the game removed = the game itself is being deleted
    if not exists (select 1 from game_players p where p.game_id = r.game_id) then continue; end if;
    select id, status, game_type, alt_shot_scoring_started_at into g from games where id = r.game_id;
    if g.id is null then continue; end if;
    if g.status = 'ended' then raise exception 'This game has ended. Reopen it before removing players.' using errcode = '55000'; end if;
    if exists (select 1 from removed o where o.game_id = r.game_id and public.jsonb_has_value(o.scores))
       or (g.game_type in ('alt_shot', 'scramble') and g.alt_shot_scoring_started_at is not null) then
      raise exception 'A player with scores can''t be removed. Mark them No-show / Out instead so their played holes stay in the game.' using errcode = '55000';
    end if;
  end loop;
  return null;
end $$;

-- ── team / side scores (scramble, alternate shot): no late scores on an ended game (clearing stays allowed) ───────
create or replace function public.guard_side_scores_ended() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.setup_lock_exempt() then return new; end if;
  if exists (select 1 from games g where g.id = new.game_id and g.status = 'ended') then
    raise exception 'This game has ended, so its scores can''t change. Ask the organizer to reopen it.' using errcode = 'BN164';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_game_setup_locks on public.games;
create trigger trg_guard_game_setup_locks before update on public.games for each row execute function public.guard_game_setup_locks();
drop trigger if exists trg_guard_player_setup_locks on public.game_players;
create trigger trg_guard_player_setup_locks before insert or update on public.game_players for each row execute function public.guard_player_setup_locks();
drop trigger if exists trg_guard_player_removal on public.game_players;
create trigger trg_guard_player_removal after delete on public.game_players referencing old table as removed for each statement execute function public.guard_player_removal();
drop trigger if exists trg_guard_side_scores_ended on public.game_alt_shot_scores;
create trigger trg_guard_side_scores_ended before insert or update on public.game_alt_shot_scores for each row execute function public.guard_side_scores_ended();

revoke all on function public.jsonb_has_value(jsonb), public.game_view(text, jsonb, jsonb), public.team_keys(jsonb), public.pairings_norm(jsonb),
  public.foursomes_norm(jsonb), public.game_scoring_started(uuid), public.setup_lock_exempt(), public.guard_game_setup_locks(),
  public.guard_player_setup_locks(), public.guard_player_removal(), public.guard_side_scores_ended() from public, anon, authenticated;

select public.record_migration('0222_setup_locks_at_server');

commit;
