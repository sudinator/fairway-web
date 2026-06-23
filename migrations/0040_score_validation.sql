-- 0040: Server-side score validation (defense-in-depth).
-- RLS controls WHO may write a game_players row, but not the VALUES. A crafted
-- request (outside the app UI) could PATCH garbage into the score arrays. This
-- adds a BEFORE INSERT/UPDATE trigger that sanity-checks the numeric arrays.
--
-- The app's normal flow already writes valid arrays, so in practice this should
-- NEVER fire. It only checks a field when that field actually changes, so routine
-- updates that touch other columns (teams, marker, handicap) won't re-validate
-- legacy rows. Bounds are deliberately generous sanity limits, not rules checks.

-- Helper: arr must be null or a JSON array, length <= maxlen, each element null or
-- an integer within [lo, hi].
create or replace function public._valid_num_array(arr jsonb, lo numeric, hi numeric, maxlen int)
returns boolean language plpgsql immutable as $$
declare elem jsonb; v numeric;
begin
  if arr is null then return true; end if;
  if jsonb_typeof(arr) <> 'array' then return false; end if;
  if jsonb_array_length(arr) > maxlen then return false; end if;
  for elem in select * from jsonb_array_elements(arr) loop
    if jsonb_typeof(elem) = 'null' then
      continue;
    elsif jsonb_typeof(elem) = 'number' then
      v := (elem #>> '{}')::numeric;
      if v < lo or v > hi or v <> floor(v) then return false; end if;
    else
      return false; -- strings, booleans, objects, etc. are not valid score entries
    end if;
  end loop;
  return true;
end; $$;

create or replace function public.validate_game_player_scores()
returns trigger language plpgsql security definer set search_path = public as $$
declare hole_count int;
begin
  select coalesce(jsonb_array_length(holes_meta), 18) into hole_count
    from games where id = new.game_id;
  if hole_count is null then hole_count := 18; end if;

  if TG_OP = 'INSERT' or new.scores is distinct from old.scores then
    if not public._valid_num_array(new.scores, 1, 30, hole_count) then
      raise exception 'Rejected: invalid scores array';
    end if;
  end if;
  if TG_OP = 'INSERT' or new.putts is distinct from old.putts then
    if not public._valid_num_array(new.putts, 0, 20, hole_count) then
      raise exception 'Rejected: invalid putts array';
    end if;
  end if;
  if TG_OP = 'INSERT' or new.penalties is distinct from old.penalties then
    if not public._valid_num_array(new.penalties, 0, 30, hole_count) then
      raise exception 'Rejected: invalid penalties array';
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists trg_validate_game_player_scores on public.game_players;
create trigger trg_validate_game_player_scores
  before insert or update on public.game_players
  for each row execute function public.validate_game_player_scores();
