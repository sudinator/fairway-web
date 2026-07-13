-- 0084_admin_todos.sql
-- Counts that drive the "needs attention" number badges on the Admin hub tiles.
-- is_admin-gated; returns {} for non-master callers. Safe to run multiple times.
-- pending_course_edits is included now so the dedup's Courses screen can badge it later.
create or replace function public.get_admin_todos()
returns jsonb
language sql security definer set search_path = public as $fn$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'pending_clubs',        (select count(*) from groups where status = 'pending'),
    'new_feedback',         (select count(*) from feedback where status = 'new'),
    'pending_course_edits', (select count(*) from course_change_requests where status = 'pending'),
    'stale_ready',          (select count(*) from rounds r
                               where coalesce(r.status,'final') = 'in_progress' and r.deleted_at is null
                                 and r.created_at < now() - interval '24 hours'
                                 and (select count(*) from holes h where h.round_id = r.id and h.strokes is not null) >= 18)
  ) end;
$fn$;
grant execute on function public.get_admin_todos() to authenticated;
