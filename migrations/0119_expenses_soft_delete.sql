-- 0119: soft-delete for expenses. Void sets deleted_at instead of hard-deleting, so an admin can restore.
-- All normal reads filter deleted_at is null; the untangle view can surface deleted rows to restore them.
alter table public.expenses add column if not exists deleted_at timestamptz;

-- keep the common "active expenses for a group" read fast
create index if not exists expenses_group_active_idx on public.expenses (group_id) where deleted_at is null;

select record_migration('0119_expenses_soft_delete');
