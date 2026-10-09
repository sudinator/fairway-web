-- 0177_lineup_slug.sql
--
-- A readable line-up link: /lineup/bowling-green-oct10-7h3k2p instead of /lineup/83c53…
--
-- The owner's ask: the link in the chat should read like something. The constraint: a link anyone
-- could GUESS from the club's calendar ("bowling-green-oct10") is not a share link, it is a public
-- page. So the slug is the course (or game name) and the match date for reading, plus six characters
-- from a confusion-free alphabet (no 0/O/1/l/I; 29^6 ≈ 594 million) that nobody can guess. The six
-- characters are what authorizes; the words are cosmetic and are not validated on their own.
--
--   * games.lineup_slug: generated once when the organizer turns sharing on (set_game_share), kept
--     across renames so a posted link keeps working; cleared when sharing is turned off, like
--     share_token. Unique across games.
--   * get_live_lineup accepts the slug OR the share token, so links already in chats keep working.
--   * The /live scorecard keeps its token; only the line-up link changes.
--
-- AUTHORIZATION:
--   * set_game_share: unchanged gate (the organizer, by auth.uid()); now also mints the slug.
--   * get_live_lineup: SECURITY DEFINER, anon/authenticated, keyed solely by the unguessable slug or
--     token (looked up with share_token = p_token or lineup_slug = p_token; short values rejected);
--     returns null for an unknown value; no scores, putts or money.
--
-- Idempotent; safe to re-run.

begin;

alter table public.games add column if not exists lineup_slug text;
create unique index if not exists games_lineup_slug_key on public.games (lineup_slug) where lineup_slug is not null;

create or replace function public.make_lineup_slug(p_game uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare g record; base text; code text; alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789'; i int; cand text;
begin
  select course, name, played_at, created_at into g from games where id = p_game;
  base := lower(coalesce(nullif(trim(g.course), ''), nullif(trim(g.name), ''), 'game'));
  base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
  base := trim(both '-' from left(base, 28));
  base := base || '-' || lower(to_char(coalesce(g.played_at, (g.created_at at time zone 'America/New_York')::date), 'monDD'));
  for i in 1..10 loop
    code := '';
    for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    cand := base || '-' || code;
    if not exists (select 1 from games where lineup_slug = cand) then return cand; end if;
  end loop;
  raise exception 'could not mint a unique line-up slug';
end $$;
revoke all on function public.make_lineup_slug(uuid) from public, anon, authenticated;

create or replace function public.set_game_share(p_game uuid, p_on boolean)
returns text language plpgsql security definer set search_path = public as $function$
declare v_token text; v_slug text;
begin
  if not exists (select 1 from games g where g.id = p_game and g.created_by = auth.uid()) then
    raise exception 'only the organizer can share this game';
  end if;
  if p_on then
    select share_token, lineup_slug into v_token, v_slug from games where id = p_game;
    if v_token is null then
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      update games set share_token = v_token where id = p_game;
    end if;
    if v_slug is null then
      update games set lineup_slug = public.make_lineup_slug(p_game) where id = p_game;
    end if;
    return v_token;
  else
    update games set share_token = null, lineup_slug = null where id = p_game;
    return null;
  end if;
end;
$function$;
revoke all on function public.set_game_share(uuid, boolean) from public, anon;
grant execute on function public.set_game_share(uuid, boolean) to authenticated;

create or replace function public.get_live_lineup(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g record;
  v_players jsonb;
  v_tees jsonb;
  v_date date;
begin
  if p_token is null or length(p_token) < 8 then return null; end if;
  select * into g from games where share_token = p_token or lineup_slug = p_token;
  if g.id is null then return null; end if;
  v_date := coalesce(g.played_at, (g.created_at at time zone 'America/New_York')::date);
  if g.status = 'ended' then
    return jsonb_build_object('ended', true, 'name', g.name, 'course', g.course, 'code', g.code, 'played_on', v_date);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',                     gp.id,
      'user_id',                gp.user_id,
      'display_name',           gp.display_name,
      'handicap_index',         gp.handicap_index,
      'course_handicap',        gp.course_handicap,
      'course_handicap_source', gp.course_handicap_source,
      'slope',                  gp.slope,
      'rating',                 gp.rating,
      'tee_name',               gp.tee_name,
      'team',                   gp.team,
      'tee_group',              gp.tee_group,
      'no_show',                coalesce(gp.no_show, false)
    ) order by gp.display_name), '[]'::jsonb)
    into v_players
    from game_players gp where gp.game_id = g.id;

  select coalesce(fc.data -> 'tees', '[]'::jsonb) into v_tees
    from favorite_courses fc
   where coalesce(fc.deleted, false) = false
     and (fc.name = g.course or (fc.data ->> 'name') = g.course)
   order by (exists (select 1 from group_courses gc where gc.course_id = fc.id and gc.group_id = g.group_id)) desc,
            fc.created_at asc
   limit 1;

  return jsonb_build_object(
    'ended',         false,
    'id',            g.id,
    'code',          g.code,
    'name',          g.name,
    'course',        g.course,
    'played_on',     v_date,
    'played_at',     to_char(v_date, 'Dy Mon FMDD'),
    'game_type',     g.game_type,
    'status',        g.status,
    'allowance_pct', g.allowance_pct,
    'course_par',    g.course_par,
    'holes_meta',    coalesce(g.holes_meta, '[]'::jsonb),
    'teams',         g.teams,
    'pairings',      coalesce(g.pairings, '[]'::jsonb),
    'foursomes',     coalesce(g.foursomes, '[]'::jsonb),
    'players',       v_players,
    'course_tees',   coalesce(v_tees, '[]'::jsonb),
    'as_of',         now()
  );
end $$;
revoke all on function public.get_live_lineup(text) from public;
grant execute on function public.get_live_lineup(text) to anon, authenticated;

select public.record_migration('0177_lineup_slug');

commit;
