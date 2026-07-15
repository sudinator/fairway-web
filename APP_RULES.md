# Birdie Num Num — Global App Rules

The standing invariants for this app. These apply everywhere unless a rule explicitly scopes
itself. "CI" = automatically checked by a script in `ci/` (run during every release build); "manual"
= reviewed by hand. Keep this file in sync when a new global rule is agreed.

## UI / layout
1. **No horizontal page scroll — app-wide.** The page never drifts left/right. The single inner
   scroll container (`components/home.tsx`, `scrollRef`) is `overflowY:auto` + `overflowX:hidden`.
   When content is wider than the phone, resolve it in this order — never let it clip silently or push
   the page:
   1. **Resize / reflow to fit (preferred):** flex `flex:1`, `flexWrap:"wrap"`, responsive
      `gridTemplateColumns: repeat(auto-fit, minmax(…))`, `tableLayout:"fixed"` + `width:"100%"`.
      **Flex bar charts / any horizontal row of mapped items MUST put `minWidth:0` on each child**
      (flex items default to `min-width:auto` and won't shrink below their content — a `nowrap` label
      then forces the row past the screen and it clips). Put `overflow:"hidden"` on the row, and thin
      out per-item labels (show ~6 max) so they don't collide. Bug history: analytics Weekend-reach /
      New-vs-returning charts (v1.158.x).
   2. **If it genuinely can't shrink (dense data table, full 18-hole strip):** wrap it in the shared
      `<HScroll>` (`components/hscroll.tsx`) so only that element scrolls. It hides the native scrollbar
      and, only while the content overflows, shows a slim custom scroll-position bar BELOW the content
      (in normal flow, so it never overlaps any text or data); the thumb shows position + how much is
      off-screen and is draggable. Hidden when everything fits. Any new horizontally-scrollable box uses
      `<HScroll>` — don't hand-roll a bare `overflowX:"auto"` div.
   3. **Long tables that can exceed the phone height freeze their header.** Pass `maxHeight` to `<HScroll>`
      (so the box scrolls vertically too) and mark the `thead` cells `position:sticky; top:0` with a
      matching background. The top-left corner cell (also sticky-left) gets the highest z-index, other
      header cells next, sticky body cells lowest — so the header row stays readable while rows scroll
      under it. Applied to the Power Users table (`manage.tsx`); use the same pattern for any new long table.
   Boxes using it today: admin drill table (`manage.tsx`), round-detail hole strip (`round-detail.tsx`).
   Intentional exception: the profile/peer badge shelves are carousels that hide the scrollbar on purpose
   (a half-clipped badge is their swipe cue) — leave them. — CI (`ci/check-global-rules.py` guards the
   scrollRef clamp; `ci/check-chart-overflow.py` flags flex bar-columns missing `minWidth:0`; using
   HScroll for new boxes is manual)
2. **Minimum font size 11px.** No rendered text below 11px anywhere. — CI (`ci/check-min-fontsize.py`)
3. **Real glyphs in JSX text, never literal `\uXXXX` escapes** (·, ›, —, …, ×, ‹, ▼). JS string/template
   literals may use `\u`. — CI (`ci/check-jsx-escapes.py`)
4. **Standard popup close control.** Pop-ups/modals close via a corner `×` button: `background:C.greenMid`,
   30×30, `borderRadius:15`, `fontSize:17`, a real `×` glyph. Every popup MUST have a visible, always-
   reachable dismiss (the `×`), and MUST NOT dismiss itself on scroll or an incidental gesture. If a
   dimming backdrop is used behind a *scrollable* sheet, the backdrop must not close on tap (a scroll that
   ends on it reads as a tap and dismisses the sheet) — dismiss via the `×` only. Bug history: admin "who"
   drill sheet closed on scroll (v1.160.x). — manual
5. **Deliberate name-list order.** Any list of people has an intentional order (default alphabetical).
   If the right order is unclear, ask before shipping. — manual

## Roles / admin (be explicit — never just "admin")
6. **System admin ≠ club admin.** Always label them distinctly in UI, confirms, and audit text:
   "system admin" (app-wide, `profiles.is_admin`) vs "club admin" (per-club role). — manual
7. **Owner model.** Exactly one owner (`profiles.is_owner`, seeded to Amit). Only the owner can add or
   remove system admins (promote AND demote); the owner cannot be demoted; no one can change their own
   admin status. All role changes are audit-logged. — enforced in `admin_set_system_admin` (DB)

7b. **Audit log shows names, not emails.** Activity-log entries display the actor's `display_name`
   (resolved centrally in `lib/activity.ts` from `actor_id`), never their email. — code (logActivity)

## Data safety
8. **Never blank a screen on a query error.** A failed/empty query must not delete data or drop the user
   onto a blank/new screen. Degrade gracefully (keep prior state, show a message). — manual
9. **Yardages on every scorecard.** Per-hole yardages show on ALL scorecards (entry, read-only, game
   group card, round detail, share), based on each player's chosen tee
   (`favorite_courses.data.tees[].yardages`). — manual

## Engineering / process
10. **Diagnose root cause before patching.** Prefer robust, first-principles fixes; design for known
    cross-environment tensions (installed PWA vs browser viewport) up front. — manual
11. **Mock before visual changes; confirm before big/DB/risky/privacy-semantic changes.** — manual
12. **Reuse check before building.** Look for an existing helper/component before adding a new one. — manual
13. **Versioning.** Format is `FEATURE.EDIT.YYMMDD` (e.g. `165.1.260714`). **FEATURE** bumps on a new
    feature; **EDIT** is the refinement/fix counter within that feature and **resets to 0 when FEATURE
    bumps**; **YYMMDD** is the release date in **US/Eastern** (the app's canonical tz — not UTC).
    **Bump EDIT on every ship, even two on the same day**, so two builds on one date never collide to the
    same string (the date is "when," FEATURE.EDIT is "which"). This is valid semver (three non-negative
    integers), so npm/`write-version.mjs` accept it unchanged. History note: versions ≤ `1.165.0` used the
    old `1.MINOR.PATCH` semver (the leading `1` never moved); the scheme changed right after `1.165.0`. — manual
14. **Every migration self-records.** As of 0113 there is a `schema_migrations` ledger. Every migration
    from 0113 onward MUST end with `select record_migration('NNNN_filename');` as its last statement, so
    the DB keeps its own logbook of what ran. Confirm applied state anytime with
    `select id, applied_at from public.schema_migrations order by id;` — this is the source of truth, not
    the manual MIGRATIONS.md checklist. Never assert a migration is/isn't applied from the checklist alone. — manual
14. **Every migration's full SQL is printed inline in chat** for copy-paste into the Supabase SQL editor,
    and tracked in `MIGRATIONS.md` (tick when run). — manual
15. **Repo docs stay in sync each bundle:** DEPLOY_NOTES.md, SCHEMA.md, BACKLOG.md, README.md,
    MIGRATIONS.md, and this file. — manual
16. **Line endings:** repo text is CRLF, except everything under `ci/` and `.github/` and
    `marketing/onepager-content.txt`, which are LF. — manual (build normalizes)

## Deploy flow
Cumulative `.zip` → unzip to `C:\dev\fairway-web` → GitHub Desktop commit → Vercel auto-deploy →
run any new migration manually in the Supabase SQL editor (see MIGRATIONS.md).
17. **Charts must fit their data to the space.** Before shipping any chart, look at the actual values and set the axis to the best fit — never leave a chart cramped or dominated by one bar. For trend/line charts fit the y-axis to the data range (use `niceDomain` in dashboard.tsx, or AdaptiveTrend which now self-fits when no `domain` is passed); pct stats clamp 0–100. For count bar charts the bars start at 0 but the chart must be tall enough that small bars read as bars, not slivers (min ~150px) — if the fit is still poor, make the chart larger rather than leaving it. Guard flat series (span 0). This is a default, not a per-chart request — don't wait to be told a chart looks wrong. — manual
