-- 0190 (208.0): merge-then-remove, suspend/restore, empty-only remove, and the registry covering the schema.
do $$
declare sys uuid := '19000000-0000-0000-0000-000000000001';
        keep uuid := '19000000-0000-0000-0000-000000000002';   -- Raj Patel (main)
        dupl uuid := '19000000-0000-0000-0000-000000000003';   -- Raj Patel (second Google account)
        other uuid := '19000000-0000-0000-0000-000000000004';  -- Sam Other
        empty uuid := '19000000-0000-0000-0000-000000000005';  -- Test Golfer (no activity)
        g uuid := '19000000-0000-0000-0000-000000000011'; ev uuid := '19000000-0000-0000-0000-000000000021';
        gm uuid := '19000000-0000-0000-0000-000000000031';
        e1 uuid := '19000000-0000-0000-0000-000000000041'; e2 uuid := '19000000-0000-0000-0000-000000000042';
        net_before_keep bigint; net_before_other bigint; pv jsonb; ok boolean; r jsonb; t text;
begin
  -- clean
  delete from settlements where group_id = g; delete from expense_shares where expense_id in (e1, e2); delete from expense_payers where expense_id in (e1, e2);
  delete from expenses where group_id = g; delete from group_events where group_id = g;
  delete from game_players where game_id = gm; delete from games where id = gm; delete from rounds where user_id in (keep, dupl);
  delete from member_badges where user_id in (keep, dupl); delete from group_members where group_id = g; delete from groups where id = g;
  delete from activity_log where target_user_id in (keep, dupl, other, empty); delete from banned_emails where email like '%@merge190.test';
  delete from profiles where id in (sys, keep, dupl, other, empty); delete from auth.users where id in (sys, keep, dupl, other, empty);
  raise notice 'MERGE_STEP 1: fixtures';
  -- fixtures
  insert into auth.users(id, email) values (sys,'sys@merge190.test'),(keep,'raj@merge190.test'),(dupl,'raj.work@merge190.test'),(other,'sam@merge190.test'),(empty,'test@merge190.test');
  insert into profiles(id, display_name, email, is_admin, account_status, handicap_index) values
    (sys,'Sys Admin','sys@merge190.test',true,'active',null),(keep,'Raj Patel','raj@merge190.test',false,'active',null),
    (dupl,'Raj Patel','raj.work@merge190.test',false,'active',14.2),(other,'Sam Other','sam@merge190.test',false,'active',null),(empty,'Test Golfer','test@merge190.test',false,'active',null);
  insert into groups(id, name, status) values (g, 'Merge Club 190', 'active');
  insert into group_members(group_id, user_id, email, role, status) values (g,keep,'raj@merge190.test','member','active'),(g,dupl,'raj.work@merge190.test','admin','active'),(g,other,'sam@merge190.test','member','active');
  insert into group_events(id, group_id, name) values (ev, g, 'Saturday');
  -- money on the duplicate: he paid $90 split three ways; Sam paid $40 split with him
  insert into expenses(id, group_id, payer_user_id, amount_cents, created_by) values (e1, g, dupl, 9000, dupl), (e2, g, other, 4000, other);
  insert into expense_payers(expense_id, user_id, paid_cents) values (e1, dupl, 9000), (e2, other, 4000);
  insert into expense_shares(expense_id, user_id, share_cents) values (e1, keep, 3000), (e1, dupl, 3000), (e1, other, 3000), (e2, dupl, 2000), (e2, other, 2000);
  insert into settlements(group_id, event_id, from_user_id, to_user_id, amount_cents, status) values (g, ev, other, dupl, 1000, 'confirmed');
  -- golf on the duplicate, in pairings
  insert into games(id, code, name, course, holes_meta, created_by, pairings, foursomes) values (gm, 'MRG190', 'Merge', 'C', '[]', dupl,
     jsonb_build_array(jsonb_build_object('a', dupl::text, 'b', other::text)), jsonb_build_array(jsonb_build_object('id','f1','a', jsonb_build_array(dupl::text),'b', jsonb_build_array(other::text))));
  insert into game_players(game_id, user_id, display_name) values (gm, dupl, 'Raj Patel'), (gm, other, 'Sam Other');
  insert into rounds(user_id, game_id, course, played_at) values (dupl, gm, 'C', '2026-10-01');
  insert into member_badges(user_id, badge_key) values (keep, 'first_birdie'), (dupl, 'first_birdie'), (dupl, 'hot_streak');

  raise notice 'MERGE_STEP 2: preview refuses a double charge';
  -- e1 has shares for BOTH accounts → the preview must refuse (would double-charge Raj)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', sys::text, true);
  pv := public.account_merge_preview(keep, dupl);
  if (pv->>'ok')::boolean or (pv->'blockers')::text not like '%same expense%' then raise exception 'double-charge collision not refused: %', pv; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
  begin perform public.merge_accounts_as(sys, keep, dupl, 'Duplicate'); ok := false; exception when others then ok := true; end;
  execute 'reset role';
  if not ok then raise exception 'merge ran despite a blocker'; end if;
  raise notice 'MERGE_STEP 3: preview refuses a self-settlement';
  -- resolve it (the admin removes the duplicate share), and add a settlement BETWEEN the two → refused
  delete from expense_shares where expense_id = e1 and user_id = keep;
  insert into settlements(group_id, event_id, from_user_id, to_user_id, amount_cents, status) values (g, ev, keep, dupl, 500, 'pending');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', sys::text, true);
  pv := public.account_merge_preview(keep, dupl);
  if (pv->>'ok')::boolean or (pv->'blockers')::text not like '%payment to himself%' then raise exception 'self-settlement not refused: %', pv; end if;
  execute 'reset role';
  delete from settlements where from_user_id = keep and to_user_id = dupl;

  raise notice 'MERGE_STEP 4: balances before';
  -- balances before (paid − owed + received − sent), per person
  select coalesce((select sum(paid_cents) from expense_payers where user_id in (keep, dupl)), 0) - coalesce((select sum(share_cents) from expense_shares where user_id in (keep, dupl)), 0)
       + coalesce((select sum(amount_cents) from settlements where to_user_id in (keep, dupl)), 0) - coalesce((select sum(amount_cents) from settlements where from_user_id in (keep, dupl)), 0) into net_before_keep;
  select coalesce((select sum(paid_cents) from expense_payers where user_id = other), 0) - coalesce((select sum(share_cents) from expense_shares where user_id = other), 0)
       + coalesce((select sum(amount_cents) from settlements where to_user_id = other), 0) - coalesce((select sum(amount_cents) from settlements where from_user_id = other), 0) into net_before_other;

  raise notice 'MERGE_STEP 5: remove refusals';
  -- Remove refuses: a duplicate goes to merge; an account with history goes to suspend
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', sys::text, true);
  begin perform public.remove_account(dupl, 'x'); ok := false; exception when others then ok := sqlerrm like '%merged into the member%'; end;
  if not ok then raise exception 'remove did not send a duplicate to merge'; end if;
  begin perform public.remove_account(other, 'x'); ok := false; exception when others then ok := sqlerrm like '%Suspend it instead%'; end;
  if not ok then raise exception 'remove did not refuse an account with history'; end if;
  perform public.remove_account(empty, 'Test account');
  raise notice 'MERGE_STEP 6: merge refused from the app';
  -- a merge can't be run from a phone — even by a system admin — and says so
  -- refused twice over: app users may not call it at all (permission denied); and it checks the session anyway
  -- App users must not be able to run a merge. CHECKED, not attempted: on Supabase's PostgreSQL 17.6 images up to
  -- 17.6.1.111, calling a function an app role lacks EXECUTE on crashes the server (supautils bug —
  -- supabase/postgres#2112, #2366; fixed in 17.6.1.121). The function also checks the session itself.
  if has_function_privilege('authenticated', 'public.merge_accounts_as(uuid,uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.merge_accounts_as(uuid,uuid,uuid,text)', 'execute') then
    raise exception 'merge callable from the app';
  end if;
  execute 'reset role';
  raise notice 'MERGE_STEP 7: merge as the server';
  -- the server runs it (no end-user identity), on behalf of a system admin — and refuses a non-admin actor
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
  begin perform public.merge_accounts_as(other, keep, dupl, 'x'); ok := false; exception when others then ok := sqlerrm like '%system admin%'; end;
  if not ok then raise exception 'merge on behalf of a non-admin not refused'; end if;
  raise notice 'MERGE_STEP 7b: merge_accounts_as starting';
  r := public.merge_accounts_as(sys, keep, dupl, 'Duplicate of Raj Patel');
  raise notice 'MERGE_STEP 7c: merge_accounts_as returned';
  execute 'reset role';
  raise notice 'MERGE_STEP 8: suspend / restore';
  -- suspend / restore round trip on Sam
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', sys::text, true);
  perform public.set_account_suspended(other, true, 'Left the club');
  perform public.set_account_suspended(other, false);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);

  raise notice 'MERGE_STEP 9: verify nothing left on the duplicate';
  -- everything moved; nothing left on the duplicate
  for t in select format('%s.%s', table_name, column_name) from account_reference_columns where rule in ('move', 'move_or_refuse', 'move_dedupe', 'delete_duplicate') and to_regclass('public.' || table_name) is not null loop
    execute format('select 1 from public.%I where %I = $1 limit 1', split_part(t, '.', 1), split_part(t, '.', 2)) into ok using dupl;
    if ok and t not in ('activity_log.actor_id', 'profiles.status_by') then raise exception 'left on the duplicate: %', t; end if;
    ok := null;
  end loop;
  if (select pairings::text from games where id = gm) like '%' || dupl || '%' or (select foursomes::text from games where id = gm) not like '%' || keep || '%' then raise exception 'pairings / foursomes not rewritten'; end if;
  if (select count(*) from group_members where group_id = g and user_id = keep) <> 1 or (select role from group_members where group_id = g and user_id = keep) <> 'admin' then raise exception 'membership not deduped with admin role carried over'; end if;
  if (select count(*) from member_badges where user_id = keep) <> 2 then raise exception 'badges not deduped (expected first_birdie once + hot_streak)'; end if;
  -- balances unchanged: Raj's two accounts' net is now his one account's net; Sam's is untouched
  if (coalesce((select sum(paid_cents) from expense_payers where user_id = keep), 0) - coalesce((select sum(share_cents) from expense_shares where user_id = keep), 0)
       + coalesce((select sum(amount_cents) from settlements where to_user_id = keep), 0) - coalesce((select sum(amount_cents) from settlements where from_user_id = keep), 0)) <> net_before_keep then raise exception 'Raj''s balance changed in the merge'; end if;
  if (coalesce((select sum(paid_cents) from expense_payers where user_id = other), 0) - coalesce((select sum(share_cents) from expense_shares where user_id = other), 0)
       + coalesce((select sum(amount_cents) from settlements where to_user_id = other), 0) - coalesce((select sum(amount_cents) from settlements where from_user_id = other), 0)) <> net_before_other then raise exception 'another member''s balance changed in the merge'; end if;
  if (select account_status || '/' || merged_into from profiles where id = dupl) <> 'merged/' || keep or not exists (select 1 from banned_emails where email = 'raj.work@merge190.test') then raise exception 'duplicate not marked merged + blocked'; end if;
  if (select handicap_index from profiles where id = keep) <> 14.2 then raise exception 'kept profile did not fill its blank handicap'; end if;
  if (select account_status from profiles where id = empty) <> 'removed' then raise exception 'empty account not removed'; end if;
  if (select account_status || '/' || coalesce(banned, false)::text from profiles where id = other) <> 'active/false' then raise exception 'suspend/restore round trip failed'; end if;
  raise notice 'MERGE_STEP 10: old merge retired';
  -- the old merge and wipe refuse
  begin perform public.admin_merge_users(keep, dupl); ok := false; exception when others then ok := sqlerrm like '%replaced by merge_accounts%'; end;
  if not ok then raise exception 'old merge still callable'; end if;

  -- clean
  delete from settlements where group_id = g; delete from expense_shares where expense_id in (e1, e2); delete from expense_payers where expense_id in (e1, e2);
  delete from expenses where group_id = g; delete from group_events where group_id = g;
  delete from game_players where game_id = gm; delete from rounds where game_id = gm; delete from games where id = gm;
  delete from member_badges where user_id in (keep, dupl); delete from group_members where group_id = g; delete from groups where id = g;
  delete from activity_log where target_user_id in (keep, dupl, other, empty) or actor_id = sys; delete from banned_emails where email like '%@merge190.test';
  delete from profiles where id in (sys, keep, dupl, other, empty); delete from auth.users where id in (sys, keep, dupl, other, empty);
  raise notice 'ACCOUNT_MERGE_PASS double-charge + self-settlement refused; merge moves every registry reference incl. pairings/foursomes; balances unchanged; dedupe + admin role; remove refuses duplicates and history; suspend/restore; old merge retired';
end $$;

-- The registry covers every account-like column in the schema, and lists nothing that no longer exists.
do $$
declare bad text;
begin
  select string_agg(kind || ' ' || t || '.' || col, ', ') into bad from (
    select 'UNCLASSIFIED' kind, t, col from (
      select (c.conrelid::regclass)::text t, a.attname::text col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
       where c.contype = 'f' and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass) and c.connamespace = 'public'::regnamespace
      union
      select table_name, column_name from information_schema.columns where table_schema = 'public' and data_type in ('uuid', 'text', 'character varying')
         and column_name ~ '(user|_by$|actor|sponsor|recipient|sender|captain|owner|member_id|player_id|scorer|marker|subject|controller|merged_into|duplicate_of)'
      union select 'games', unnest(array['pairings', 'foursomes', 'structure_stash'])
    ) cand where not exists (select 1 from account_reference_columns r where r.table_name = cand.t and r.column_name = cand.col)
    union all
    select 'STALE', table_name, column_name from account_reference_columns r
     where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = r.table_name and c.column_name = r.column_name)
  ) x;
  if bad is not null then
    raise exception 'account_reference_columns is out of date: %. Every column that refers to an account must be classified, so a merge never misses it (208.0).', bad;
  end if;
  raise notice 'ACCOUNT_REGISTRY_PASS every account-like column is classified';
end $$;
