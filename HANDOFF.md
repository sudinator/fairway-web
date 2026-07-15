# Birdie Num Num (BNN) — Developer Handoff

**Read this first.** It's the onboarding brief for continuing BNN development in a fresh chat with no
prior context. The uploaded `.zip` is the complete source at the current version. When in doubt about
how anything works, **open the file and read it** — never answer from assumption.

---

## 0. The one rule that overrides everything
**Verify every claim about app behavior from the actual code before stating it or acting on it.** Do not
describe what the app does from memory or inference. Open the file, read it, then respond. This is the
single most important habit — it has caught countless bugs.

## 1. What BNN is + your role
- **Birdie Num Num**: a golf-scoring Progressive Web App for a golf group — scorecards, games/tournaments,
  handicaps (WHS-style), betting/money settle-up, tee-time scheduling, badges, and admin analytics.
- **Owner: Amit Sud (non-technical).** You (Claude) are the **sole developer**. You write the code, ship
  it, and give Amit clear copy-paste steps. He can't debug — precision and clear instructions matter.
- Amit also uses these chats for sophisticated **investment research**; for factual/investment questions
  he wants **sourced** answers (SEC filings + management commentary prioritized). Separate from BNN, but
  it may come up in the same chat.

## 2. Stack + infrastructure
- **Next.js 14** (App Router) + React + TypeScript.
- **Supabase** (Postgres + Auth + Row-Level Security). Project ref `epmbsmykyrnoiccwnoxq`. **FREE tier** —
  mind quotas.
- **Vercel** hosting. Repo: `sudinator/fairway-web`. Live: `birdienumnum.vercel.app`.
- **PWA** (installable; service worker at `public/sw.js`, version-stamped).
- Sister app "Fairway Card" (separate repo, `fairway-web-eosin.vercel.app`) is occasionally referenced —
  not this project.

## 3. Deploy flow (Amit does this by hand)
1. You produce a cumulative `.zip`.
2. Amit unzips to `C:\dev\fairway-web`.
3. GitHub Desktop commit + push.
4. Vercel auto-deploys.
5. Amit runs any new migration **manually** in the Supabase SQL editor (he pastes the SQL you printed inline).

Because Amit is non-technical: **always print migration SQL inline for copy-paste**, and give plain,
numbered instructions.

## 4. Pre-ship pipeline — run EVERY release, in order
(Work tree at repo root. A placeholder `.env.local` is required for the build to run — create dummy
values, never real secrets.)

1. **Type-check:** `npx tsc --noEmit` → must be **rc 0**. (A piped `grep` can hide the real return code —
   check it. If generated types seem stale, `rm -rf .next` and retry.)
2. **Bump version** in `package.json`. New feature = **MINOR**; refinement/bugfix = **PATCH**.
3. **Unit tests:** `npm test` → all must pass. (Compiles + runs `lib/*.test.ts`: game-shape, golf, money,
   legs, grouping, sync, badges, card.)
4. **Build:** `npm run build` → **rc 0**. `prebuild` (`scripts/write-version.mjs`) stamps
   `lib/app-version.ts`, `public/app-version.json`, and `public/sw.js` from the package version.
5. **Guards:**
   - `python3 ci/check-min-fontsize.py` — no rendered text < 11px. **Blocking.**
   - `python3 ci/check-global-rules.py` — global invariants (e.g. scrollRef clamp). **Blocking.**
   - `python3 ci/check-chart-overflow.py` — flex bar-columns must have `minWidth:0`. **Blocking.**
   - `python3 ci/check-jsx-escapes.py` — flags literal `\uXXXX` in JSX text. **Advisory (rc=1).** Only
     known false positive: `tee-times.tsx:285`. Any NEW hit must be fixed (use real glyphs).
6. **If you added a migration:** regenerate the ledger — `python3 ci/gen-migrations-checklist.py` (updates
   `MIGRATIONS.md`).
7. **Line endings:** normalize all text files to **CRLF**, EXCEPT everything under `ci/` and `.github/`,
   and `marketing/onepager-content.txt`, which stay **LF**.
8. **Assemble cumulative `.zip`.** Exclude: `node_modules`, `.next`, `.git`, `.testout`, `mockups`,
   `test-results`, `playwright-report`, `.playwright`, any `.env*`, `tsconfig.tsbuildinfo`.
9. **Leak-scan the zip:** confirm no real secrets. Secrets live ONLY in `.env.local` (excluded) and in
   Vercel/Supabase env settings — never hardcode them, never include `.env*` in the zip.
10. **`present_files`** the zip. Keep the post-share message short.

## 5. Global ground rules (authoritative list: `APP_RULES.md` in the zip)
Highlights — read `APP_RULES.md` for the numbered set + CI mapping:
- Flex children that can shrink need `minWidth:0` (prevents overflow blowing the layout).
- **Real glyphs** in JSX text (`·`, `›`, `—`, `…`, `×`, `▾`), never literal `\uXXXX`. (JS string literals may use `\u`.)
- **Popups:** every popup needs an always-reachable `×` and must NOT dismiss on scroll; scrollable-sheet
  backdrops must not close on tap.
- **Minimum font size 11px** anywhere.
- **Reuse check** before adding UI — look for an existing shared component first.
- **Print every migration's FULL SQL inline** in chat (Amit runs it manually).
- **Keep repo docs in sync** each bundle (see §6).
- Line endings: CRLF except `ci/` + `.github/` + `marketing/onepager-content.txt` = LF.
- Horizontally-scrollable boxes use the shared **`<HScroll>`** (`components/hscroll.tsx`) — hides the
  native scrollbar and shows a slim scroll-position bar BELOW the content (never over data).
- **Charts must fit their data to the space** (fit axis to data range; guard flat series).
- **Versioning:** feature = MINOR, refinement/fix = PATCH.
- **Deliberate name-list order** (default alphabetical; ask if unclear before shipping).
- **Never blank a screen on a query error**; never delete data or present a blank/new screen unexpectedly.
- **Confirm the plan before BIG / DB / semantic changes**; build **HTML mockups before visual changes**.
- **Yardages** show per-hole, per each player's chosen tee, on ALL scorecards.

## 6. Docs to keep in sync every bundle
`DEPLOY_NOTES.md` (changelog — add an entry per release), `MIGRATIONS.md` (run-ledger — regenerate),
`SCHEMA.md`, `BACKLOG.md`, `README.md`, `APP_RULES.md`. (Also present: `BETTING_MONEY_PLAN.md`,
`MONEY_FEATURE_PLAN.md`, `SCHEDULING_PLAN.md` — feature plans.)

## 7. Orientation — where things live
- `components/tournaments.tsx` — games/tournaments; the big one (game room, setup stepper, live scoring,
  betting, matchups, tee-groups, organizer controls).
- `components/round-setup.tsx` — new solo round entry (hole-by-hole + gross).
- `components/round-editor.tsx` — edit an existing round (scores + **editable play date**).
- `components/round-detail.tsx` — read-only round view + hole strip.
- `components/manage.tsx` — admin/manage (Power Users table, engagement charts, admin repair, drill-downs).
- `components/dashboard.tsx` — personal dashboard + trend charts.
- `components/ui.tsx` — shared primitives (`Avatar`, `ShortDateInput`, `NumPicker`, `ScoreEntryCard`, …).
- `components/hscroll.tsx` — horizontal scroller with the scroll-position bar.
- `lib/golf.ts` — core domain (handicaps, differentials, `fmtDate`, stats, the `C` colour palette).
- `lib/*` — money, legs, grouping, badges, card, sync — each with a `.test.ts`.
- `migrations/` — all SQL migrations (numbered). `MIGRATIONS.md` is the run-checklist.

## 8. Current state — immediate to-dos
**Current version: v1.164.3 (this zip).**
- **All migrations through 0110 have been run** — the database is fully current with this source
  (0108 avatars, 0109 play-date-when-scored, 0110 games always-scored-date + `set_game_played_date` RPC,
  and everything before). **No pending schema work.**
- **Deploy v1.164.3** if not already live (date-of-play work + the HScroll scroll-bar change).
- Optional sanity check: the Weequahic game should read **Jun 20** on all scorecards (0110 backfill).
- Next code work comes from the backlog (§10) or Amit's direction.

## 9. Recent major thread — "date of play" (context you'll need)
The recent work overhauled how a round's date is recorded:
- **Games (team/multiplayer):** recorded date is ALWAYS the day it was **scored** (games are scored live,
  never back-dated). The entered "Play date" is scheduling/display only. (migration 0110)
- **Solo rounds:** user-entered date, defaults to today, **editable** in the round editor. (v1.163.0)
- **Past-date confirmation:** any round saved with a date before today prompts a confirm. (v1.163.0)
- **Organizer** can correct a whole game's date; all players' rounds move together via
  `set_game_played_date`. (migration 0110 + v1.164.0)
- Posting functions `post_game_rounds_internal` (games) and `post_group_rounds` (tee-groups) set
  `played_at` = scored date and **preserve it on re-post** (finalizing a day later doesn't move the date).

## 10. Backlog (untouched — pick up when asked)
Flights Stage 2/3; large-field leaderboard; organizer console Phase 2/3; a "why your handicap moved"
one-liner; friction hardening (partial unique index on `rounds(user_id)` where in-progress); real GHIN
auto-import (parked); silent `catch{}` hardening.

## 11. Working style with Amit
Terse, technically precise. Diagnose root cause before patching; design for known cross-environment
tensions (installed PWA vs browser viewport) up front. Confirm plans on big/DB/semantic changes. Mockups
before visual changes. Don't over-format. When unsure, ask one crisp question.

---

## Appendix A — migration 0108 (applied — reference)
```sql
-- 0108_admin_stat_users_avatars.sql
drop function if exists public.admin_stat_users(text, text, date);

-- 0108_admin_stat_users_avatars.sql
-- Adds avatar_url to the shared analytics "who" drill so the drill sheet can show photos.
-- DROP+CREATE (return shape changes); re-applies the 0096 America/New_York timezone + grant.
-- Regenerated from 0090 by adding each branch's profile avatar_url as a 4th column.
-- The drill-down engine: one is_admin-gated RPC that, given a stat key (and optional arg/date),
-- returns the UNIFORM list of users behind that number: (name, detail, tag). Every analytics
-- stat routes through here so drill-down is consistent and new stats get it for free.
-- Real-round definition matches the app: deleted_at is null AND status <> 'in_progress'.
-- Test + deactivated accounts excluded from user-population stats.
-- NOTE: push_prefs values are 'push' | 'inapp' | 'off' (delivery mode), so "muted" = 'off';
-- notifications-on = the user has an active (non-disabled) push_subscription.
create or replace function public.admin_stat_users(
  p_stat text,
  p_arg text default null,
  p_date date default null
)
returns table(name text, detail text, tag text, avatar_url text)
language plpgsql
security definer
set search_path = public
as $function$
declare
  d date := coalesce(p_date, current_date);
begin
  if not public.is_admin() then raise exception 'admins only'; end if;

  if p_stat = 'users_total' then
    return query select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), null::text
     , p.avatar_url from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
      order by p.display_name nulls last;

  elsif p_stat = 'users_new_30d' then
    return query select coalesce(p.display_name,'(no name)'), 'first seen '||to_char(fa.first_day,'Mon DD'), 'new'::text
     , p.avatar_url from profiles p join (select user_id, min(day) first_day from daily_active group by user_id) fa on fa.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and fa.first_day > current_date - 30
      order by fa.first_day desc;

  elsif p_stat = 'active_dau' then
    return query select coalesce(p.display_name,'(no name)'), da.opens||' opens today', null::text
     , p.avatar_url from profiles p join daily_active da on da.user_id=p.id and da.day=current_date
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false order by da.opens desc;

  elsif p_stat in ('active_wau','active_mau') then
    return query select coalesce(p.display_name,'(no name)'), sum(da.opens)::text||' opens', null::text
     , p.avatar_url from profiles p join daily_active da on da.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and da.day > current_date - (case p_stat when 'active_wau' then 7 else 30 end)
      group by p.id, p.display_name order by sum(da.opens) desc;

  elsif p_stat = 'lapsed' then
    return query select coalesce(p.display_name,'(no name)'), 'last seen '||to_char(mx.last_day,'Mon DD'), 'lapsed'::text
     , p.avatar_url from profiles p join (select user_id, max(day) last_day from daily_active group by user_id) mx on mx.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and mx.last_day <= current_date - 30 and mx.last_day > current_date - 60 order by mx.last_day desc;

  elsif p_stat = 'never_joined_group' then
    return query select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), 'no club'::text
     , p.avatar_url from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and not exists (select 1 from group_members gm where gm.user_id=p.id and gm.status='active')
      order by p.display_name nulls last;

  elsif p_stat = 'rounds_done' then
    return query select coalesce(p.display_name,'(no name)'), count(*)::text||' completed', null::text
     , p.avatar_url from profiles p join rounds r on r.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and r.deleted_at is null and coalesce(r.status,'final')<>'in_progress'
      group by p.id, p.display_name order by count(*) desc;

  elsif p_stat = 'rounds_started' then
    return query select coalesce(p.display_name,'(no name)'), count(*)::text||' in progress', 'open'::text
     , p.avatar_url from profiles p join rounds r on r.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and r.deleted_at is null and coalesce(r.status,'final')='in_progress'
      group by p.id, p.display_name order by count(*) desc;

  elsif p_stat in ('abandoned','unfinished') then
    return query select coalesce(p.display_name,'(no name)'),
        count(*) filter (where r.deleted_at is null and coalesce(r.status,'final')='in_progress')::text||' unfinished'
          || case when count(*) filter (where r.deleted_at is not null) > 0
                  then ' · '||count(*) filter (where r.deleted_at is not null)::text||' deleted' else '' end,
        'friction'::text
     , p.avatar_url from profiles p join rounds r on r.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and ((r.deleted_at is null and coalesce(r.status,'final')='in_progress' and r.created_at < now() - interval '24 hours')
             or r.deleted_at is not null)
      group by p.id, p.display_name
      having count(*) filter (where r.deleted_at is null and coalesce(r.status,'final')='in_progress') > 0
          or count(*) filter (where r.deleted_at is not null) >= 3
      order by count(*) desc;

  elsif p_stat = 'rounds_day' then
    return query select coalesce(p.display_name,'(no name)')||' · '||coalesce(r.course,'course'),
        (select count(*) from holes h where h.round_id=r.id and h.strokes is not null)::text||' holes'
          || case when r.gross_score is not null then ' · gross '||r.gross_score::text else '' end,
        case when r.deleted_at is not null then 'deleted'
             when coalesce(r.status,'final')='in_progress' then 'in progress'
             when r.finished_by='system:auto' then 'auto-finished' else 'completed' end
     , p.avatar_url from rounds r join profiles p on p.id=r.user_id where r.played_at = d order by r.created_at;

  elsif p_stat = 'active_day' then
    return query select coalesce(p.display_name,'(no name)'), da.opens||' opens', null::text
     , p.avatar_url from daily_active da join profiles p on p.id=da.user_id
      where da.day = d and coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false order by da.opens desc;

  elsif p_stat = 'installed' then
    return query select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), 'installed'::text
     , p.avatar_url from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and p.last_standalone is true
      order by p.display_name nulls last;

  elsif p_stat = 'browser' then
    return query select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), 'browser'::text
     , p.avatar_url from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and p.last_standalone is false
      order by p.display_name nulls last;

  elsif p_stat = 'notif_on' then
    return query select coalesce(p.display_name,'(no name)'), 'push enabled', 'on'::text
     , p.avatar_url from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and exists (select 1 from push_subscriptions s where s.user_id=p.id and s.disabled=false)
      order by p.display_name nulls last;

  elsif p_stat = 'notif_off' then
    return query select coalesce(p.display_name,'(no name)'), 'no active device', 'off'::text
     , p.avatar_url from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and not exists (select 1 from push_subscriptions s where s.user_id=p.id and s.disabled=false)
      order by p.display_name nulls last;

  elsif p_stat = 'failing_subs' then
    return query select coalesce(p.display_name,'(no name)'),
        'fails '||max(s.fail_count)::text||' · last seen '||to_char(max(s.last_seen),'Mon DD'), 'stale'::text
     , p.avatar_url from push_subscriptions s join profiles p on p.id=s.user_id
      where s.disabled=true or s.fail_count >= 3 or s.last_seen < now() - interval '14 days'
      group by p.id, p.display_name order by max(s.fail_count) desc nulls last;

  elsif p_stat = 'mute' and p_arg is not null then
    return query select coalesce(p.display_name,'(no name)'), 'set to Off', 'muted'::text
     , p.avatar_url from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and (p.push_prefs->>p_arg) = 'off'
      order by p.display_name nulls last;

  elsif p_stat = 'share_on' then
    return query select coalesce(p.display_name,'(no name)'), 'card visible', 'on'::text
     , p.avatar_url from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and coalesce(p.show_card,true)=true
      order by p.display_name nulls last;

  elsif p_stat = 'share_off' then
    return query select coalesce(p.display_name,'(no name)'), 'opted out', 'off'::text
     , p.avatar_url from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and coalesce(p.show_card,true)=false
      order by p.display_name nulls last;

  elsif p_stat = 'guests' then
    return query select coalesce(host.display_name,'(no name)'), count(*)::text||' guest rounds hosted', 'host'::text
     , host.avatar_url from game_players gp join profiles host on host.id = gp.guest_of
      where gp.guest_of is not null group by host.id, host.display_name order by count(*) desc;

  elsif p_stat = 'avatars_set' then
    return query select coalesce(p.display_name,'(no name)'), 'has avatar', null::text
     , p.avatar_url from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and p.avatar_url is not null and p.avatar_url <> '' order by p.display_name nulls last;

  elsif p_stat = 'ai_summaries' then
    return query select coalesce(p.display_name,'(no name)'), 'has AI summary', null::text
     , p.avatar_url from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and p.dashboard_ai is not null order by p.display_name nulls last;

  end if;
  return;
end;
$function$;
alter function public.admin_stat_users(text, text, date) set timezone = 'America/New_York';
grant execute on function public.admin_stat_users(text, text, date) to authenticated;
```

## Appendix B — migration 0110 (applied — reference)
```sql
-- 0110_games_always_scored_date.sql
-- Games are scored live and never back-dated (team play), so a game round's recorded date is ALWAYS
-- the day it was scored — the game's entered play date is scheduling/display only. This drops the
-- 'deliberately-entered date wins' branch from 0109 for games. Also adds set_game_played_date so an
-- organizer can correct a whole game's date (all players' rounds move together), and finishes the
-- backfill for any game rounds still holding an inherited date.

create or replace function public.post_game_rounds_internal(p_game uuid, p_system boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  g       record;
  pl      record;
  rid     uuid;
  hmeta   jsonb;
  n       int;
  i       int;
  sc      int;
  gross   int;
  entered int;
  rdate   date;
begin
  select * into g from games where id = p_game;
  if not found then return; end if;

  hmeta := coalesce(g.holes_meta, '[]'::jsonb);
  n := jsonb_array_length(hmeta);
  -- Games are scored live, so a round's recorded date is always the day it was scored (this first
  -- post). The game's play-date field is scheduling/display only. Re-posts preserve played_at, and an
  -- organizer can correct a whole game's date via set_game_played_date.
  rdate := (now() at time zone 'America/New_York')::date;

  for pl in
    select * from game_players where game_id = p_game and user_id is not null
  loop
    gross := 0; entered := 0;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        entered := entered + 1;
        gross := gross + sc;
      end if;
    end loop;
    if entered = 0 then continue; end if;

    select id into rid from rounds where game_id = p_game and user_id = pl.user_id limit 1;
    if rid is not null then
      update rounds set
        course = g.course, tee_name = pl.tee_name, rating = pl.rating, slope = pl.slope,
        course_par = g.course_par, handicap_index = pl.handicap_index,
        course_handicap = pl.course_handicap, group_id = g.group_id,
        status = 'final', gross_score = gross
      where id = rid;
    else
      insert into rounds (
        user_id, course, tee_name, rating, slope, course_par, handicap_index,
        course_handicap, group_id, played_at, status, gross_score, game_id
      ) values (
        pl.user_id, g.course, pl.tee_name, pl.rating, pl.slope, g.course_par, pl.handicap_index,
        pl.course_handicap, g.group_id, rdate, 'final', gross, p_game
      )
      on conflict (game_id, user_id) do update set
        course = excluded.course, tee_name = excluded.tee_name, rating = excluded.rating,
        slope = excluded.slope, course_par = excluded.course_par,
        handicap_index = excluded.handicap_index, course_handicap = excluded.course_handicap,
        group_id = excluded.group_id,
        status = excluded.status, gross_score = excluded.gross_score
      returning id into rid;
    end if;

    delete from holes where round_id = rid;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        insert into holes (
          round_id, hole_number, par, stroke_index, strokes, putts, fairway, penalties, sand, yardage
        ) values (
          rid,
          (hmeta->i->>'n')::int,
          (hmeta->i->>'par')::int,
          nullif(hmeta->i->>'si','')::int,
          sc,
          nullif(pl.putts->>i, '')::int,
          nullif(pl.fairways->>i, ''),
          coalesce(nullif(pl.penalties->>i, '')::int, 0),
          coalesce((pl.sand->>i)::boolean, false),
          nullif(hmeta->i->>'yards','')::int
        );
      end if;
    end loop;
  end loop;

  if p_system then
    update rounds set finished_by = 'system:auto', finished_at = coalesce(finished_at, now())
    where game_id = p_game;
  end if;
end;
$$;

create or replace function public.post_group_rounds(p_game uuid, p_tee_group int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g       record;
  pl      record;
  rid     uuid;
  hmeta   jsonb;
  n       int;
  i       int;
  sc      int;
  gross   int;
  entered int;
  rdate   date;
begin
  select * into g from games where id = p_game;
  if not found then return; end if;
  -- Caller must be a player in this game (any member can finish their group).
  if not exists (
    select 1 from game_players where game_id = p_game and user_id = auth.uid()
  ) then
    return;
  end if;

  hmeta := coalesce(g.holes_meta, '[]'::jsonb);
  n := jsonb_array_length(hmeta);
  -- Deliberately-entered date first, else the date it's actually scored.
  -- Games are scored live, so a round's recorded date is always the day it was scored (this first
  -- post). The game's play-date field is scheduling/display only. Re-posts preserve played_at, and an
  -- organizer can correct a whole game's date via set_game_played_date.
  rdate := (now() at time zone 'America/New_York')::date;

  for pl in
    select * from game_players
    where game_id = p_game and user_id is not null and tee_group = p_tee_group
  loop
    -- Tally entered holes + gross from the player's jsonb scores.
    gross := 0; entered := 0;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        entered := entered + 1;
        gross := gross + sc;
      end if;
    end loop;
    if entered = 0 then continue; end if;  -- didn't play

    -- Upsert the round row (one per game+user). ON CONFLICT keeps a racing client
    -- insert from aborting the whole post; it updates that row in place instead.
    select id into rid from rounds where game_id = p_game and user_id = pl.user_id limit 1;
    if rid is not null then
      update rounds set
        course = g.course, tee_name = pl.tee_name, rating = pl.rating, slope = pl.slope,
        course_par = g.course_par, handicap_index = pl.handicap_index,
        course_handicap = pl.course_handicap, group_id = g.group_id,
        status = 'final', gross_score = gross
      where id = rid;
    else
      insert into rounds (
        user_id, course, tee_name, rating, slope, course_par, handicap_index,
        course_handicap, group_id, played_at, status, gross_score, game_id
      ) values (
        pl.user_id, g.course, pl.tee_name, pl.rating, pl.slope, g.course_par, pl.handicap_index,
        pl.course_handicap, g.group_id, rdate, 'final', gross, p_game
      )
      on conflict (game_id, user_id) do update set
        course = excluded.course, tee_name = excluded.tee_name, rating = excluded.rating,
        slope = excluded.slope, course_par = excluded.course_par,
        handicap_index = excluded.handicap_index, course_handicap = excluded.course_handicap,
        group_id = excluded.group_id,
        status = excluded.status, gross_score = excluded.gross_score
      returning id into rid;
    end if;

    -- Rewrite per-hole detail for played holes only.
    delete from holes where round_id = rid;
    for i in 0 .. n - 1 loop
      sc := nullif(pl.scores->>i, '')::int;
      if sc is not null and sc > 0 then
        insert into holes (
          round_id, hole_number, par, stroke_index, strokes, putts, fairway, penalties, sand, yardage
        ) values (
          rid,
          (hmeta->i->>'n')::int,
          (hmeta->i->>'par')::int,
          nullif(hmeta->i->>'si','')::int,
          sc,
          nullif(pl.putts->>i, '')::int,
          nullif(pl.fairways->>i, ''),
          coalesce(nullif(pl.penalties->>i, '')::int, 0),
          coalesce((pl.sand->>i)::boolean, false),
          nullif(hmeta->i->>'yards','')::int
        );
      end if;
    end loop;
  end loop;
end;
$$;

-- Organizer-only: correct a whole game's date. Moves the game's display/schedule date AND every
-- posted round for that game together, so all players stay in sync. Past-date confirmation is done
-- client-side. security definer so the organizer can touch other players' round rows (RLS-guarded).
create or replace function public.set_game_played_date(p_game uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from games where id = p_game and created_by = auth.uid()) then
    raise exception 'only the organizer can change the game date';
  end if;
  update games  set played_at = p_date where id = p_game;
  update rounds set played_at = p_date where game_id = p_game;
end;
$$;
grant execute on function public.set_game_played_date(uuid, date) to authenticated;

-- Complete the 0109 backfill now that games always use the scored date: force EVERY game round to the
-- day it was actually scored (its first-post/creation day, ET), superseding any inherited match date.
-- Rounds already on that date are untouched; solo rounds (game_id null) are left alone.
update public.rounds r
set played_at = (r.created_at at time zone 'America/New_York')::date
where r.game_id is not null
  and r.deleted_at is null
  and r.played_at is distinct from (r.created_at at time zone 'America/New_York')::date;
```
