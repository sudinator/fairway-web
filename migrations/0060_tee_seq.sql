-- 0060_tee_seq.sql
-- Make tee-time numbering collision-safe. The number (seq) is a 2-digit year plus
-- the Nth tee time of that year (e.g. 2026's third -> 2603). It used to be computed
-- in the browser from the loaded rows, so two organizers posting at once could both
-- pick the same number. Now the database assigns it atomically, under a per-group
-- advisory lock, and a unique index is a hard backstop. Idempotent. Run after 0059.

-- Hard backstop: no two tee times in a group can share a number.
create unique index if not exists tee_times_group_seq_uidx on public.tee_times (group_id, seq);

-- BEFORE INSERT: when seq isn't supplied, assign the next number for the group+year
-- while holding a per-group lock so concurrent inserts serialize (no collision, no
-- error). max()+1 (not count+1) so a mid-year deletion can't produce a duplicate.
create or replace function assign_tee_seq()
returns trigger language plpgsql as $$
declare yy int; hi int;
begin
  if NEW.seq is not null then return NEW; end if;
  perform pg_advisory_xact_lock(hashtext(NEW.group_id::text));
  yy := (extract(year from coalesce(NEW.play_date, current_date))::int % 100);
  select coalesce(max(seq), yy * 100) into hi
    from public.tee_times
    where group_id = NEW.group_id and seq >= yy * 100 and seq < (yy + 1) * 100;
  NEW.seq := greatest(hi + 1, yy * 100 + 1);
  return NEW;
end $$;

drop trigger if exists trg_assign_tee_seq on public.tee_times;
create trigger trg_assign_tee_seq before insert on public.tee_times
  for each row execute function assign_tee_seq();
