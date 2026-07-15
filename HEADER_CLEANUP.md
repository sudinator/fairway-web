# Header consistency sweep — agreed plan (execute in ONE pass, not per-screen)

Policy (three tiers; make each tier internally consistent, don't collapse tiers):
- **Tier 1 — Titles**: Georgia serif, cream, bold. Screen titles = 17px. Leave as their own pattern.
- **Tier 2 — Section headers**: the shared `<Eyebrow>` (gold, ls3, 11px, 700, margin 16/8).
  Row-headers sharing a flex row with a control pass `style={{margin:0}}`.
- **Tier 3 — Field labels**: quiet sage uppercase labels bolted to a form control.
  Standardize via a NEW shared `<FieldLabel>` in components/ui.tsx (sage, 11, 800, ls1, marginBottom~5).
- Lookalikes that STAY as-is: status pills, badge chips, table column headers, banners, the dashboard
  sage `sectionHead` divider (label + rule line), data values.
- Enforcement going forward: APP_RULES #15/#16 + `ci/check-date-inputs.py`. (A lint for hand-rolled
  eyebrow-pattern headers is desirable but risks false positives on lookalikes — revisit after the sweep.)

## DONE
- **dashboard** (167.4): "RUNNING HANDICAP INDEX" → Eyebrow; "✦ AI COACH" → Eyebrow style={{margin:0}}
  (row header w/ chevron); sage sectionHead divider left as-is. Awaiting Amit eyeball confirm.
- **ui.tsx** (167.3): Eyebrow default spacing 16/8.

## AGREED, NOT YET CODED
### money.tsx (all tabs) — AGREED
- Convert to `<Eyebrow>`: "Payments recorded" (Settle tab, ~L572); PersonLedger bucket titles
  ("PAYMENTS"/event names, ~L1037, was gold/ls2/800).
- Keep quiet sage (NOT Eyebrow): "Retired" guest sublist divider (~L472).
- New shared `<FieldLabel>` (ui.tsx) + apply to: "Zelle contact" (~L376), "Now a member? (optional)"
  (~L460), "Sponsored by…" (~L791). Fixes 376's odd letterSpacing.
- Tier-1 titles: leave; normalize "Guests" title 16→17 (~L449) to match other screen titles (all 17).
- Leave: CLOSED pill, balance amounts, "All square" status.

### manage.tsx (Admin + Members + Profile + Notifications + Help + Courses) — AGREED
- Convert to `<Eyebrow>`: "WHAT TO NOTIFY ME ABOUT" (Profile/notify, ~L1031); "NOTIFICATIONS"
  (NotificationBell dropdown, ~L2222, was gold ls2/12); admin user-card labels "CLUBS"/"ANALYTICS"/
  "REMOVE FROM APP" (~L2067/2093/2104).
- Leave (intentional lookalikes): color-coded course-diff labels SUBMISSION DETAILS / CURRENT GLOBAL /
  PROPOSED GLOBAL / WHAT CHANGED (~L101-124; faint=current vs gold=proposed cue must survive); table
  column headers (~L863, L2386); badge/status pills (~L3023); Tier-1 title hierarchy (Admin 26 > screen
  h2 22 > tool-card 14-16 — intentional).
- Already correct: Courses headers, YOUR PROFILE, PLAYERS · CURRENT CLUB, HELP header, all ★ADMIN/
  OVERSIGHT/ACTIVITY eyebrows.

### player-card.tsx — AGREED
- Convert to `<Eyebrow>`: "Badges" (~L129), "Recent form" (~L156) — section dividers, standard spacing.
- "Index" (~L119) → `<Eyebrow style={{margin:0}}>` — stat label above the big number; standard look, kept
  tight (no gap from its value). Compact card — eyeball margins once coded.
- Keep: player name title (Georgia 20, Tier 1).

### compare-stats.tsx — AGREED
- Convert all three to `<Eyebrow>`: "HOW IT'S MEASURED" (~L72), "WHAT TO WORK ON" (~L74),
  "WHERE YOU'RE GAINING & LOSING SHOTS" (~L120). Fixes ls1.5/ls2 → standard. No lookalikes/titles.

### home.tsx — AGREED
- Convert to `<Eyebrow>`: "WELCOME" (~L924, was gold ls3/800 → normalize weight to 700). Eyeball spacing
  vs hero headline below once coded.
- Keep: "Account suspended"/"Your access is paused" (Tier-1 error titles); hero headline (Tier 1).
- Leave: TEST MODE banner (lookalike).

### remaining screens — AGREED
- **groups.tsx**: main headers already Eyebrow. No changes (leave "SHARE THIS LINK" faint field-label + "CLUB" row chip).
- **achievements.tsx**: category labels (~L117) → Eyebrow. Keep titles/count.
- **round-detail.tsx**: section headers already Eyebrow. Leave colored semantic callouts (Partial round / FASTEST / A few stats are blank). No changes.
- **round-setup.tsx**: already Eyebrow. Leave shared course-form tee-table labels (L601/602). No changes.
- **feedback.tsx**: already correct (Eyebrow + title + pills). No changes.
- **tee-times.tsx**: ALIGN to standard — drop local `EB` override so headers use default Eyebrow (11/ls3 vs its 12/ls1.8); make screen title "Tee Times" (~L461) Georgia serif (was sans); field labels "Guests" (~L560) + `label()` helper (~L698) → FieldLabel. Leave gold TEE TIME # id tags + stat labels.
- **organizer.tsx**: `railH3` (gold 13/ls1) → align to Eyebrow standard.

## AUDIT COMPLETE — all screens agreed. Execute in one coding pass. (dashboard already shipped 167.4.)

## SHIPPED (167.5.260715) — single coding pass complete
Added shared `<FieldLabel>` (ui.tsx). Converted per agreed plan across money, manage, achievements,
compare-stats, home, player-card, tee-times (dropped local EB override; title → Georgia; labels →
FieldLabel), organizer (railH3 → standard values). Dashboard shipped earlier (167.4). Lookalikes left
as agreed (color-coded diff labels, column headers, pills, banners, title hierarchy, dashboard sage divider).
Going-forward compliance: APP_RULES #15/#16.

## BottomSheet (popup safe-area) migration — started 168.0
Shared `<BottomSheet>` added (ui.tsx): clears nav bar + safe areas. Money sheets patched in place
(paddingBottom/maxHeight). TODO sweep: migrate other screens' bottom-docked sheets to `<BottomSheet>`
(tee-times, manage, round-detail, round-setup, groups, organizer modals). Rule: APP_RULES #17.
