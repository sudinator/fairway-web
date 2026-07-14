# Birdie Num Num — Global App Rules

The standing invariants for this app. These apply everywhere unless a rule explicitly scopes
itself. "CI" = automatically checked by a script in `ci/` (run during every release build); "manual"
= reviewed by hand. Keep this file in sync when a new global rule is agreed.

## UI / layout
1. **No horizontal page scroll — app-wide.** The page never drifts left/right. The single inner
   scroll container (`components/home.tsx`, `scrollRef`) is `overflowY:auto` + `overflowX:hidden`.
   Content that is legitimately wider than the phone (e.g. a dense data table) must live in its OWN
   `overflowX:auto` box so only that element scrolls — never the page. Charts/rows must resize to fit
   the viewport, not force the page wider. — CI (`ci/check-global-rules.py`)
2. **Minimum font size 11px.** No rendered text below 11px anywhere. — CI (`ci/check-min-fontsize.py`)
3. **Real glyphs in JSX text, never literal `\uXXXX` escapes** (·, ›, —, …, ×, ‹, ▼). JS string/template
   literals may use `\u`. — CI (`ci/check-jsx-escapes.py`)
4. **Standard popup close control.** Pop-ups/modals close via a corner `×` button: `background:C.greenMid`,
   30×30, `borderRadius:15`, `fontSize:17`, a real `×` glyph. — manual
5. **Deliberate name-list order.** Any list of people has an intentional order (default alphabetical).
   If the right order is unclear, ask before shipping. — manual

## Roles / admin (be explicit — never just "admin")
6. **System admin ≠ club admin.** Always label them distinctly in UI, confirms, and audit text:
   "system admin" (app-wide, `profiles.is_admin`) vs "club admin" (per-club role). — manual
7. **Owner model.** Exactly one owner (`profiles.is_owner`, seeded to Amit). Only the owner can add or
   remove system admins (promote AND demote); the owner cannot be demoted; no one can change their own
   admin status. All role changes are audit-logged. — enforced in `admin_set_system_admin` (DB)

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
13. **Versioning.** New feature = MINOR bump; refinement/fix = PATCH. — manual
14. **Every migration's full SQL is printed inline in chat** for copy-paste into the Supabase SQL editor,
    and tracked in `MIGRATIONS.md` (tick when run). — manual
15. **Repo docs stay in sync each bundle:** DEPLOY_NOTES.md, SCHEMA.md, BACKLOG.md, README.md,
    MIGRATIONS.md, and this file. — manual
16. **Line endings:** repo text is CRLF, except everything under `ci/` and `.github/` and
    `marketing/onepager-content.txt`, which are LF. — manual (build normalizes)

## Deploy flow
Cumulative `.zip` → unzip to `C:\dev\fairway-web` → GitHub Desktop commit → Vercel auto-deploy →
run any new migration manually in the Supabase SQL editor (see MIGRATIONS.md).
