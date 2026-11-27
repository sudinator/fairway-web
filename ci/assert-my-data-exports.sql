-- assert-my-data-exports.sql — 0241 (212.133): the "Email me my data" ledger. A member reads only their own rows; no
-- member can insert, update or delete (the server writes); the once-a-day function answers for the caller's own rows
-- and counts only successful sends; anon has nothing.
begin;
insert into auth.users(id, email) values ('24100000-0000-0000-0000-0000000000a1', 'a@w.test'), ('24100000-0000-0000-0000-0000000000a2', 'b@w.test');
insert into public.profiles(id, display_name, account_status, email) values ('24100000-0000-0000-0000-0000000000a1', 'A', 'active', 'a@w.test'), ('24100000-0000-0000-0000-0000000000a2', 'B', 'active', 'b@w.test');
insert into public.my_data_exports(user_id, requested_at, sent_to, status) values
  ('24100000-0000-0000-0000-0000000000a1', now() - interval '2 hours', 'a@w.test', 'sent'),
  ('24100000-0000-0000-0000-0000000000a1', now() - interval '1 hour', 'a@w.test', 'failed'),
  ('24100000-0000-0000-0000-0000000000a2', now() - interval '3 days', 'b@w.test', 'sent'),
  ('24100000-0000-0000-0000-0000000000a2', now() - interval '5 minutes', 'b@w.test', 'failed');
-- 0241: the merge registry knows the ledger (a merged-away account's rows move with it)
do $$ begin if not exists (select 1 from public.account_reference_columns where table_name = 'my_data_exports' and column_name = 'user_id' and rule = 'move') then raise exception 'my_data_exports.user_id must be registered for account merges'; end if; end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24100000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare n int; nxt timestamptz; denied boolean := false;
begin
  select count(*) into n from public.my_data_exports;
  if n is distinct from 2 then raise exception 'a member should see only their own rows (got %)', n; end if;
  nxt := public.my_data_export_next_allowed('24100000-0000-0000-0000-0000000000a1');
  if nxt is null or nxt < now() + interval '21 hours' or nxt > now() + interval '23 hours' then raise exception 'next allowed should be ~22h from now (the send holds the day; the later failed attempt holds only 15 minutes), got %', nxt; end if;
  nxt := public.my_data_export_next_allowed('24100000-0000-0000-0000-0000000000a2');
  if nxt is null or nxt > now() then raise exception 'another member''s id answers the default (their rows are invisible), not their real time — got %', nxt; end if;
  begin insert into public.my_data_exports(user_id, sent_to, status) values ('24100000-0000-0000-0000-0000000000a1', 'x@w.test', 'sent'); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a member must not insert a ledger row'; end if;
  denied := false;
  begin update public.my_data_exports set status = 'failed' where user_id = '24100000-0000-0000-0000-0000000000a1'; get diagnostics n = row_count; if n > 0 then raise exception 'updated'; end if; exception when insufficient_privilege then denied := true; when others then if sqlerrm = 'updated' then raise; end if; denied := true; end;
  if not denied then raise exception 'a member must not update a ledger row'; end if;
  denied := false;
  begin delete from public.my_data_exports where user_id = '24100000-0000-0000-0000-0000000000a1'; get diagnostics n = row_count; if n > 0 then raise exception 'deleted'; end if; exception when insufficient_privilege then denied := true; when others then if sqlerrm = 'deleted' then raise; end if; denied := true; end;
  if not denied then raise exception 'a member must not delete a ledger row'; end if;
end $$;
reset role;
-- member B: a failed attempt 5 minutes ago holds 15 minutes
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24100000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
do $$ declare nxt timestamptz; begin
  nxt := public.my_data_export_next_allowed('24100000-0000-0000-0000-0000000000a2');
  if nxt is null or nxt < now() + interval '9 minutes' or nxt > now() + interval '11 minutes' then raise exception 'a failed attempt 5 minutes ago holds 15 minutes, got %', nxt; end if;
end $$;
reset role;
set local role anon;
do $$
declare denied boolean := false; n int;
begin
  begin select count(*) into n from public.my_data_exports; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'anon must not read the ledger'; end if;
  denied := false;
  begin perform public.my_data_export_next_allowed('24100000-0000-0000-0000-0000000000a1'); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'anon must not call the once-a-day function'; end if;
end $$;
reset role;
rollback;
