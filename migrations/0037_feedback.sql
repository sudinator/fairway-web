-- 0037: In-app feedback (bug reports / feature requests / unanswered help questions).
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_name text,
  kind text not null,                         -- 'bug' | 'wish' | 'question'
  message text not null,
  app_version text,
  group_id uuid,
  context text,                               -- where it was sent from (e.g. 'Help')
  status text not null default 'new',         -- 'new' | 'triaged' | 'done'
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- Anyone signed in can file feedback as themselves.
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert with check (auth.uid() = user_id);

-- Submitters see their own; admins see everything.
drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback
  for select using (public.is_admin() or auth.uid() = user_id);

-- Only admins can triage (change status).
drop policy if exists feedback_update on public.feedback;
create policy feedback_update on public.feedback
  for update using (public.is_admin()) with check (public.is_admin());

-- Only admins can clear items.
drop policy if exists feedback_delete on public.feedback;
create policy feedback_delete on public.feedback
  for delete using (public.is_admin());
