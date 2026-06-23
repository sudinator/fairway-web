-- 0042: Scoring audit trail.
-- Logs every per-hole change to a player's scores/putts/penalties for dispute
-- resolution and debugging: which hole, old -> new value, who made the change,
-- and when. Implemented as an AFTER UPDATE trigger on game_players so it captures
-- ALL write paths (direct update, marker, set_game_scores RPC) automatically.
-- changed_by uses auth.uid(), which reflects the real caller even inside the
-- SECURITY DEFINER score RPCs (the JWT is request-scoped, not definer-scoped).

create table if not exists public.score_audit (
  id             bigint generated always as identity primary key,
  game_id        uuid,
  game_player_id uuid,
  player_name    text,          -- snapshot of whose card changed (readable later)
  hole_index     int,           -- 0-based array position; hole number = index + 1
  field          text,          -- 'score' | 'putts' | 'penalties'
  old_value      int,
  new_value      int,
  changed_by     uuid,          -- who made the edit (auth.uid())
  changed_at     timestamptz not null default now()
);
create index if not exists score_audit_game_idx on public.score_audit (game_id, changed_at desc);

alter table public.score_audit enable row level security;
-- Read only via the RPC below (organizer or admin). No direct table policies for
-- writes: the SECURITY DEFINER trigger inserts and bypasses RLS.
drop policy if exists score_audit_no_select on public.score_audit;
create policy score_audit_no_select on public.score_audit for select using (public.is_admin());

-- Coerce a jsonb scalar to an int (null for json null / non-numbers).
create or replace function public._jint(v jsonb)
returns int language sql immutable as $$
  select case
           when v is null or jsonb_typeof(v) = 'null' then null
           when jsonb_typeof(v) = 'number' then (v #>> '{}')::int
           else null
         end;
$$;

create or replace function public.audit_game_player_scores()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  i int; n int;
  uid uuid := auth.uid();
  pname text := new.display_name;
begin
  if new.scores is distinct from old.scores then
    n := greatest(coalesce(jsonb_array_length(old.scores), 0), coalesce(jsonb_array_length(new.scores), 0));
    for i in 0 .. n - 1 loop
      if (old.scores -> i) is distinct from (new.scores -> i) then
        insert into score_audit (game_id, game_player_id, player_name, hole_index, field, old_value, new_value, changed_by)
        values (new.game_id, new.id, pname, i, 'score', public._jint(old.scores -> i), public._jint(new.scores -> i), uid);
      end if;
    end loop;
  end if;
  if new.putts is distinct from old.putts then
    n := greatest(coalesce(jsonb_array_length(old.putts), 0), coalesce(jsonb_array_length(new.putts), 0));
    for i in 0 .. n - 1 loop
      if (old.putts -> i) is distinct from (new.putts -> i) then
        insert into score_audit (game_id, game_player_id, player_name, hole_index, field, old_value, new_value, changed_by)
        values (new.game_id, new.id, pname, i, 'putts', public._jint(old.putts -> i), public._jint(new.putts -> i), uid);
      end if;
    end loop;
  end if;
  if new.penalties is distinct from old.penalties then
    n := greatest(coalesce(jsonb_array_length(old.penalties), 0), coalesce(jsonb_array_length(new.penalties), 0));
    for i in 0 .. n - 1 loop
      if (old.penalties -> i) is distinct from (new.penalties -> i) then
        insert into score_audit (game_id, game_player_id, player_name, hole_index, field, old_value, new_value, changed_by)
        values (new.game_id, new.id, pname, i, 'penalties', public._jint(old.penalties -> i), public._jint(new.penalties -> i), uid);
      end if;
    end loop;
  end if;
  return new;
end; $$;

drop trigger if exists trg_audit_game_player_scores on public.game_players;
create trigger trg_audit_game_player_scores
  after update on public.game_players
  for each row execute function public.audit_game_player_scores();

-- Read a game's change history. Visible to the game's organizer or an app admin.
create or replace function public.admin_score_audit(p_game uuid)
returns table (
  id bigint, hole_index int, field text, old_value int, new_value int,
  player_name text, changed_by_name text, changed_at timestamptz
)
language sql security definer set search_path = public as $$
  select a.id, a.hole_index, a.field, a.old_value, a.new_value, a.player_name,
         coalesce(pr.display_name, 'Unknown') as changed_by_name, a.changed_at
  from score_audit a
  left join profiles pr on pr.id = a.changed_by
  where a.game_id = p_game
    and (
      public.is_admin()
      or exists (select 1 from games g where g.id = p_game and g.created_by = auth.uid())
    )
  order by a.changed_at desc
  limit 1000;
$$;
grant execute on function public.admin_score_audit(uuid) to authenticated;
