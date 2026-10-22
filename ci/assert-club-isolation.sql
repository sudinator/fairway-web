-- 211.5 — CROSS-CLUB ISOLATION (owner, Oct 21 2026). A member of Club B tries to READ, CHANGE, DELETE and ADD TO
-- Club A's data in every club-scoped table; a SUSPENDED member of Club A tries to change their own club's data.
-- Every attempt must find nothing or be refused. Courses are shared by design (owner) and so are not club-scoped.
begin;
do $$
declare a uuid := '21150000-0000-0000-0000-0000000000a1'; a2 uuid := '21150000-0000-0000-0000-0000000000a2'; s uuid := '21150000-0000-0000-0000-0000000000a3';
        b uuid := '21150000-0000-0000-0000-0000000000b1';
        ga uuid := '21150000-0000-0000-0000-0000000000c1'; gb uuid := '21150000-0000-0000-0000-0000000000c2';
        gm uuid := '21150000-0000-0000-0000-0000000000d1'; rd uuid := '21150000-0000-0000-0000-0000000000d2';
        ex uuid := '21150000-0000-0000-0000-0000000000e1'; ev uuid := '21150000-0000-0000-0000-0000000000e2'; st uuid := '21150000-0000-0000-0000-0000000000e3';
        tt uuid := '21150000-0000-0000-0000-0000000000f1'; cp uuid := '21150000-0000-0000-0000-0000000000f2';
        t record; n int; ok boolean; failures text := '';
begin
  insert into auth.users(id, email) values (a, 'a@iso.test'), (a2, 'a2@iso.test'), (s, 's@iso.test'), (b, 'b@iso.test');
  insert into profiles(id, display_name, email, account_status) values (a, 'A Admin', 'a@iso.test', 'active'), (a2, 'A Member', 'a2@iso.test', 'active'), (s, 'A Suspended', 's@iso.test', 'suspended'), (b, 'B Member', 'b@iso.test', 'active');
  insert into groups(id, name, status, created_by) values (ga, 'Club A', 'active', a), (gb, 'Club B', 'active', b);
  insert into group_members(group_id, user_id, email, role, status) values (ga, a, 'a@iso.test', 'admin', 'active'), (ga, a2, 'a2@iso.test', 'member', 'active'), (ga, s, 's@iso.test', 'member', 'active'), (gb, b, 'b@iso.test', 'admin', 'active');
  -- Club A's data, in every club-scoped table
  insert into games(id, code, name, course, holes_meta, group_id, status, created_by) values (gm, '211511', 'A game', 'C', '[]', ga, 'active', a);
  insert into game_players(game_id, user_id, display_name) values (gm, a, 'A Admin'), (gm, a2, 'A Member');
  insert into game_players(game_id, user_id, display_name, is_guest) values (gm, null, 'A Guest', true);
  insert into rounds(id, user_id, course, played_at, status, group_id) values (rd, a, 'C', current_date, 'final', ga);
  insert into holes(round_id, hole_number, par, strokes) values (rd, 1, 4, 4);
  insert into group_events(id, group_id, name) values (ev, ga, 'A event');
  insert into expenses(id, group_id, payer_user_id, amount_cents, created_by) values (ex, ga, a, 1000, a);
  insert into expense_shares(expense_id, share_cents, user_id) values (ex, 500, a2);
  insert into expense_payers(expense_id, paid_cents, user_id) values (ex, 1000, a);
  insert into settlements(id, group_id, from_user_id, to_user_id, amount_cents, event_id) values (st, ga, a2, a, 500, ev);
  insert into settlement_allocations(settlement_id, group_id, amount_cents, expense_id) values (st, ga, 500, ex);
  insert into money_audit(group_id, expense_id, action) values (ga, ex, 'created');
  insert into group_activity(group_id, action, summary) values (ga, 'x', 'A activity');
  insert into group_guests(group_id, name) values (ga, 'A club guest');
  insert into tee_times(id, group_id, play_date, created_by) values (tt, ga, current_date + 7, a);
  insert into tee_time_rsvps(tee_time_id, user_id, choice) values (tt, a2, 'in');
  insert into group_invites(group_id, invite_code, created_by) values (ga, 'ISO2115A', a);
  insert into competitions(id, group_id, name, start_date, created_by) values (cp, ga, 'A cup', current_date, a);
  insert into competition_sessions(competition_id, name, format, session_order, play_date) values (cp, 'S1', 'match', 1, current_date);
  insert into competition_players(competition_id, user_id, team_key, display_name) values (cp, a2, 'A', 'A Member');
  insert into club_reports(group_id, period_key, period_label, period_from, period_to, snapshot, published_at) values (ga, 'iso', 'Iso', current_date, current_date, '{}', now());
  insert into notifications(user_id, message) values (a, 'for A only');
  insert into nudges(sender_id, recipient_id) values (a, a2);

  -- POSITIVE CONTROLS — the same statements as Club A's admin must WORK, or the refusals above prove nothing
  perform set_config('request.jwt.claim.sub', a::text, true);
  for t in select * from (values
      ('groups', 'id = $1', 'name = name'), ('group_members', 'group_id = $1', 'role = role'), ('games', 'group_id = $1', 'name = name'),
      ('game_players', 'game_id = $2', 'display_name = display_name'), ('rounds', 'id = $3', 'course = course'), ('holes', 'round_id = $3', 'par = par'),
      ('group_events', 'group_id = $1', 'name = name'), ('expenses', 'group_id = $1', 'amount_cents = amount_cents'),
      ('expense_shares', 'expense_id = $4', 'share_cents = share_cents'), ('expense_payers', 'expense_id = $4', 'paid_cents = paid_cents'),
      ('settlements', 'group_id = $1', 'amount_cents = amount_cents'), ('settlement_allocations', 'group_id = $1', 'amount_cents = amount_cents'),
      ('money_audit', 'group_id = $1', 'action = action'), ('group_activity', 'group_id = $1', 'summary = summary'), ('group_guests', 'group_id = $1', 'name = name'),
      ('tee_times', 'group_id = $1', 'play_date = play_date'), ('tee_time_rsvps', 'tee_time_id = $5', 'choice = choice'), ('group_invites', 'group_id = $1', 'invite_code = invite_code'),
      ('competitions', 'group_id = $1', 'name = name'), ('competition_sessions', 'competition_id = $6', 'name = name'), ('competition_players', 'competition_id = $6', 'display_name = display_name'),
      ('club_reports', 'group_id = $1', 'period_label = period_label'), ('notifications', 'user_id = $7', 'message = message'), ('nudges', 'sender_id = $7', 'recipient_id = recipient_id')
    ) as x(tbl, cond, setc) loop
    if t.tbl in ('notifications') then continue; end if;   -- A's own notification: checked below as A
    execute format('select count(*) from public.%I where %s', t.tbl, t.cond) into n using ga, gm, rd, ex, tt, cp, a;
    if n = 0 then failures := failures || format(' CONTROL-READ %s (Club A''s admin sees nothing — the check is wrong);', t.tbl); end if;
    begin execute format('select 1 from public.%I where %s limit 0', t.tbl, t.cond) using ga, gm, rd, ex, tt, cp, a;
    exception when others then failures := failures || format(' CONTROL-SQL %s: %s;', t.tbl, sqlerrm); end;
    begin execute format('explain update public.%I set %s where %s', t.tbl, t.setc, t.cond) using ga, gm, rd, ex, tt, cp, a;
    exception when others then failures := failures || format(' CONTROL-UPDATE-SQL %s: %s;', t.tbl, sqlerrm); end;
  end loop;
  for t in select * from (values
      ('group_members', $q$insert into public.group_members(group_id, user_id, email, role, status) values ($1, $2, 'b@iso.test', 'admin', 'active')$q$),
      ('expenses', $q$insert into public.expenses(group_id, payer_user_id, amount_cents, created_by) values ($1, $2, 1, $2)$q$),
      ('group_events', $q$insert into public.group_events(group_id, name, created_by) values ($1, 'B was here', $2)$q$),
      ('group_guests', $q$insert into public.group_guests(group_id, name, created_by, sponsor_user_id) values ($1, 'B guest', $2, $2)$q$),
      ('tee_times', $q$insert into public.tee_times(group_id, play_date, created_by) values ($1, current_date + 8, $2)$q$),
      ('group_invites', $q$insert into public.group_invites(group_id, invite_code, created_by) values ($1, 'ISO2115B', $2)$q$),
      ('competitions', $q$insert into public.competitions(group_id, name, start_date, created_by) values ($1, 'B cup', current_date, $2)$q$),
      ('games', $q$insert into public.games(code, name, course, holes_meta, group_id, created_by) values ('211599', 'B game', 'C', '[]', $1, $2)$q$)
    ) as x(tbl, ins) loop
    begin execute 'explain ' || t.ins using ga, a; exception when others then failures := failures || format(' CONTROL-ADD-SQL %s: %s;', t.tbl, sqlerrm); end;
  end loop;

  -- the Club B member, against every Club A table: read nothing, change nothing, delete nothing
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', b::text, true);
  for t in select * from (values
      ('groups', 'id = $1', 'name = name'), ('group_members', 'group_id = $1', 'role = role'), ('games', 'group_id = $1', 'name = name'),
      ('game_players', 'game_id = $2', 'display_name = display_name'), ('rounds', 'id = $3', 'course = course'), ('holes', 'round_id = $3', 'par = par'),
      ('group_events', 'group_id = $1', 'name = name'), ('expenses', 'group_id = $1', 'amount_cents = amount_cents'),
      ('expense_shares', 'expense_id = $4', 'share_cents = share_cents'), ('expense_payers', 'expense_id = $4', 'paid_cents = paid_cents'),
      ('settlements', 'group_id = $1', 'amount_cents = amount_cents'), ('settlement_allocations', 'group_id = $1', 'amount_cents = amount_cents'),
      ('money_audit', 'group_id = $1', 'action = action'), ('group_activity', 'group_id = $1', 'summary = summary'), ('group_guests', 'group_id = $1', 'name = name'),
      ('tee_times', 'group_id = $1', 'play_date = play_date'), ('tee_time_rsvps', 'tee_time_id = $5', 'choice = choice'), ('group_invites', 'group_id = $1', 'invite_code = invite_code'),
      ('competitions', 'group_id = $1', 'name = name'), ('competition_sessions', 'competition_id = $6', 'name = name'), ('competition_players', 'competition_id = $6', 'display_name = display_name'),
      ('club_reports', 'group_id = $1', 'period_label = period_label'), ('notifications', 'user_id = $7', 'message = message'), ('nudges', 'sender_id = $7', 'recipient_id = recipient_id')
    ) as x(tbl, cond, setc) loop
    begin execute format('select count(*) from public.%I where %s', t.tbl, t.cond) into n using ga, gm, rd, ex, tt, cp, a;
      if n <> 0 then failures := failures || format(' READ %s (%s rows);', t.tbl, n); end if; exception when insufficient_privilege then null; end;
    begin execute format('update public.%I set %s where %s', t.tbl, t.setc, t.cond) using ga, gm, rd, ex, tt, cp, a; get diagnostics n = row_count;
      if n <> 0 then failures := failures || format(' CHANGE %s (%s rows);', t.tbl, n); end if; exception when others then null; end;
    begin execute format('delete from public.%I where %s', t.tbl, t.cond) using ga, gm, rd, ex, tt, cp, a; get diagnostics n = row_count;
      if n <> 0 then failures := failures || format(' DELETE %s (%s rows);', t.tbl, n); end if; exception when others then null; end;
  end loop;
  -- …and can't ADD to Club A
  for t in select * from (values
      ('group_members', $q$insert into public.group_members(group_id, user_id, email, role, status) values ($1, $2, 'b@iso.test', 'admin', 'active')$q$),
      ('expenses', $q$insert into public.expenses(group_id, payer_user_id, amount_cents, created_by) values ($1, $2, 1, $2)$q$),
      ('group_events', $q$insert into public.group_events(group_id, name, created_by) values ($1, 'B was here', $2)$q$),
      ('group_guests', $q$insert into public.group_guests(group_id, name, created_by, sponsor_user_id) values ($1, 'B guest', $2, $2)$q$),
      ('tee_times', $q$insert into public.tee_times(group_id, play_date, created_by) values ($1, current_date + 8, $2)$q$),
      ('group_invites', $q$insert into public.group_invites(group_id, invite_code, created_by) values ($1, 'ISO2115B', $2)$q$),
      ('competitions', $q$insert into public.competitions(group_id, name, start_date, created_by) values ($1, 'B cup', current_date, $2)$q$),
      ('games', $q$insert into public.games(code, name, course, holes_meta, group_id, created_by) values ('211599', 'B game', 'C', '[]', $1, $2)$q$)
    ) as x(tbl, ins) loop
    begin execute t.ins using ga, b; failures := failures || format(' ADD %s;', t.tbl); exception when others then null; end;
  end loop;

  -- a SUSPENDED member of Club A can't change their own club's data
  perform set_config('request.jwt.claim.sub', s::text, true);
  for t in select * from (values
      ('expenses', $q$insert into public.expenses(group_id, payer_user_id, amount_cents, created_by) values ($1, $2, 1, $2)$q$),
      ('group_guests', $q$insert into public.group_guests(group_id, name, created_by, sponsor_user_id) values ($1, 'S guest', $2, $2)$q$),
      ('tee_time_rsvps', $q$insert into public.tee_time_rsvps(tee_time_id, user_id, choice) values ($3, $2, 'in')$q$),
      ('group_events', $q$insert into public.group_events(group_id, name, created_by) values ($1, 'S event', $2)$q$)
    ) as x(tbl, ins) loop
    begin execute t.ins using ga, s, tt; failures := failures || format(' SUSPENDED-ADD %s;', t.tbl);
    exception when others then if sqlerrm is null or sqlerrm not like '%can''t make changes%' then failures := failures || format(' SUSPENDED %s refused for another reason: %s;', t.tbl, sqlerrm); end if; end;
  end loop;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if failures is distinct from '' then raise exception 'CLUB ISOLATION FAILED:%', failures; end if;
  raise notice 'CLUB_ISOLATION_PASS a Club B member reads, changes, deletes and adds nothing in Club A across 24 tables; a suspended Club A member changes nothing';
end $$;
rollback;
