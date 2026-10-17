-- 0190_account_merge_remove.sql
--
-- The account side of 208.0. Owner rule (Oct 16 2026): a duplicate is always MERGED into the member's real
-- account and only then taken out — never just deleted. A stranger is rejected (0189). A member who leaves is
-- SUSPENDED (history kept, nobody's balances change). Only an account with no activity can be REMOVED.
--
--   * account_reference_columns — the REGISTRY of every column that refers to an account, with what a merge
--     does to it. Many key references have NO foreign key (rounds, game entries, memberships, games, contest
--     entries…) and player ids also live inside games.pairings / foursomes / structure_stash, so a merge driven
--     by foreign keys alone would miss them. ci/assert-account-merge.sql fails the build if the live schema has
--     an account-like column the registry doesn't classify — nothing can be silently missed later.
--   * account_merge_preview / merge_accounts — every registry rule applied in ONE transaction. Refuses (never
--     guesses) when the two accounts collide where it would corrupt something: both in the same game or
--     competition, both charged in the same expense, or a settlement between them.
--   * set_account_suspended, restore_account, remove_account (empty accounts only; a likely duplicate is sent
--     to merge, an account with history to suspend).
--   * admin_list_users gains status, reason, when, by whom, merged-into.
--   * admin_merge_users / admin_wipe_user (0032/0038) retired: they missed most account references and
--     failed silently. They now refuse, naming their replacement.
--
-- AUTHORIZATION: all functions SECURITY DEFINER; merge / remove / suspend / restore / preview — system admin
-- only, and they RAISE when refused (the old ones returned silently).
--
-- Idempotent; safe to re-run.

begin;

create table if not exists public.account_reference_columns (
  table_name text not null,
  column_name text not null,
  rule text not null check (rule in ('move', 'move_dedupe', 'move_or_refuse', 'delete_duplicate', 'move_text', 'game_json', 'not_an_account')),
  key_columns text[],           -- for move_dedupe / move_or_refuse: the columns that make two rows "the same"
  activity boolean not null default true,  -- counts as real activity (blocks Remove; shown in the merge preview)
  note text,
  primary key (table_name, column_name)
);
alter table public.account_reference_columns enable row level security;
revoke all on public.account_reference_columns from anon, authenticated;

insert into public.account_reference_columns(table_name, column_name, rule, key_columns, activity, note) values
  -- the member's own golf
  ('rounds', 'user_id', 'move_or_refuse', array['game_id'], true, 'both accounts with a round from the same game = conflict'),
  ('rounds', 'finished_by', 'move_text', null, false, 'text uuid'),
  ('rounds', 'course_handicap_set_by', 'move', null, false, null),
  ('game_players', 'user_id', 'move_or_refuse', array['game_id'], true, 'both accounts in the same game = conflict'),
  ('game_players', 'scored_by', 'move', null, false, null),
  ('game_players', 'course_handicap_set_by', 'move', null, false, null),
  ('games', 'created_by', 'move', null, true, null),
  ('games', 'marker_user_id', 'move', null, false, null),
  ('games', 'pairings', 'game_json', null, false, 'player keys inside the json'),
  ('games', 'foursomes', 'game_json', null, false, 'player keys inside the json'),
  ('games', 'structure_stash', 'game_json', null, false, 'saved pairings / foursomes'),
  ('game_contests', 'created_by', 'move', null, true, null),
  ('game_contest_entries', 'player_id', 'move', null, true, null),
  ('game_contest_entries', 'recorded_by', 'move', null, false, null),
  ('game_alt_shot_scores', 'updated_by', 'move', null, false, null),
  ('score_audit', 'changed_by', 'move', null, false, null),
  ('score_audit', 'game_player_id', 'not_an_account', null, false, 'refers to a game_players row'),
  ('favorite_courses', 'user_id', 'move', null, true, null),
  ('favorite_courses', 'deleted_by', 'move', null, false, null),
  ('course_change_requests', 'submitted_by', 'move', null, true, null),
  ('course_change_requests', 'reviewed_by', 'move', null, false, null),
  ('group_course_overrides', 'updated_by', 'move', null, false, null),
  ('course_freshness', 'decided_by', 'move', null, false, null),
  ('course_versions', 'actor', 'move', null, false, null),
  ('group_courses', 'added_by', 'move', null, false, null),
  ('competitions', 'created_by', 'move', null, true, null),
  ('competitions', 'schedule_locked_by', 'move', null, false, null),
  ('competition_players', 'user_id', 'move_or_refuse', array['competition_id'], true, 'both in the same competition = conflict'),
  ('competition_schedule_events', 'actor_id', 'move', null, false, null),
  ('member_badges', 'user_id', 'move_dedupe', array['badge_key'], false, 'same badge on both = keep one'),
  ('player_cards', 'user_id', 'delete_duplicate', null, false, 'one card per member; the kept account''s stays'),
  -- clubs
  ('group_members', 'user_id', 'move_dedupe', array['group_id'], false, 'already in the club = keep one (admin role carried over)'),
  ('groups', 'created_by', 'move', null, true, null),
  ('group_invites', 'created_by', 'move', null, false, null),
  ('group_invites', 'used_by', 'move', null, false, null),
  ('group_guests', 'sponsor_user_id', 'move', null, true, null),
  ('group_guests', 'created_by', 'move', null, false, null),
  ('group_guests', 'became_member_id', 'move', null, false, null),
  ('group_events', 'created_by', 'move', null, true, null),
  ('group_events', 'closed_by', 'move', null, false, null),
  ('tee_times', 'created_by', 'move', null, true, null),
  ('tee_times', 'captain_user_id', 'move', null, false, null),
  ('tee_time_rsvps', 'user_id', 'move_dedupe', array['tee_time_id'], true, 'answered on both = keep one'),
  -- money
  ('expenses', 'payer_user_id', 'move', null, true, null),
  ('expenses', 'created_by', 'move', null, false, null),
  ('expense_shares', 'user_id', 'move_or_refuse', array['expense_id'], true, 'charged on both accounts in one expense = refuse (would double-charge)'),
  ('expense_shares', 'sponsor_user_id', 'move', null, false, null),
  ('expense_payers', 'user_id', 'move_or_refuse', array['expense_id'], true, 'paid from both accounts in one expense = refuse'),
  ('expense_payers', 'sponsor_user_id', 'move', null, false, null),
  ('settlements', 'from_user_id', 'move', null, true, 'a settlement BETWEEN the two accounts is refused separately'),
  ('settlements', 'to_user_id', 'move', null, true, null),
  ('settlements', 'created_by', 'move', null, false, null),
  ('expense_audit', 'actor_user_id', 'move', null, false, null),
  ('money_audit', 'actor_id', 'move', null, false, null),
  -- messages, devices, logs
  ('notifications', 'user_id', 'move', null, false, null),
  ('push_subscriptions', 'user_id', 'move', null, false, null),
  ('push_subscriptions', 'user_agent', 'not_an_account', null, false, 'browser description'),
  ('push_delivery_log', 'user_id', 'move', null, false, null),
  ('scoring_devices', 'user_id', 'delete_duplicate', null, false, 'one device record per member'),
  ('nudges', 'sender_id', 'move', null, false, null),
  ('nudges', 'recipient_id', 'move', null, false, null),
  ('activity_log', 'actor_id', 'move', null, false, null),
  ('activity_log', 'target_user_id', 'move', null, false, null),
  ('activity_log', 'actor_name', 'not_an_account', null, false, 'a name, kept as written'),
  ('group_activity', 'actor_user_id', 'move', null, false, null),
  ('feedback', 'user_id', 'move', null, false, null),
  ('feedback', 'user_name', 'not_an_account', null, false, 'a name, kept as written'),
  ('friction_items', 'subject_user', 'move', null, false, null),
  ('friction_items', 'reviewed_by', 'move', null, false, null),
  ('daily_active', 'user_id', 'move_dedupe', array['day'], false, 'active on the same day = keep one'),
  ('ai_usage_daily', 'user_id', 'move_dedupe', array['usage_date', 'operation_type'], false, null),
  ('api_rate_limits', 'user_id', 'delete_duplicate', null, false, 'rate-limit counters'),
  ('profiles', 'merged_into', 'not_an_account', null, false, 'set by the merge itself'),
  ('profiles', 'status_by', 'move', null, false, null),
  ('profiles', 'possible_duplicate_of', 'move', null, false, 'a held sign-up pointing at the duplicate now points at the kept account')
on conflict (table_name, column_name) do update
  set rule = excluded.rule, key_columns = excluded.key_columns, activity = excluded.activity, note = excluded.note;

-- ---------------------------------------------------------------- preview
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
-- Read-only: a system admin may preview from the app.
create or replace function public.account_merge_preview(p_keep uuid, p_remove uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.account_merge_preview_for(auth.uid(), p_keep, p_remove)
$$;
revoke all on function public.account_merge_preview(uuid, uuid) from public, anon;
grant execute on function public.account_merge_preview(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- merge
-- Runs on the SERVER (service role), called by /api/admin/merge-accounts after it has checked the caller is a
-- system admin. Not callable from a phone: a merge moves rounds, and the primary-scoring-device guard (0162)
-- rightly refuses round changes from an end user whose scoring device isn't primary. A merge isn't scoring;
-- trusted server work has no end-user identity, which is exactly the guard's sanctioned path.
create or replace function public.merge_accounts_as(p_actor uuid, p_keep uuid, p_remove uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pv jsonb; r record; d record; moved jsonb := '[]'; n bigint; kc text; cond text;
begin
  -- The server (service role), or a true admin session not acting as an app user — the rule 0158 uses.
  if not (coalesce(current_setting('role', true), 'none') = 'service_role'
          or (session_user in ('postgres', 'supabase_admin') and coalesce(current_setting('role', true), 'none') in ('none', 'postgres', 'supabase_admin'))) then
    raise exception 'merges run on the server' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = p_actor and coalesce(is_admin, false) and account_status = 'active') then
    raise exception 'only a system admin can merge accounts' using errcode = '42501';
  end if;
  pv := public.account_merge_preview_for(p_actor, p_keep, p_remove);
  if not (pv->>'ok')::boolean then raise exception 'cannot merge: %', (select string_agg(x, ' · ') from jsonb_array_elements_text(pv->'blockers') x) using errcode = '55000'; end if;
  perform 1 from profiles where id in (p_keep, p_remove) for update;
  select * into d from profiles where id = p_remove;

  -- club membership: carry an admin role across before the duplicate's row goes
  update group_members k set role = 'admin' from group_members x
   where k.user_id = p_keep and x.user_id = p_remove and x.group_id = k.group_id and x.role = 'admin' and k.role <> 'admin';

  for r in select * from account_reference_columns where rule not in ('not_an_account') and to_regclass('public.' || table_name) is not null order by table_name, column_name loop
    if r.rule = 'game_json' then
      execute format('update public.%I set %I = replace(%I::text, $1, $2)::jsonb where %I::text like $3', r.table_name, r.column_name, r.column_name, r.column_name)
        using '"' || p_remove || '"', '"' || p_keep || '"', '%"' || p_remove || '"%';
    elsif r.rule = 'move_text' then
      execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name) using p_keep::text, p_remove::text;
    elsif r.rule = 'delete_duplicate' then
      execute format('delete from public.%I where %I = $1 and exists (select 1 from public.%I k where k.%I = $2)', r.table_name, r.column_name, r.table_name, r.column_name) using p_remove, p_keep;
      execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name) using p_keep, p_remove;
    elsif r.rule = 'move_dedupe' then
      cond := (select string_agg(format('k.%I is not distinct from t.%I', kc2, kc2), ' and ') from unnest(r.key_columns) kc2);
      execute format('delete from public.%I t where t.%I = $1 and exists (select 1 from public.%I k where k.%I = $2 and %s)', r.table_name, r.column_name, r.table_name, r.column_name, cond) using p_remove, p_keep;
      execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name) using p_keep, p_remove;
    else   -- move, move_or_refuse (collisions already refused by the preview)
      execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name) using p_keep, p_remove;
    end if;
    get diagnostics n = row_count;
    if n > 0 then moved := moved || jsonb_build_object('table', r.table_name, 'column', r.column_name, 'rows', n); end if;
  end loop;

  -- the kept profile fills its blanks from the duplicate; the duplicate is taken out
  update profiles k set handicap_index = coalesce(k.handicap_index, d.handicap_index), ghin_number = coalesce(k.ghin_number, d.ghin_number),
         phone = coalesce(k.phone, d.phone), avatar_url = coalesce(k.avatar_url, d.avatar_url)
    from profiles dd where k.id = p_keep and dd.id = p_remove;
  update profiles set account_status = 'merged', merged_into = p_keep, banned = true, status_at = now(), status_by = p_actor,
         status_reason = coalesce(nullif(trim(p_reason), ''), 'Duplicate'), pending_kind = null, pending_group = null, possible_duplicate_of = null
   where id = p_remove;
  if d.email is not null then
    insert into banned_emails(email, reason) values (lower(d.email), 'Merged into ' || coalesce((select display_name from profiles where id = p_keep), 'another account'))
      on conflict (email) do update set reason = excluded.reason;
  end if;
  perform public.end_user_sessions(p_remove);
  insert into activity_log(actor_id, action, target_user_id, summary)
  values (p_actor, 'account_merged', p_keep, 'Merged ' || coalesce(d.email, 'an account') || ' into ' || coalesce((select email from profiles where id = p_keep), 'the kept account'));
  return jsonb_build_object('moved', moved, 'removed_email', d.email);
end $$;
revoke all on function public.merge_accounts_as(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.merge_accounts_as(uuid, uuid, uuid, text) to service_role;
drop function if exists public.merge_accounts(uuid, uuid, text);

-- ---------------------------------------------------------------- suspend / restore / remove
create or replace function public.set_account_suspended(p_user uuid, p_suspended boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  if not public.is_admin() then raise exception 'only a system admin can suspend or restore a member' using errcode = '42501'; end if;
  select * into pr from profiles where id = p_user for update;
  if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
  if coalesce(pr.is_owner, false) then raise exception 'the owner cannot be suspended' using errcode = '42501'; end if;
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

-- The old entry point keeps working, through the new one.
create or replace function public.admin_set_banned(p_user uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.set_account_suspended(p_user, p_banned, null);
end $$;
grant execute on function public.admin_set_banned(uuid, boolean) to authenticated;

create or replace function public.restore_account(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  if not public.is_admin() then raise exception 'only a system admin can restore an account' using errcode = '42501'; end if;
  select * into pr from profiles where id = p_user for update;
  if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
  if pr.account_status = 'merged' then raise exception 'a merged account can''t be restored — its history now lives on the account it was merged into' using errcode = '55000'; end if;
  if pr.account_status not in ('removed', 'suspended') then raise exception 'this account is % — nothing to restore', pr.account_status using errcode = '55000'; end if;
  update profiles set account_status = 'active', banned = false, status_at = now(), status_by = auth.uid(), status_reason = 'Restored' where id = p_user;
  if pr.email is not null then delete from banned_emails where email = lower(pr.email); end if;
  insert into activity_log(actor_id, action, target_user_id, summary) values (auth.uid(), 'account_restored', p_user, 'Restored ' || coalesce(pr.display_name, pr.email));
end $$;
revoke all on function public.restore_account(uuid) from public, anon;
grant execute on function public.restore_account(uuid) to authenticated;

-- What an account holds: real activity only (excludes devices, logs, notifications, memberships).
create or replace function public.account_activity(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; n bigint; out jsonb := '[]';
begin
  if not public.is_admin() then raise exception 'system admin only' using errcode = '42501'; end if;
  for r in select * from account_reference_columns where activity and rule not in ('not_an_account', 'game_json') and to_regclass('public.' || table_name) is not null loop
    if r.rule = 'move_text' then execute format('select count(*) from public.%I where %I = $1', r.table_name, r.column_name) into n using p_user::text;
    else execute format('select count(*) from public.%I where %I = $1', r.table_name, r.column_name) into n using p_user; end if;
    if n > 0 then out := out || jsonb_build_object('table', r.table_name, 'column', r.column_name, 'rows', n); end if;
  end loop;
  return out;
end $$;
revoke all on function public.account_activity(uuid) from public, anon;
grant execute on function public.account_activity(uuid) to authenticated;

create or replace function public.remove_account(p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pr record; dup uuid; act jsonb;
begin
  if not public.is_admin() then raise exception 'only a system admin can remove an account' using errcode = '42501'; end if;
  select * into pr from profiles where id = p_user for update;
  if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
  if coalesce(pr.is_owner, false) or coalesce(pr.is_admin, false) then raise exception 'an admin account cannot be removed' using errcode = '42501'; end if;
  if pr.account_status in ('merged', 'removed') then raise exception 'this account is already %', pr.account_status using errcode = '55000'; end if;
  dup := public.find_duplicate_member(p_user);
  if dup is not null then
    raise exception 'this looks like a second account for % — duplicates are always merged into the member''s main account, even an empty one', (select display_name from profiles where id = dup) using errcode = '55000';
  end if;
  act := public.account_activity(p_user);
  if jsonb_array_length(act) > 0 then
    raise exception 'this account has history (%) — removing it would erase that and could change other members'' balances. Suspend it instead.',
      (select string_agg((x->>'rows') || ' ' || replace(x->>'table', '_', ' '), ', ') from jsonb_array_elements(act) x) using errcode = '55000';
  end if;
  update profiles set account_status = 'removed', banned = true, status_at = now(), status_by = auth.uid(),
         status_reason = coalesce(nullif(trim(p_reason), ''), 'Removed'), pending_kind = null, pending_group = null where id = p_user;
  delete from group_members where user_id = p_user;
  if pr.email is not null then insert into banned_emails(email, reason) values (lower(pr.email), coalesce(nullif(trim(p_reason), ''), 'removed')) on conflict (email) do nothing; end if;
  perform public.end_user_sessions(p_user);
  insert into activity_log(actor_id, action, target_user_id, summary) values (auth.uid(), 'account_removed', p_user, 'Removed ' || coalesce(pr.display_name, pr.email));
end $$;
revoke all on function public.remove_account(uuid, text) from public, anon;
grant execute on function public.remove_account(uuid, text) to authenticated;

-- ---------------------------------------------------------------- retire the old merge and wipe
create or replace function public.admin_merge_users(p_keep uuid, p_remove uuid)
returns void language plpgsql security definer set search_path = public as $$
begin raise exception 'replaced by merge_accounts (208.0) — the old merge missed most account references' using errcode = '0A000'; end $$;
create or replace function public.admin_wipe_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin raise exception 'replaced by remove_account / merge_accounts (208.0)' using errcode = '0A000'; end $$;

-- ---------------------------------------------------------------- the admin list, with status
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (
  id uuid, display_name text, email text, is_admin boolean, is_owner boolean, banned boolean,
  handicap_index numeric, group_count int, rounds_count int,
  account_status text, status_reason text, status_at timestamptz, status_by_name text, merged_into_name text, merged_into_email text,
  pending_kind text, last_active timestamptz
)
language sql security definer set search_path = public as $$
  select p.id, p.display_name, p.email, p.is_admin, coalesce(p.is_owner, false), coalesce(p.banned, false),
         p.handicap_index,
         (select count(*) from group_members gm where gm.user_id = p.id and gm.status = 'active')::int,
         (select count(*) from rounds r where r.user_id = p.id and r.deleted_at is null and coalesce(r.status, 'final') <> 'in_progress')::int,
         p.account_status, p.status_reason, p.status_at, sb.display_name, mi.display_name, public.mask_email(mi.email),
         p.pending_kind, p.last_active
  from profiles p left join profiles sb on sb.id = p.status_by left join profiles mi on mi.id = p.merged_into
  where public.is_admin()
  order by coalesce(p.is_owner, false) desc, coalesce(p.is_admin, false) desc, p.display_name nulls last;
$$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

select public.record_migration('0190_account_merge_remove');

commit;
