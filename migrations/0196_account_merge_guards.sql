-- 0196_account_merge_guards.sql
--
-- 210.2 — review point 4 and the edge cases around it. Suspend and Remove already protected the owner; Merge
-- didn't: an active system admin could merge the OWNER away (merged + banned). Now the merge preview — which
-- merge_accounts_as runs and must pass — refuses, with the reason:
--   * merging away the owner (ownership moves only through a deliberate transfer, never as a side effect);
--   * merging away your own account;
--   * merging away a system admin (the kept account doesn't inherit the role — remove it first, deliberately).
-- Already refused (0190): keeping an account that isn't active / suspended; merging an account into itself;
-- merging an account that is already merged or removed. Suspend: you can no longer suspend yourself.
--
-- AUTHORIZATION: unchanged — account_merge_preview_for / merge_accounts_as server only; set_account_suspended
-- system admin only.
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.account_merge_preview_for(p_actor uuid, p_keep uuid, p_remove uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; n bigint; counts jsonb := '[]'; blockers jsonb := '[]'; k record; d record; c bigint;
begin
  if not exists (select 1 from profiles where id = p_actor and coalesce(is_admin, false) and account_status = 'active') then
    raise exception 'only a system admin can merge accounts' using errcode = '42501';
  end if;
  if p_keep is null or p_remove is null or p_keep = p_remove then raise exception 'choose two different accounts' using errcode = '22023'; end if;
  select * into k from profiles where id = p_keep; select * into d from profiles where id = p_remove;
  if k.id is null or d.id is null then raise exception 'account not found' using errcode = 'P0002'; end if;
  if k.account_status not in ('active', 'suspended') then blockers := blockers || to_jsonb('The account to keep is ' || k.account_status || '.'); end if;
  -- 210.2 (review point 4 and its edge cases): accounts a merge must never take out.
  if coalesce(d.is_owner, false) then blockers := blockers || to_jsonb('That account is the owner''s — ownership can only move through a deliberate transfer, never a merge.'::text); end if;
  if d.id = p_actor then blockers := blockers || to_jsonb('You can''t merge away your own account.'::text); end if;
  if coalesce(d.is_admin, false) then blockers := blockers || to_jsonb('That account is a system admin — remove its system-admin role first, deliberately, then merge.'::text); end if;
  if d.account_status in ('merged', 'removed') then blockers := blockers || to_jsonb('That account is already ' || d.account_status || '.'); end if;
  for r in select * from account_reference_columns where rule not in ('not_an_account') and to_regclass('public.' || table_name) is not null order by table_name, column_name loop
    if r.rule = 'game_json' then
      execute format('select count(*) from public.%I where %I::text like $1', r.table_name, r.column_name) into n using '%"' || p_remove || '"%';
    elsif r.rule = 'move_text' then
      execute format('select count(*) from public.%I where %I = $1', r.table_name, r.column_name) into n using p_remove::text;
    else
      execute format('select count(*) from public.%I where %I = $1', r.table_name, r.column_name) into n using p_remove;
    end if;
    if n > 0 then counts := counts || jsonb_build_object('table', r.table_name, 'column', r.column_name, 'rows', n, 'activity', r.activity, 'rule', r.rule); end if;
    if r.rule = 'move_or_refuse' and n > 0 then
      execute format('select count(*) from public.%I a join public.%I b on %s where a.%I = $1 and b.%I = $2',
        r.table_name, r.table_name, (select string_agg(format('a.%I is not distinct from b.%I', kc, kc), ' and ') from unnest(r.key_columns) kc),
        r.column_name, r.column_name) into c using p_remove, p_keep;
      if c > 0 then blockers := blockers || to_jsonb(format('Both accounts appear in the same %s (%s case%s) — %s', replace(r.key_columns[1], '_id', ''), c, case when c = 1 then '' else 's' end, coalesce(r.note, 'resolve by hand first'))); end if;
    end if;
  end loop;
  select count(*) into c from settlements where (from_user_id = p_remove and to_user_id = p_keep) or (from_user_id = p_keep and to_user_id = p_remove);
  if c > 0 then blockers := blockers || to_jsonb(format('%s settlement%s between the two accounts — merging would turn %s into a payment to himself. Delete or reassign %s first.', c, case when c = 1 then '' else 's' end, case when c = 1 then 'it' else 'them' end, case when c = 1 then 'it' else 'them' end)); end if;
  return jsonb_build_object('keep', jsonb_build_object('id', k.id, 'name', k.display_name, 'email', k.email),
                            'remove', jsonb_build_object('id', d.id, 'name', d.display_name, 'email', d.email),
                            'counts', counts, 'blockers', blockers, 'ok', jsonb_array_length(blockers) = 0);
end $$;
revoke all on function public.account_merge_preview_for(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.set_account_suspended(p_user uuid, p_suspended boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  if not public.is_admin() then raise exception 'only a system admin can suspend or restore a member' using errcode = '42501'; end if;
  select * into pr from profiles where id = p_user for update;
  if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
  if coalesce(pr.is_owner, false) then raise exception 'the owner cannot be suspended' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_suspended then raise exception 'you can''t suspend your own account' using errcode = '42501'; end if;
  if pr.account_status in ('merged', 'removed', 'pending', 'new') then raise exception 'only an active or suspended member can be suspended or restored (this one is %)', pr.account_status using errcode = '55000'; end if;
  update profiles set banned = p_suspended, account_status = case when p_suspended then 'suspended' else 'active' end,
         status_at = now(), status_by = auth.uid(), status_reason = case when p_suspended then coalesce(nullif(trim(p_reason), ''), 'Suspended') else 'Restored' end
   where id = p_user;
  if pr.email is not null then
    if p_suspended then insert into banned_emails(email, reason) values (lower(pr.email), 'suspended') on conflict (email) do nothing;
    else delete from banned_emails where email = lower(pr.email); end if;
  end if;
  if p_suspended then perform public.end_user_sessions(p_user); end if;
  insert into activity_log(actor_id, action, target_user_id, summary)
  values (auth.uid(), case when p_suspended then 'user_banned' else 'user_unbanned' end, p_user, (case when p_suspended then 'Suspended ' else 'Restored ' end) || coalesce(pr.display_name, pr.email));
end $$;
revoke all on function public.set_account_suspended(uuid, boolean, text) from public, anon;
grant execute on function public.set_account_suspended(uuid, boolean, text) to authenticated;

select public.record_migration('0196_account_merge_guards');

commit;
