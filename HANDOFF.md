# Birdie Num Num (BNN) — Developer Handoff

**Read this first.** It's the onboarding brief for continuing BNN development in a fresh chat with no
prior context. The uploaded `.zip` is the complete source at the current version. When in doubt about
how anything works, **open the file and read it** — never answer from assumption.

---

## 0. ACTION REQUIRED AT THE NEXT PRODUCTION MERGE

**`migrations/0139_nine_hole_round_basis.sql` must be applied to PRODUCTION when the databases are
merged.** It redefines three functions (`post_game_rounds_internal`, `post_group_rounds`,
`set_game_played_date`) so a nine-hole game posts a round on a nine-hole basis: rating, par and
course handicap halved, **slope unchanged**.

Migrations deploy BEFORE the code that depends on them. Until this runs in production, a nine-hole
game posted there writes a wrong differential into the player's handicap record — 9 holes against
par 72 with an eighteen-hole handicap, which falls into the partial-round path and fills nine
phantom holes with net par.

Requested by Amit, 177.95. Delete this section once it is applied.

## 0. The one rule that overrides everything
**Verify every claim about app behavior from the actual code before stating it or acting on it.** Do not
describe what the app does from memory or inference. Open the file, read it, then respond. This is the
single most important habit — it has caught countless bugs.

### What "verify" means in practice
Before writing code that touches a component, read its ACTUAL signature and body. Before writing a
test fixture, read the field names off the type. Before claiming a check passes, read the exit code
from the process — not from a pipeline, and not from output piped to `head` or `tail`.

### Assumptions that reached the user, each avoidable by opening one file
| Assumed | Actually |
|---|---|
| `RoundsList` takes `course_name` | the field is `course` — the name rendered blank |
| a round row carries `gross` | gross is DERIVED from the holes; the row field is ignored |
| `SegmentBoard` renders an open board | it is a COLLAPSED accordion — names hidden until expanded |
| its segments are front/back nine | three blocks of six (1-6, 7-12, 13-18) |
| `ShotSynthesis` always renders | returns null twice over: no index, and no qualifying sample |
| `LeaderRow` takes plain fields | it takes CALLBACKS — playerNet, parThru, relToParStr |
| components with no `supabase.` calls are prop-only | several construct a client at MODULE scope |
| `100lvh` equals the visible viewport when installed | it is larger by exactly safe-area-inset-top |
| `cmd \| tail` shows me whether cmd passed | it reports TAIL's status — hid a suite that hung forever |

### The shape of the mistake
It is never "I could not have known". It is always "I did not look, because I was confident."
Confidence about a file you have not opened in this session is worth nothing.

### Standing checks
- `python3 ci/preflight.py` before packaging anything — runs the real pipeline, timed, and fails a
  step that is stuck rather than slow.
- `python3 ci/preflight.py --zip <drop> --base <baseline>` before handing a drop over, so what is
  verified is the artifact, not a working tree that happens to have a file the zip forgot.
- Quote the measured timings in the handover. "The gates passed" is not evidence.

## 1. What BNN is + your role
- **Birdie Num Num**: a golf-scoring Progressive Web App for a golf group — scorecards, games/tournaments,
  handicaps (WHS-style), betting/money settle-up, tee-time scheduling, badges, and admin analytics.
- **Owner: Amit Sud (non-technical).** You (Claude) are the **sole developer**. You write the code, ship
  it, and give Amit clear copy-paste steps. He can't debug — precision and clear instructions matter.
- Amit also uses these chats for sophisticated **investment research**; for factual/investment questions
  he wants **sourced** answers (SEC filings + management commentary prioritized). Separate from BNN, but
  it may come up in the same chat.

## 2. Stack + infrastructure
- **Next.js 16.3** (App Router) + React 19 + TypeScript.
- **Supabase** (Postgres + Auth + Row-Level Security). Project ref `epmbsmykyrnoiccwnoxq`. **FREE tier** —
  mind quotas.
- **Vercel** hosting. Repo: `sudinator/fairway-web`. Live: `birdienumnum.vercel.app`.

### GOLF_API_KEY lives in THREE places

The GolfCourseAPI key is needed by two independent systems and is unreadable from both once set.
This bit us: it was set in June, never written down, and could not be recovered — Vercel marks it
Sensitive (write-only) and GolfCourseAPI does not display an existing key.

| Where | Why | Notes |
|---|---|---|
| **Vercel** env var `GOLF_API_KEY` | the app's course search (`app/api/courses/route.ts`) | Sensitive, Production + Preview. Changing it requires a REDEPLOY |
| **GitHub** repository secret `GOLF_API_KEY` | the weekly contract monitor | must be a REPOSITORY secret — the workflow declares no `environment:` |
| **Password manager** | so it can be recovered | the step that was skipped |

Account is at golfcourseapi.com — free, sign-in is by emailed link, no password.

If it ever needs replacing: regenerate, save to the password manager FIRST, then Vercel, then
redeploy, then GitHub. Course search is the only thing affected and it fails with a clear message,
not silently. Verify with `https://birdienumnum.vercel.app/api/courses?q=francis+byrne`.
- **PWA** (installable; service worker at `public/sw.js`, version-stamped).
- Sister app "Fairway Card" (separate repo, `fairway-web-eosin.vercel.app`) is occasionally referenced —
  not this project.

## 3. Deploy flow (staging first)
1. Start from a clean `staging` branch synchronized from `main`.
2. Apply the reviewed candidate/overlay to `staging`; inspect the exact changed-file set before commit.
3. Push `staging`; GitHub CI/guards and the Vercel Preview deployment must pass.
4. Run required staging/browser validation where the staging data/environment can exercise the feature.
5. Open `staging -> main`; required PR checks must pass before merge.
6. Confirm Vercel Production is Ready, then run a small non-destructive Production smoke test.
7. Merge/sync the new `main` state back into `staging` before the next release.
8. Database migrations are pasted/run manually in the Supabase SQL editor as database owner/postgres, with staging first for destructive/integration validation.

Because Amit is non-technical: **always print migration SQL inline for copy-paste**, and give plain, numbered instructions.

## 4. Pre-ship pipeline — run EVERY release
The release is not deployable until every **BLOCKING** required gate is green. **ADVISORY** checks must execute and be documented, but advisory findings alone do not block deployment.

1. **Consistency / source-contract review:** inspect the actual changed code, inputs, outputs, side effects, dependencies, and reverse/re-entry paths.
2. **Type-check:** `npx tsc --noEmit` -> rc 0.
3. **Unit + differential tests:** `npm test` -> rc 0.
4. **Guards:** `npm run guards` -> rc 0. This includes migration/security, UI, refactor reachability/state/dependency, external-provider, PWA, and feature-specific contracts. Individual explicitly-advisory debt checks may report findings while returning rc 0; their findings must be documented.
5. **Build:** `npm run build` -> rc 0. `prebuild` verifies VAPID-key consistency when the environment key is present and stamps the app version.
6. **One-command local/CI gate:** `npm run ci` runs hook lint, typecheck, guards, tests, and build.
7. **Simulated testing:** run normal, edge, invalid-input, state-transition, retry/re-entry, failure/rollback, and adjacent-flow scenarios. Label evidence MODELLED, EXECUTED, or BROWSER-VALIDATED.
8. **Version/docs:** bump `FEATURE.EDIT.YYMMDD`; update DEPLOY_NOTES, release verification, workflow simulation report, APP_RULES/HANDOFF/MIGRATIONS/SCHEMA/BACKLOG as applicable.
9. **Migration ledger:** if migrations changed, run `python3 ci/gen-migrations-checklist.py` twice and require byte-identical second output. Every migration >=0113 self-records semantically.
10. **Packaging:** preserve repository line endings; exclude `.git`, `node_modules`, `.next`, `.testout`, generated reports and all `.env*` secrets. Leak-scan before handoff.
11. **Staging GitHub/Vercel gates:** CI and relevant Robustness jobs green; Vercel Preview Ready.
12. **PR -> Production:** required PR verification green, merge to main, Production Ready, non-destructive smoke test, then `main -> staging` resync.

If a required gate cannot run in the current environment, mark it **NOT EXECUTED/BLOCKED** and do not call the release deployable.

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
- **Versioning:** `FEATURE.EDIT.YYMMDD` (ET date), e.g. `165.1.260714`. FEATURE = new feature, EDIT =
  refinement (resets on FEATURE bump), bump EDIT every ship. (≤ `1.165.0` used old `1.MINOR.PATCH`.)
- **Deliberate name-list order** (default alphabetical; ask if unclear before shipping).
- **Never blank a screen on a query error**; never delete data or present a blank/new screen unexpectedly.
- **Confirm the plan before BIG / DB / semantic changes**; build **HTML mockups before visual changes**.
- **Yardages** show per-hole, per each player's chosen tee, on ALL scorecards.

## 6. Docs to keep in sync every bundle
`DEPLOY_NOTES.md` (changelog — add an entry per release), `MIGRATIONS.md` (run-ledger — regenerate),
`SCHEMA.md`, `BACKLOG.md`, `README.md`, `APP_RULES.md`. (Also present: `BETTING_MONEY_PLAN.md`,
`MONEY_FEATURE_PLAN.md`, `SCHEDULING_PLAN.md` — feature plans.)

## 7. Orientation — where things live
- `components/tournaments.tsx` — games/tournaments; the big one (game room state/side effects, live scoring,
  betting, matchups, tee-groups, organizer controls). The post-create setup render boundary now lives in `components/game/setup/game-setup-workspace.tsx`.
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
**Current setup candidate:** 177.44.260816 is the corrective candidate for the 177.43 transition-policy PR: it adds the required `Game.code` field to the dedicated policy test fixture so dependency-backed TypeScript/CI can compile; runtime policy behavior is unchanged and there is no migration.
**Current working candidate: 177.44.260816 (transition-policy test-fixture typecheck correction).**
- 177.26 supersedes the unreleased 177.25 candidate after its first GitHub execution exposed verification-harness ordering/sequencing defects; it still includes the 177.24 dashboard Putts/round + targeted stats-completion baseline.
- Migrations `0135_ledger_backfill.sql`, `0136_core_rls_helpers.sql`, and `0137_core_rls_baseline.sql` are now **applied and verified in both staging and Production**. Production/staging ledgers are reconciled through 0137 (0129 is the intentional reserved gap); both environments expose the expected 60 core RLS policies across 12 tables.
- `0135` evidence-backfilled 0122-0128 into both ledgers; `0136` installed/verified the six Production SECURITY DEFINER RLS helpers; `0137` installed the source-controlled core RLS policy/grant baseline. The real staging integration harness passed afterward and Production passed a non-destructive smoke test.
- `ci/core_rls_production_baseline.json` is the machine-readable 2026-08-14 Production RLS baseline (12 tables / 60 policies). `ci/core_rls_helpers_production_baseline.json` captures the six helper definitions. `ci/assert-core-rls-live.sql` is the read-only live drift guard.
- Fresh-database reconstruction is now part of required `CI / verify`: a pinned Supabase CLI creates a disposable database, applies both migration trees from empty state, and asserts the checked-in RLS baseline. The first GitHub execution correctly exposed a full-path ordering bug; 177.26 fixes ordering by numeric migration prefix and requires a corrected GitHub fresh-DB PASS before ship.
- The schema migration ledger (`public.schema_migrations`) is the source of truth for applied state from 0113 onward. `MIGRATIONS.md` is a human checklist and must not be treated as authoritative applied-state evidence.
- 177.39 completed the historical round rating/slope feature. 177.40 is a refactor-only candidate and remains **NOT DEPLOYABLE** until its own dependency-backed CI/type/test/build, characterization/guard suite, staging validation, PR verify, Production Ready, and smoke gates pass.

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

## v177.14 automated pre-deploy gate
Current release target: **177.14.260808**. Migration sequence assumes 0130/0131/0132 are already live from v177.13; apply **0133_testing_and_money_atomicity.sql** before deploying v177.14.
For release candidates, run `npm run ci:staging` against a disposable/staging Supabase project with `BNN_STAGING_SUPABASE_URL`, `BNN_STAGING_SUPABASE_ANON_KEY`, `BNN_STAGING_SUPABASE_SERVICE_ROLE_KEY`, and the explicit safety switch `BNN_STAGING_ALLOW_MUTATION=YES`. The suite creates and removes test users/data; never point it at production.


## v177.15 corrective release
- Production path: if v177.14/0133 is already live, apply only `0134_fix_bet_rpc_ambiguous_id.sql`, confirm the ledger row, then deploy v177.15.
- Fresh path: 0129 remains intentionally skipped/reserved; apply 0130 → 0131 → 0132 → 0133 → 0134.
- 0134 was generated from a failure caught by the real GitHub/Supabase staging integration gate and then validated by a fully green staging run.
- Do not copy production data or production outbound webhooks into staging; schema/RPC parity plus disposable test fixtures is the intended model.

## v177.19+ refactor integrity rule
A modular refactor is not verified by byte identity alone. Preserve and permanently characterize the full entry -> inputs/state -> extracted code -> outputs/callbacks -> downstream dependency/DB side effects -> refresh/cancel/exit chain, including effect timing. Use explicit prop contracts, `satisfies` for spread props, reachability/state/dependency CI guards, differential tests for pure logic, and scenario tests for stateful flows. Treat unused props/state/imports as boundary-drift signals.

Release candidates must be constructed from the latest clean synchronized `staging` baseline (`main` synced back after production), never from an older uploaded release ZIP.

## External provider contract rule (177.20+)
- External API identifiers are opaque provider-owned tokens. Do not assume numeric/string formats from historical data unless the provider explicitly guarantees them.
- GolfCourseAPI has a scheduled golden-fixture contract monitor in `.github/workflows/external-api-contracts.yml`; it checks search/detail availability, exact reviewed course identities, ids, metadata, and required detail fields and opens/updates a GitHub issue on drift.
- Before changing BNN in response to an external-data failure, compare live provider responses with the golden fixtures and determine whether the provider contract or BNN code changed.
- Preserve BNN internal UUIDs/history across provider migrations; reconcile provider-owned ids/metadata separately.

## 177.21 source/environment contracts
- Staging is visually marked by a yellow safe-area-aware border and STAGING badge based on `VERCEL_GIT_COMMIT_REF === "staging"`; Production must not display it.
- Add New Course now distinguishes canonical BNN data from fresh GolfCourseAPI data at selection time. Existing canonical rows remain primary; provider data is comparison-only until the user explicitly chooses to review it.
- 177.21 Production deployment is the required live transition test for the 177.20 PWA update contract: the installed 177.20 shell must remain active until Update is pressed.

### Stateful UI evidence rule
For changed interactions, do not equate handler reachability with working behavior. Verify action -> complete state propagation -> observable UI -> downstream effects -> reverse/cancel/re-entry. Label evidence MODELLED, EXECUTED, or BROWSER-VALIDATED; never report modelled behavior as an executed PASS. Mode/source switches require round-trip A -> B -> A verification.


## Correction workflow terminal-path rule (177.23+)
- When a stateful flow can enter a validation-required terminal action, the UI must expose every required input before submission and the primary CTA must describe the actual terminal action.
- For course provider review, Stored BNN -> Provider review -> reason entry -> Submit for approval -> pending/review outcome is part of the observable-outcome contract; the reverse/cancel path must remain reachable.

## 177.25 integrity hardening status
- Current working candidate: `177.25.260814`.
- Do not ship until the Production RLS export for the 12 legacy core tables has been captured and converted into an executable idempotent baseline migration, then verified by a fresh-database reconstruction test.
- Migration 0135 is an evidence-based ledger backfill for 0122-0128; it must be executed as database owner/postgres, not through an application Supabase client.

### 177.27 fresh-database prerequisite correction
- Fresh-DB CI now installs source-controlled PostgreSQL prerequisites before migration 0001.
- Current pre-0001 prerequisite: `citext`, because `0001_baseline.sql` uses the type while historical migration 0038 only declares the extension later.
- `pg_cron` remains self-declared by migration 0074 before its first `cron.*` use.
- `ci/check_db_extension_prereqs.py` permanently validates extension availability against the real globally ordered migration stream.
- Do not apply migrations 0135-0137 to staging or Production until the disposable fresh-database GitHub gate passes end-to-end.


## 177.28 fresh-database reconstruction status
- Disposable rebuild now has explicit extension prerequisites and globally ordered migrations.
- CI 177.27 reached `0017_notifications_lockdown.sql` and exposed the baseline omission of the historical `create notifications` policy.
- 177.28 restores only that pre-0017 compatibility policy in `0001_baseline.sql` and adds `ci/check_legacy_migration_prereqs.py` so non-idempotent historical object dependencies are audited semantically.
- Do not apply 0135-0137 to staging or Production until the full disposable rebuild reaches the end and passes the core-RLS verification.

## 177.29 comprehensive migration dependency audit
- After fresh replay exposed a missing `is_group_member(uuid,uuid)` dependency at migration 0025, the audit was expanded across the entire 135-migration ordered stream rather than iterating one CI failure at a time.
- `0001_baseline.sql` now reconstructs the historical pre-0034 versions of `is_admin`, `is_group_member`, and `is_group_admin`; 0034 remains the point where banned-user enforcement is added.
- `ci/check_legacy_migration_prereqs.py` now checks relation ordering, all repo-defined function calls/use-before-create, policy prerequisites, explicit column-state operations, custom types, and unresolved `public.*` function references. Extension ordering remains separately guarded.
- Current static closure result: PASS across 135 migrations; negative mutation test also PASS (guard fails when the historical helper is removed).
- Do not apply 0135-0137 to staging or Production until GitHub's disposable fresh-database replay passes end-to-end.

## 177.30 historical baseline column closure
- CI #39 advanced clean-database replay through migration 0042 and failed at 0043 because `rounds.game_id` was absent from the committed baseline. Production/staging live databases were not changed.
- The Production-derived 177.14 bootstrap was used as historical evidence to identify baseline-table columns that existed outside the numbered migration stream. Nine such compatibility columns are now source-controlled in `supabase/migrations/0001_baseline.sql`.
- Fresh DB CI now asserts those nine columns after the full migration chain, including type/nullability/default expectations.
- Static migration dependency analysis now includes executable column dependencies and is negative-tested against the exact 0043 game_id failure pattern.
- Continue to treat disposable fresh-database execution as authoritative. Do not apply 0135-0137 to staging until the fresh replay is green through the entire stream and final RLS/security assertions.


## 177.31 RLS parity diagnostics
- CI #40 completed the full migration stream through `0137_core_rls_baseline.sql` and passed the historical nine-column compatibility assertion, then failed only at the final exact RLS policy comparison.
- The old verifier reported `30 differing row(s)` without policy/field detail, which is insufficient evidence for modifying security policy definitions.
- `ci/assert-core-rls-live.sql` now emits `CORE_RLS_DIFF` diagnostics keyed by table/policy, including differing fields and raw expected/actual `permissive`, roles, command, USING expression, and WITH CHECK expression.
- Whitespace-only expression flags are diagnostic only; exact raw parity remains mandatory until differences are classified.
- Do not apply 0135-0137 to staging or Production until the fresh rebuild's policy differences are fully explained and the final security contract gate passes.


## 177.32 RLS diagnostic transaction lifetime
- Root cause of the 177.31 verifier execution failure is confirmed: `_core_rls_expected` used `ON COMMIT DROP` while the script ran under psql autocommit with no enclosing transaction. The table was dropped immediately after CREATE TABLE, so the following INSERT failed before any policy diagnostics could run.
- Working correction adds an explicit `BEGIN` before the verifier work and `COMMIT` only after the PASS result.
- Source-contract guard now checks that ordering.
- 177.32 may be packaged only as a staging-diagnostic overlay so GitHub can execute the disposable PostgreSQL gate. Do not treat it as deployable, apply 0135-0137 to staging/Production, or promote to `main` until (a) matching fixtures => PASS and (b) deliberate mismatch => emitted `CORE_RLS_DIFF` row(s) followed by hard failure, followed by the complete release gate.


## 177.33 RLS runtime-canonical parity gate
- CI 177.32 proved the diagnostic transaction fix and reduced the former 30 count-only rows to 15 named policy keys. Review of all 15 showed the same class: PostgreSQL `pg_policies` parse/deparse rendering differences on subquery expressions, with no role/command/predicate-semantic drift visible.
- 177.33 preserves the Production raw baseline but canonicalizes `qual`/`with_check` by creating session-local shadow tables/policies and letting the SAME running PostgreSQL engine parse/deparse the expected expressions. The real public policies are then compared against that runtime-canonical form.
- Metadata (table/policy key, permissive mode, roles, command), RLS state, and grants remain exact comparisons. `CORE_RLS_RENDERING` is informational only; `CORE_RLS_DIFF` remains a hard failure.
- The verifier includes executable negative canaries for removed admin checks, ownership checks, guest checks, active-membership checks, AND->OR mutation, and organizer-condition mutation, plus one equivalent-format convergence canary. It also logs the PostgreSQL server version.
- Do not apply 0135-0137 to real staging or Production and do not promote to main until GitHub's disposable fresh-DB run proves the canonical gate/canaries and the complete release gate is green.


### 177.34.260815 — split RLS structural / semantic / behavior verification
- Replaces the flawed 177.33 pg_temp deparser-canonicalization approach. PostgreSQL deparsed text is no longer treated as a stable security semantic contract.
- `ci/assert-core-rls-live.sql` is again production-safe/read-only and hard-gates stable runtime structure only: 12 RLS table states, exact 60 policy identities/permissive modes/roles/commands, and exported grants.
- New fresh-DB-only `ci/assert-core-rls-behavior.sql` exercises authenticated owner-vs-other authorization for notifications, rounds, and holes, including allowed writes and denied cross-user writes. All fixtures and trigger-disable changes roll back.
- `ci/test_fresh_db_rebuild.sh` now requires structural and behavior RLS gates after the full migration replay; `ci/check_fresh_db_ci_contract.py` permanently guards that architecture and rejects a return to pg_temp expression canonicalization.
- No application code, RLS policy, grant, helper, migration, staging database, or Production database behavior is changed.
- **NOT DEPLOYABLE:** PostgreSQL execution of the new structural/behavior gates, full dependency-backed CI/type/test/build, Vercel staging, staging regression validation, PR verify, Production Ready and smoke remain mandatory.

## 177.35 hook-lint gate reconciliation
- CI on 177.34 reached the dependency-backed `npm run ci` chain and stopped at its first stage because ESLint reported 23 unused disable directives with `--max-warnings=0`.
- Exact current staging source contains 22 reviewed `react-hooks/exhaustive-deps` suppressions plus one generic inline `eslint-disable-next-line`; `eslint.config.mjs` enables only `react-hooks/rules-of-hooks`, so all 23 directives are stale and have no runtime effect.
- 177.35 removes only those 23 comments. No effect bodies, dependency arrays, props, state, callbacks, imports, APIs, RPCs, database writes, or UI behavior are changed.
- `ci/check_effect_suppressions.py` now enforces a permanent zero-suppression contract for `react-hooks/exhaustive-deps`; the old 22-line legacy baseline is retired. The broader exhaustive-deps dependency audit remains backlog work and the rule itself is not enabled by this corrective.
- Local dependency installation timed out in this execution environment, so dependency-backed ESLint/TypeScript/unit/build remain GitHub-authoritative gates. Do not call 177.35 deployable until the complete GitHub CI chain, fresh-database reconstruction/RLS behavior gate, Vercel staging build, and relevant staging regression checks are green.



## 177.39 historical round rating/slope correction
- Existing final rounds expose historical Course rating / Slope in Round Editor. Saving a correction writes only that round's `rating`, `slope`, and recalculated `course_handicap` (using the handicap index stored on the round), then the normal round reload recomputes differential and app-estimated handicap history.
- Gross-only historical rounds can save the correction without losing `gross_score` or inventing hole rows. Cancel on an already-recorded round is non-destructive.
- Game-linked personal rounds remain personal-history corrections only; no game/game_player data is rewritten. Course-library propagation remains separate/explicit through Save course.
- No migration.

## 177.36 CI severity alignment
- GitHub 177.35 progressed past hook lint and reached the guard suite, then stopped because `ci/check_extracted_import_debt.py` returned exit 1 for unused-symbol debt changes. APP_RULES #26 already defines unused props/state/imports as boundary-drift **warnings**, so the implemented severity contradicted the documented policy.
- 177.36 keeps the unused-symbol measurement and full per-file report but makes it explicitly **ADVISORY** (exit 0). The baseline is not reset and no reported application code is cleaned up in this corrective.
- Blocking gates remain blocking: fresh-database reconstruction, RLS/security structure and behavior, migration/source closure, secrets/environment safety, TypeScript correctness, unit/differential behavior, production build, reachability/source-contract defects, and feature correctness.
- No application logic, migration, RLS policy, grant, helper, or database behavior changes. The purpose is severity alignment, not suppression of evidence.
- Release remains **NOT DEPLOYABLE** until all blocking GitHub/fresh-DB/type/test/build/staging gates pass. Advisory findings must be carried in release verification/backlog rather than silently discarded.


## 177.40 Game setup workspace extraction
- Scope is deliberately narrow: extract only the existing organizer setup stepper/progress/render calculations into `components/game/setup/game-setup-workspace.tsx`; no UX redesign and no transition-policy behavior yet.
- `GameRoom` keeps setup state, every mutation handler, every Supabase/RPC write, `load()`/refresh chains, structure stash/restore, scoring ownership, and Matchups/StrokesSummary rendering.
- `GameRoom` constructs `OrganizerPanelProps` and `GameSetupWorkspace` props with `satisfies` so callback/boundary drift fails TypeScript.
- Permanent `ci/check_game_setup_workspace_contract.py` verifies step visibility/fallback, Players/Teams/Groups reachability, tee/handicap/add-player/group callback bridges, Matchups reachability, and forbids DB ownership in the extracted workspace.
- Next product stage after this refactor is validated: persistent Game Control Center UX that lets organizers revisit Game/Players/Format/Teams & Groups/Review, followed by a centralized before/after-scoring transition policy.

## 177.49 Create Game convergence staging train
- Production intentionally remains on the last completed release while 177.47+ accumulate on `staging`; do not open staging->main PRs for intermediate convergence checkpoints.
- 177.47: canonical Create Game draft/state inventory foundation.
- 177.48: pure game-structure mutations with differential characterization.
- 177.49 Stage 3A: shared Create Game navigation workspace (**Game -> Players -> Format -> Teams & groups -> Review**) using existing parent state/handlers. No persistence ownership moved; no migration.
- 177.50 Stage 3B: creation-time tee inheritance is now **individual override -> one-off flight tee -> game default tee**. The maps persist in Resume Setup, old drafts remain compatible, and Create resolves inheritance into explicit player tee/rating/slope/course-handicap snapshots. No migration.
- Before Stage 3 is complete, move the existing team/matchup/foursome/tee-group structure into pre-create draft state without discarding structure work.
- Stage 4 remains the atomic core Create transaction after the draft UI is fully characterized and browser-validated.

## Current staging convergence checkpoint — 177.52 Lean Create
Create Game is intentionally **lean**: Game → Players → Format → Review. Default/flight/player tee inheritance and Resume Setup remain in Create; persisted structural work (teams, matchups, foursomes, tee groups) is completed in Manage Game, which remains the single source of truth for transition policy and structural edits. Stableford/Stroke create into Play; structural formats create into the relevant Manage Game setup section. No migration. Production should not receive the convergence train until cumulative validation is complete.
