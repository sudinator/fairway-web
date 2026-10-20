-- 210.10: every notification link the database sends — and every one already stored — is a link the app
-- understands. The tab list MUST equal lib/app-links.ts APP_TABS (ci/check_app_tabs_sync.py keeps them equal).
do $$
declare app_tabs text[] := array['dashboard','rounds','games','courses','players','groups','admin','help','profile','money','teetimes','notifications'];
        r record; bad text := '';
begin
  -- links written by the database's current functions
  for r in select p.proname, m[1] as tab from pg_proc p, regexp_matches(p.prosrc, '/\?tab=([a-z_]+)', 'g') m
            where p.pronamespace = 'public'::regnamespace loop
    if not (r.tab = any(app_tabs)) then bad := bad || format(' %s→tab=%s;', r.proname, r.tab); end if;
  end loop;
  -- links already stored on notifications
  for r in select distinct m[1] as tab from notifications n, regexp_matches(coalesce(n.link, ''), '[?&]tab=([a-z_]+)') m loop
    if not (r.tab = any(app_tabs)) then bad := bad || format(' stored notification→tab=%s;', r.tab); end if;
  end loop;
  if bad is distinct from '' then raise exception 'notification links the app does not understand:%', bad; end if;
  raise notice 'NOTIFICATION_LINKS_PASS every link the database sends (and every stored one) opens a screen the app knows';
end $$;
