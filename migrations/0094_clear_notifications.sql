-- 0094_clear_notifications.sql
-- Powers the notification panel's "Clear all". SECURITY DEFINER but scoped to auth.uid(), so it
-- can only ever delete the calling user's own notifications — never anyone else's.
create or replace function public.clear_my_notifications()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notifications where user_id = auth.uid();
$$;

grant execute on function public.clear_my_notifications() to authenticated;
