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
      A container that combines `width:"100%"` with padding or a border MUST also use
      `boxSizing:"border-box"`; otherwise its content-box width plus padding extends past the phone.
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
   `HScroll` and the full-width padded-container contract are enforced by
   `ci/check_mobile_fit_contract.py`)
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
9b. **Create Game tee inheritance is draft-only and deterministic.** During Create Game, effective tee priority is **individual player override → one-off flight tee → game default tee**. Changing the game default must not overwrite an explicit flight/player override; changing flights/handicaps may change an inherited flight tee but never an explicit player override. When the game is created, the effective tee is resolved into that player's explicit `tee_name` / `rating` / `slope` / `course_handicap` snapshot; inheritance does not continue after creation. Course changes invalidate all draft tee overrides because tee indexes belong to the selected course. Rating+slope drive course handicap; yardage remains optional metadata. — manual + CI (`ci/check_create_game_tee_inheritance.py`)

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
    don't cover it. Full-screen detail sheets may cover the screen but must have a visible Close. Popups are built on `<BottomSheet>`, which ALWAYS renders a top-right × when given `onClose` — so pass `onClose` and don't hand-roll a popup without it. Enforced by `ci/check-popup-close.py` (every `<BottomSheet>` must pass `onClose`). — manual
19. **Every migration's full SQL is printed inline in chat** for copy-paste into the Supabase SQL editor,
    and tracked in `MIGRATIONS.md` (tick when run). — manual
20. **Repo docs stay in sync each bundle:** DEPLOY_NOTES.md, SCHEMA.md, BACKLOG.md, README.md,
    MIGRATIONS.md, and this file. — manual
21. **Line endings:** repo text is CRLF, except everything under `ci/` and `.github/` and
    `marketing/onepager-content.txt`, which are LF. — manual (build normalizes)

## Deploy flow
Cumulative `.zip` → unzip to `C:\dev\fairway-web` → GitHub Desktop commit → Vercel auto-deploy →
run any new migration manually in the Supabase SQL editor (see MIGRATIONS.md).
22. **Charts must fit their data to the space.** Before shipping any chart, look at the actual values and set the axis to the best fit — never leave a chart cramped or dominated by one bar. For trend/line charts fit the y-axis to the data range (use `niceDomain` in dashboard.tsx, or AdaptiveTrend which now self-fits when no `domain` is passed); pct stats clamp 0–100. For count bar charts the bars start at 0 but the chart must be tall enough that small bars read as bars, not slivers (min ~150px) — if the fit is still poor, make the chart larger rather than leaving it. Guard flat series (span 0). This is a default, not a per-chart request — don't wait to be told a chart looks wrong. — manual
23. **Money settles per BUCKET, each a self-contained world; the Club is a read-only rollup (v173).**
    A Bucket (the renamed "event", table still `group_events`) nets its own expenses among its members and
    is settled via the "Fewest payments" view WITHIN that Bucket — `bucketTransfers`/`bucketSettled`, and
    every settlement carries its Bucket's `event_id` (NOT NULL). Nothing reroutes across Buckets. "Settled"
    means net-square within the Bucket (no `$X of $Y` figure). The Club scoreboard shows each member's net
    across all Buckets (`clubRollup`, == `computeBalances`) plus the per-Bucket breakdown, even at net-zero.
    Guests always resolve to their sponsoring member within each Bucket. Superseded the club-level-only
    model that shipped in 172.x. — manual
24. **Fixed, full-viewport frames/borders must respect the top safe area (the notch).** A `position:fixed`
    element anchored to the top edge (`inset:0` or `top:0`) that draws a visible `border` will paint that
    border edge-to-edge behind the notch/status bar — the bottom looks fine (it tucks behind the nav), so
    the bug hides in plain sight. This has recurred (the TEST-MODE frame). Anchor the top with
    `env(safe-area-inset-top)` instead of pinning to 0 (e.g. `top: "env(safe-area-inset-top, 0px)", left:0,
    right:0, bottom:0`), and let any label/tab hang from that edge. Full-screen scrims (background only, no
    border) are exempt — they SHOULD cover the whole screen, notch included. Same `env(safe-area-inset-top)`
    principle bottom sheets use to cap their height (#17). Enforced by `ci/check-safe-area-frames.py`; all
    UI guards now run in CI via `npm run guards` (font size, global rules, chart overflow, date inputs,
    bottom sheets, safe-area frames). — manual
25. **Cream is the scorecard. Green is everything else.** Full spec, worked examples and the manual
    audit checklist are in **DISPLAY_RULES.md** — read it before any visual work.

    **CREAM, three cases only.** (a) Scorecards and score entry: `C.card` + `C.ink`/`C.faint`/
    `C.line`; reference `components/game/scorecard-views.tsx`. (b) Editable fields: `C.field`
    (#EBE3CC) on `C.fieldLine` (#C4BB9E) via `inputStyle`. (c) The OUTLINE of a pick control:
    transparent + `1.5px solid C.cream`; selected keeps its identity colour. Never FILL an
    unselected chip with cream — it outshines the selected one.

    **GREEN, everything else.** `C.green`/`greenMid`/`greenLight` + `C.cream`/`C.sage` +
    `rgba(255,255,255,.08-.12)` dividers. A cream grid inside a green frame is CORRECT.

    **Text colour belongs to a SURFACE, not a meaning.** `C.ink`, `C.faint`, `C.line` and
    `C.green`-as-text are cream-only. `C.cream`, `C.sage` and the rgba dividers are green-only. A
    colour keeps its name after the surface beneath it changes and nothing in the code objects — at
    177.58 there were 62 sites where a token sat on the wrong family, the worst at 1.83:1 and 2.24:1.
    Preserve the RELATIONSHIP, not the hex: ask what a colour was contrasting against, then
    reproduce that contrast in the other family.

    **Measure, do not eyeball.** `C.faint` and `C.sage` were both marginally under 4.5:1 on their own
    home surfaces across 405 sites — nobody had ever measured them. Every text/background pair must
    reach WCAG 2.1: 4.5:1 normal, 3:1 for >=18px or >=14px bold. Two cautionary cases from 177.59,
    both of which LOOKED like improvements: moving `vetted ★` from gold (2.38:1) to `C.sage` on a
    cream row made it 1.83:1, and moving the share code to `C.cream` on a cream row made it 1.09:1.

    **Gold means SOMEONE MUST ACT.** Not "verified", not "good news". Test: if the user does nothing,
    is anything wrong? No -> secondary metadata in the surface's own token. Attention never earns a
    cream surface; cream reads as special only while it stays rare.

    **Scales (DISPLAY_RULES Part 5).** Radius {999, 12, 10, 6} — pill is `999`, never `99`. Padding
    {`13px 16px`, `11px 20px`, `8px 12px`, `4px 10px`, `16px`}. Font {11, 13, 15, 17, 22, 30+};
    weight 700 titles / 400 body; Georgia for numerals and screen titles only. Every surface colour
    is a member of `C` in `lib/golf.ts`; new surfaces get a NAMED token, never a call-site literal.

    Reviewed exceptions: `borderRadius: 20` (x6) and `24` (x1) are real corners awaiting a per-site
    decision. Allowlisted non-palette colours: `#DC2626` (TEST-MODE), `#003087`/`#3D95CE`
    (PayPal/Venmo), `#5AA9E6`/`#E8934F` (team identity). — CI (`ci/check_resolved_contrast.py`,
    `ci/check-design-scale.py`, `ci/check-palette-closure.py`, `ci/check-contrast.py`) + manual

26. **Every popup is a `<BottomSheet>`; every button is `btn()`; every scroller is `<HScroll>`;
    every section header is `<Eyebrow>`.** No hand-rolled `position:"fixed"` scrim + panel.
    **A scrollable sheet must pass `dismissOnBackdrop={false}`** — a scroll ending on the scrim reads
    as a tap and closes the sheet mid-entry.

    **Never override a style spread with `undefined`.** `{...btn(true), background: cond ? X :
    undefined}` sets the key to undefined, which overrides the spread; React then applies no
    background and no colour, and the control falls back to the browser's default button — light
    grey with accent-blue text. Shipped on "End game for everyone" and "Copy round summary",
    invisible to typecheck, lint and build. Use `...(cond ? { background: X, color: Y } : {})`.
    — CI (`ci/check-overlay-contract.py`, zero-tolerance)

## Refactor reachability / boundary integrity (v177.19+)
26. **Byte-identical moves are not enough.** Every stateful extraction must preserve and permanently verify the full chain: entry action/effect -> state/props/parameters/refs/context -> extracted render/call -> outputs/callbacks/state updates -> downstream helpers/APIs/RPCs/database writes -> refresh/cancel/retry/exit. Reactive/effect timing is part of the contract. Use explicit exported prop types and `satisfies` for constructed spread-prop objects. CI must include permanent reachability/characterization checks plus orphan-state/dependency hygiene checks. Unused props/state/imports are boundary-drift warnings. Do not continue modularization while a known reachability defect is unresolved. Pure logic still requires old-vs-new differential testing where practical.
   - **CI severity rule (177.36+):** boundary-drift/technical-debt measurements explicitly documented as warnings are **ADVISORY**: they must execute and report, but findings alone do not make a release undeployable. Security/RLS, database reproducibility/migrations, secrets, TypeScript correctness, unit/differential behavior, build, source-contract/reachability defects, and feature correctness remain **BLOCKING**. Never downgrade a blocking check merely to clear a release; severity changes require an explicit documented rationale.
27. **Release candidates start from the current synchronized baseline.** Before applying a new candidate, `main` and `staging` must be synchronized and the candidate must be built from that exact clean `staging` tree, not from an older release ZIP. Differential review must confirm unrelated current branch changes (especially CI/workflow configuration) are preserved.

## External dependency contract monitoring
28. **External providers are contract-tested dependencies.** Treat every external provider identifier as opaque unless the provider explicitly guarantees a format. Never infer numeric/string structure from historical samples alone.
- For every external API BNN depends on, keep a small set of golden real-world fixtures and a non-destructive scheduled contract check covering endpoint availability, schema/required fields, identifier behavior, and response compatibility.
- Provider contract drift must fail visibly and alert the admin before application code is changed. Diagnose provider drift versus application regression from evidence first.
- When a provider changes identifiers, preserve BNN's internal canonical UUIDs/history and reconcile only the provider-owned identifier/metadata after reviewed matching.

## Environment/source transparency
29. **Staging must be visually unmistakable.** The Vercel `staging` branch renders a persistent yellow safe-area-aware border plus a STAGING marker. Production/main must never render that marker. Keep this contract guarded in CI.
30. **External course data never silently overrides BNN canonical data.** When a provider result resolves to an existing `favorite_courses` record, show stored BNN data as primary and label its source. Keep the fresh provider payload separate, show material differences, and require an explicit user action before loading provider values for review. Existing correction/approval rules remain the write path for material changes.

## Stateful UI observable-outcome contract
31. **Stateful interactions are verified through observable outcomes.** For every new or changed interaction, verify the full chain: user action -> handler -> all directly changed state -> all derived/parallel display state -> visible UI -> callbacks/side effects -> cancel/reverse/re-entry behavior.
- Reachability alone is not sufficient. If a state transition changes the underlying model but leaves independent display state stale, the change is incomplete.
- Inventory independent local display state (for example editable text buffers, selection mode, open/closed state, cached labels) whenever the source model can be replaced or switched.
- Every mode/source switch must have a round-trip test where applicable (A -> B -> A) and prove visible values restore correctly.
- Test evidence must be labeled as MODELLED, EXECUTED, or BROWSER-VALIDATED. A modelled scenario must never be reported simply as PASS for real UI behavior.
- Stateful release verification must include an observable-outcome evidence table for each changed interaction.


## Correction workflow terminal-path rule (177.23+)
32. **Validation-required terminal actions expose their complete path.** When a stateful flow can enter a validation-required terminal action, the UI must expose every required input before submission and the primary CTA must describe the actual terminal action.
- For course provider review, Stored BNN -> Provider review -> reason entry -> Submit for approval -> pending/review outcome is part of the observable-outcome contract; the reverse/cancel path must remain reachable.

## Database reproducibility / security baseline (177.25+)
33. **Production database security must be reproducible from source.** Production being correct is not sufficient: committed migrations must be able to reconstruct the expected schema security contract from a fresh database. Core table RLS flags, policies, grants, and policy helper dependencies must be source-controlled and machine-checked against an authoritative Production export.
- Database migrations are executed as database owner/postgres in the Supabase SQL editor. Application roles (`anon`, `authenticated`, and browser/service clients) must never be relied upon to record or apply schema migrations; `record_migration(text)` is intentionally unavailable to ordinary app roles after 0123.
- Migration ledger checks are semantic, not grep-based: every migration from 0113 onward records its exact filename stem as its final executable statement, and every numbering gap in the committed sequence must be documented.
- Historical migration dependency closure is checked across the entire globally ordered stream, including relation creation/use, repository-defined function use-before-create, policy prerequisites, explicit column-state operations, custom types, and extension ordering. Static closure is a prevention layer; the disposable fresh-database replay remains the authoritative executable proof.
- Historical live schema that pre-dates complete migration capture must be represented explicitly in the source-controlled baseline. The fresh-database gate must assert required compatibility columns after replay, because stored procedure bodies can defer missing-column errors until runtime and therefore migration execution alone is not sufficient proof of schema parity.

34. **Game Control Center edits use one transition policy.** `lib/game-setup-policy.ts` is the single source of truth for organizer setup mutations and returns ALLOW / CONFIRM / BLOCK. Once the first score exists, the competition's structural identity freezes: do not change scored-player team membership, scored/locked tee groups, pairings/foursomes, or individual-vs-team structure. Raw-score reinterpretations that remain deterministic may continue with explicit confirmation (Stableford ↔ Stroke ↔ Individual Skins; Four-ball ↔ Trifecta only with the same foursomes; allowance/scoring-rule changes). A scored player's tee or handicap may be corrected only as an explicit whole-round correction; gross scores are never rewritten. Removing a scored player is blocked — use No-show / Out to preserve played holes. Ended games do not create a bypass: reopen only restores the active-state editor, then the same score-state policy is evaluated again. Course replacement is pre-score only and requires coordinated course/hole/player-tee state; do not implement it as an ordinary field update. `ci/check_game_setup_policy_contract.py` permanently guards the policy/write/UI boundary. — code + CI

22. **Assertion-count baseline changes are deliberate.** When a release intentionally adds or removes test assertions, update `ci/test_assertion_baseline.json` in the same release only after reconciling the counts against the actual test report; never weaken or bypass the ratchet. — CI (`ci/check_test_assertions.py`)
## Alternate Shot scoring surface (178.14)
- Alternate Shot is **one ball per side**. User-facing scorecards must render a side/team as the scoring entity, never duplicated partner rows as separate player scores.
- The score-entry title must use the team/side identity and the canonical side playing handicap; per-hole net uses the side's relative match strokes.
- Alternate Shot has no individual personal scorecard and no individual six-hole/low-net/Stableford side-game leaderboard. Database fan-out to both partner rows is persistence only and must remain invisible as individual scoring.



<!-- 178.25.260830: no global rule change; production migration-parity CI URL hardening only. -->
<!-- 179.3.260902: no global rule change; Cup schedule/scoring contract only. -->
