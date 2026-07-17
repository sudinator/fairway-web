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
    same string (the date is "when," FEATURE.EDIT is "which"). **The YYMMDD segment is auto-stamped at
    build time from the Eastern date by `scripts/write-version.mjs` — you only maintain FEATURE.EDIT in
    package.json; whatever date is written there is a placeholder the build overrides, so it's always the
    real ship date and never hand-typed.** This is valid semver (three non-negative integers), so
    npm/`write-version.mjs` accept it unchanged. History note: versions ≤ `1.165.0` used the
    old `1.MINOR.PATCH` semver (the leading `1` never moved); the scheme changed right after `1.165.0`. — manual
14. **Every migration self-records.** As of 0113 there is a `schema_migrations` ledger. Every migration
    from 0113 onward MUST end with `select record_migration('NNNN_filename');` as its last statement, so
    the DB keeps its own logbook of what ran. Confirm applied state anytime with
    `select id, applied_at from public.schema_migrations order by id;` — this is the source of truth, not
    the manual MIGRATIONS.md checklist. Never assert a migration is/isn't applied from the checklist alone. — manual
15. **Section-header spacing is standardized.** All section/eyebrow headers use the shared `<Eyebrow>`
    component (components/ui.tsx), which carries the app benchmark spacing (`marginTop:16, marginBottom:8`)
    by default. Don't hand-roll header `<div>`s with ad-hoc margins, and don't zero out the spacing — pass
    a `style` override only for a deliberate exception. This keeps vertical rhythm consistent across every
    screen; new screens get it for free by using `<Eyebrow>`.
    - **Tile headers** (the gold, letter-spaced label at the top of a card/tile) ARE `<Eyebrow>`. When the
      header sits in a flex ROW with a control (e.g. a chevron on a collapsible tile), pass
      `style={{ margin: 0 }}` so the row alignment holds and the tile's own padding provides spacing.
    - Distinct patterns that are NOT tile headers stay as they are: e.g. the dashboard's sage
      section-divider (`sectionHead`, a label with a rule line), status pills, badge chips, table column
      headers, and banners. Consistency means "same pattern rendered the same way," not "make everything
      an Eyebrow." Cleanup is being done screen-by-screen; converting a screen means folding its genuine
      tile/section headers onto `<Eyebrow>` while leaving lookalikes alone. — manual
16. **Date inputs must be iOS-safe.** A bare `<input type="date">` renders inconsistently on iPhone
    (missized/clipped/invisible chrome) — a known, recurring bug. Always use the shared `<ShortDateInput>`
    (components/ui.tsx) or, for a full-width field, a raw input whose style includes
    `WebkitAppearance:"none"` (and `appearance:"none"`). Enforced by `ci/check-date-inputs.py`. — manual
17. **Know the perimeter; every popup is POSITIONED inside it.** The screen has a safe usable rectangle —
    inside the notch on top (`env(safe-area-inset-top)`), the tab bar + iOS home indicator on the bottom
    (`72px + env(safe-area-inset-bottom)`), and the side insets — with a small margin off every edge. This
    rectangle is knowable exactly (the red TEST-MODE frame, #20, proves it). Every popup — bottom sheet,
    modal, menu — is built by positioning a bounds box to that rectangle and docking the card inside it, so
    the card's edges are POSITIONED to the perimeter. The card's max size is the perimeter; if content is
    taller it fills the rectangle and scrolls internally. **Never size a popup by height math** — no
    `maxHeight: NNvh`, no fraction of the RAW screen, no "screen minus computed height" leftover. Those
    ignore the notch/nav and are exactly what kept clipping the top under the notch.
    **Use the one primitive:** `<BottomSheet>` (components/ui.tsx) encodes the perimeter once — a scrim + a
    bounds box (`position:fixed; top: calc(env(safe-area-inset-top)+margin); bottom: calc(72px +
    env(safe-area-inset-bottom)+margin); left/right: margin`) with the card docked inside (`flex:"0 1 auto";
    minHeight:0`) and an optional sticky `header` above a scrolling body (`flex:1; minHeight:0; overflowY`).
    Every new popup uses it; don't hand-roll a `position:fixed; inset:0` sheet. Props: `header`, `panelStyle`,
    `bodyStyle`, `maxWidth`, `margin`, `scrim`, `dismissOnBackdrop`.
    Enforced by `ci/check-bottom-sheets.py`: bottom-docked panels must reserve `env(safe-area-inset-bottom)`
    and must not cap with a viewport-relative `maxHeight` (`%`/`vh`/`dvh`) that omits `env(safe-area-inset-top)`.
    — manual
18. **Every popup/menu needs a visible way to close it, and pop-up menus keep the nav visible.** Any
    overlay must offer an explicit close control (a `×`, a "Close"/"Done" button) — backdrop-tap alone is
    not enough (it's undiscoverable). Menus that extend the bottom nav (e.g. the "More" sheet) dock ABOVE
    the nav (`bottom: navH`, the measured nav height) so the nav stays visible and usable underneath; they
    don't cover it. Full-screen detail sheets may cover the screen but must have a visible Close. — manual
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
19. **Money settles per BUCKET, each a self-contained world; the Club is a read-only rollup (v173).**
    A Bucket (the renamed "event", table still `group_events`) nets its own expenses among its members and
    is settled via the "Fewest payments" view WITHIN that Bucket — `bucketTransfers`/`bucketSettled`, and
    every settlement carries its Bucket's `event_id` (NOT NULL). Nothing reroutes across Buckets. "Settled"
    means net-square within the Bucket (no `$X of $Y` figure). The Club scoreboard shows each member's net
    across all Buckets (`clubRollup`, == `computeBalances`) plus the per-Bucket breakdown, even at net-zero.
    Guests always resolve to their sponsoring member within each Bucket. Superseded the club-level-only
    model that shipped in 172.x. — manual
20. **Fixed, full-viewport frames/borders must respect the top safe area (the notch).** A `position:fixed`
    element anchored to the top edge (`inset:0` or `top:0`) that draws a visible `border` will paint that
    border edge-to-edge behind the notch/status bar — the bottom looks fine (it tucks behind the nav), so
    the bug hides in plain sight. This has recurred (the TEST-MODE frame). Anchor the top with
    `env(safe-area-inset-top)` instead of pinning to 0 (e.g. `top: "env(safe-area-inset-top, 0px)", left:0,
    right:0, bottom:0`), and let any label/tab hang from that edge. Full-screen scrims (background only, no
    border) are exempt — they SHOULD cover the whole screen, notch included. Same `env(safe-area-inset-top)`
    principle bottom sheets use to cap their height (#17). Enforced by `ci/check-safe-area-frames.py`; all
    UI guards now run in CI via `npm run guards` (font size, global rules, chart overflow, date inputs,
    bottom sheets, safe-area frames). — manual
