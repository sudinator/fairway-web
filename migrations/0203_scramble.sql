-- 0203_scramble.sql
--
-- 211.0 — Scramble (owner-approved mock, Oct 20 2026). Every player hits, the team picks the best shot, everyone
-- plays from there: ONE score per team per hole. Owner decisions: team sizes 2, 3 and 4; teams compete on one
-- leaderboard ("field") or team v team ("match"); an optional drive requirement (off by default); handicap strokes
-- allotted hole by hole (USGA scramble allowances — lib/scramble.ts); no betting.
--
-- Storage reuses the alternate-shot side scores (game_alt_shot_scores): a scramble team is a "side" of a group
-- (games.foursomes[].a / .b), with one score per hole — inheriting the score-reset fence (0163), the primary
-- scoring device rule (0162) and live updates. New here:
--   * games.scramble_team_size (2–4), scramble_mode ('field' | 'match'), scramble_handicap ('usga' | 'gross'),
--     scramble_min_drives (null = no requirement);
--   * game_alt_shot_scores.drive_key — whose drive was used (a player key on that team), optional;
--   * save_scramble_side_score / save_scramble_score_fenced — the same permission rules as alternate shot (the
--     team's own players, the game's marker, the tee-group marker, the organizer, system admins), for a team of
--     2–4 players, with the drive checked against the team.
--
-- AUTHORIZATION: save_scramble_score_fenced — authenticated (checked inside, as alternate shot);
-- save_scramble_side_score — not callable directly (only through the fenced function).
--
-- Idempotent; safe to re-run.

begin;

alter table public.games add column if not exists scramble_team_size smallint;
alter table public.games add column if not exists scramble_mode text;
alter table public.games add column if not exists scramble_handicap text;
alter table public.games add column if not exists scramble_min_drives smallint;
alter table public.games drop constraint if exists games_scramble_settings_chk;
alter table public.games add constraint games_scramble_settings_chk check (
  (scramble_team_size is null or scramble_team_size between 2 and 4)
  and (scramble_mode is null or scramble_mode in ('field', 'match'))
  and (scramble_handicap is null or scramble_handicap in ('usga', 'gross'))
  and (scramble_min_drives is null or scramble_min_drives between 1 and 9));

alter table public.game_alt_shot_scores add column if not exists drive_key text;

create or replace function public.save_scramble_side_score(p_game uuid, p_foursome_id text, p_side text, p_hole_index integer, p_strokes integer, p_drive_key text)
returns void language plpgsql security definer set search_path = public as $$
declare v_game public.games%rowtype; v_foursome jsonb; v_side_members jsonb; v_authorized boolean := false; v_tee_group smallint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_game is null then raise exception 'Game is required'; end if;
  if nullif(btrim(p_foursome_id), '') is null then raise exception 'Group is required'; end if;
  if p_side not in ('a', 'b') then raise exception 'Scramble team side must be a or b'; end if;
  if p_hole_index is null or p_hole_index < 0 or p_hole_index > 17 then raise exception 'Hole index must be between 0 and 17'; end if;
  if p_strokes is not null and (p_strokes < 1 or p_strokes > 30) then raise exception 'Strokes must be between 1 and 30'; end if;

  select g.* into v_game from public.games g where g.id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.game_type is distinct from 'scramble' then raise exception 'Team scoring here is only valid for a Scramble'; end if;

  select f into v_foursome from jsonb_array_elements(coalesce(v_game.foursomes, '[]'::jsonb)) as f where f ->> 'id' = p_foursome_id limit 1;
  if v_foursome is null then raise exception 'Scramble group not found'; end if;
  v_side_members := coalesce(v_foursome -> p_side, '[]'::jsonb);
  if jsonb_typeof(v_side_members) <> 'array' or jsonb_array_length(v_side_members) not between 2 and 4 then
    raise exception 'A scramble team has 2 to 4 players';
  end if;
  if p_drive_key is not null and not (v_side_members ? p_drive_key) then
    raise exception 'That drive belongs to someone who isn''t on this team';
  end if;

  -- The same permission rules as alternate shot (save_alt_shot_side_score).
  select gp.tee_group into v_tee_group from public.game_players gp
   where gp.game_id = p_game and (v_side_members ? coalesce(gp.user_id::text, gp.id::text)) and gp.tee_group is not null
   order by gp.tee_group limit 1;
  if public.is_admin() then v_authorized := true;
  elsif v_game.created_by = auth.uid() then v_authorized := true;
  elsif v_game.marker_user_id = auth.uid() then v_authorized := true;
  elsif v_tee_group is not null and public.is_tee_group_marker(p_game, v_tee_group) then v_authorized := true;
  else
    v_authorized := exists (select 1 from public.game_players gp where gp.game_id = p_game and gp.user_id = auth.uid()
                             and (v_side_members ? coalesce(gp.user_id::text, gp.id::text)));
  end if;
  if not v_authorized then raise exception 'You are not allowed to score this scramble team'; end if;

  insert into public.game_alt_shot_scores (game_id, foursome_id, side, hole_index, strokes, drive_key, updated_at, updated_by)
  values (p_game, p_foursome_id, p_side, p_hole_index, p_strokes, p_drive_key, now(), auth.uid())
  on conflict (game_id, foursome_id, side, hole_index)
  do update set strokes = excluded.strokes, drive_key = excluded.drive_key, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  if p_strokes is not null then
    update public.games set alt_shot_scoring_started_at = coalesce(alt_shot_scoring_started_at, now()) where id = p_game;
  end if;
end $$;
revoke all on function public.save_scramble_side_score(uuid, text, text, integer, integer, text) from public, anon, authenticated;

create or replace function public.save_scramble_score_fenced(p_game uuid, p_version integer, p_foursome_id text, p_side text, p_hole_index integer, p_strokes integer, p_drive_key text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_previous text := coalesce(current_setting('bnn.game_score_context', true), '');
begin
  perform public.begin_game_score_write(p_game, p_version);
  perform public.save_scramble_side_score(p_game, p_foursome_id, p_side, p_hole_index, p_strokes, p_drive_key);
  perform set_config('bnn.game_score_context', v_previous, true);
end $$;
revoke all on function public.save_scramble_score_fenced(uuid, integer, text, text, integer, integer, text) from public, anon;
grant execute on function public.save_scramble_score_fenced(uuid, integer, text, text, integer, integer, text) to authenticated;

select public.record_migration('0203_scramble');

commit;
