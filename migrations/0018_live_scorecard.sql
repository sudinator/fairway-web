-- 0018_live_scorecard.sql
-- Public, read-only live scorecard, shared by the organizer via an unguessable
-- token. The games/game_players tables stay locked (0001-0017); get_live_scorecard
-- is the ONLY public window, and it returns a curated, display-safe projection:
-- every account user_id is translated into the per-game game_players row id (an
-- opaque alias that can't reach any profile/PII), so head-to-head and four-ball
-- wiring works with zero identifiers leaving the database. No emails, phones,
-- GHIN, or handicap index are ever returned.

alter table public.games add column if not exists share_token text;
alter table public.games add column if not exists ended_at   timestamptz;
create unique index if not exists games_share_token_key
  on public.games (share_token) where share_token is not null;

-- Stamp ended_at when a game ends, clear it if it reopens. A trigger covers every
-- path that flips status (finish_game, per-group finish, reopen, reset) uniformly.
create or replace function public.games_stamp_ended_at()
returns trigger
language plpgsql
as $function$
begin
  if new.status = 'ended' and (old.status is distinct from 'ended') then
    new.ended_at := now();
  elsif new.status is distinct from 'ended' then
    new.ended_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_games_ended_at on public.games;
create trigger trg_games_ended_at
  before update on public.games
  for each row execute function public.games_stamp_ended_at();

-- Organizer-only: mint (or clear) the share token. Revoking kills every link.
create or replace function public.set_game_share(p_game uuid, p_on boolean)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare v_token text;
begin
  if not exists (select 1 from games g where g.id = p_game and g.created_by = auth.uid()) then
    raise exception 'only the organizer can share this game';
  end if;
  if p_on then
    select share_token into v_token from games where id = p_game;
    if v_token is null then
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      update games set share_token = v_token where id = p_game;
    end if;
    return v_token;
  else
    update games set share_token = null where id = p_game;
    return null;
  end if;
end;
$function$;

-- Public read window. Looks the game up by token; enforces the 3-day-after-ended
-- rule; returns a display-safe projection keyed by per-game aliases.
create or replace function public.get_live_scorecard(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  g           games%rowtype;
  v_players   jsonb;
  v_umap      jsonb;
  v_pairings  jsonb;
  v_foursomes jsonb;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;
  select * into g from games where share_token = p_token;
  if g.id is null then
    return null;
  end if;
  -- Once ended, the link stays live for 3 days, then goes dark.
  if g.status = 'ended' and g.ended_at is not null and g.ended_at < now() - interval '3 days' then
    return null;
  end if;

  -- Players keyed by the per-game row id (alias). user_id is NOT returned; instead
  -- we return `ch` = the computed playing-handicap basis (so scoring math matches
  -- the app exactly) without exposing the raw handicap index / slope / rating.
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id',              gp.id,
      'display_name',    gp.display_name,
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
      'scores',    coalesce(gp.scores,   '[]'::jsonb),
      'putts',     coalesce(gp.putts,    '[]'::jsonb),
      'fairways',  coalesce(gp.fairways, '[]'::jsonb)
    ) order by gp.created_at), '[]'::jsonb),
    coalesce(jsonb_object_agg(gp.user_id::text, gp.id::text)
             filter (where gp.user_id is not null), '{}'::jsonb)
  into v_players, v_umap
  from game_players gp
  where gp.game_id = g.id;

  -- Translate pairings (user_id -> alias) for singles match play.
  select coalesce(jsonb_agg(jsonb_build_object(
           'a', v_umap ->> (pr ->> 'a'),
           'b', v_umap ->> (pr ->> 'b')
         )), '[]'::jsonb)
  into v_pairings
  from jsonb_array_elements(coalesce(g.pairings, '[]'::jsonb)) pr;

  -- Translate foursomes (user_id arrays -> alias arrays) for four-ball / trifecta.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',   f ->> 'id',
           'name', f ->> 'name',
           'swap', coalesce((f ->> 'swap')::boolean, false),
           'a', (select coalesce(jsonb_agg(v_umap ->> uid), '[]'::jsonb)
                 from jsonb_array_elements_text(coalesce(f -> 'a', '[]'::jsonb)) uid),
           'b', (select coalesce(jsonb_agg(v_umap ->> uid), '[]'::jsonb)
                 from jsonb_array_elements_text(coalesce(f -> 'b', '[]'::jsonb)) uid)
         )), '[]'::jsonb)
  into v_foursomes
  from jsonb_array_elements(coalesce(g.foursomes, '[]'::jsonb)) f;

  return jsonb_build_object(
    'game', jsonb_build_object(
      'name',            g.name,
      'course',          g.course,
      'course_par',      g.course_par,
      'game_type',       g.game_type,
      'status',          g.status,
      'allowance_pct',   g.allowance_pct,
      'team_score_mode', g.team_score_mode,
      'holes_meta',      coalesce(g.holes_meta, '[]'::jsonb),
      'played_at',       g.played_at,
      'ended_at',        g.ended_at
    ),
    'players',   v_players,
    'pairings',  v_pairings,
    'foursomes', v_foursomes
  );
end;
$function$;

grant execute on function public.set_game_share(uuid, boolean) to authenticated;
grant execute on function public.get_live_scorecard(text) to anon, authenticated;
