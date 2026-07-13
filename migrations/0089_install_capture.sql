-- 0089_install_capture.sql
-- Capture whether each user opens BNN as an installed app (standalone) or in a browser tab,
-- so analytics can report the split. Forward-only: no historical backfill is possible.
-- We store the LATEST mode per user (their current usage), updated on every app open via the
-- existing mark_active open-logger. NULL = unknown (hasn't opened since this shipped).
alter table public.profiles add column if not exists last_standalone boolean;

-- Replace mark_active with an optional p_standalone arg. Drop the no-arg overload first so the
-- client's argless-vs-arg calls resolve unambiguously to this single definition.
drop function if exists public.mark_active();
create or replace function public.mark_active(p_standalone boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then return; end if;
  insert into daily_active(user_id, day, opens) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set opens = daily_active.opens + 1;
  if p_standalone is not null then
    update public.profiles set last_standalone = p_standalone where id = auth.uid();
  end if;
end;
$function$;
grant execute on function public.mark_active(boolean) to authenticated;
