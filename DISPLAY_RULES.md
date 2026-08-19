# Birdie Num Num — Display Rules

**Status:** authoritative for all visual work from v177.59 onward.
**Scope:** every `.tsx` under `components/` and `app/`.
**Relationship to APP_RULES.md:** APP_RULES #25 and #26 are the short, enforceable statements of
what is written here. This file is the long form — the reasoning, the worked examples, and the
audit procedure. Where they appear to disagree, APP_RULES wins and this file is the bug.

This document exists because the app was built screen by screen, and each screen quietly invented
its own dialect. As of v177.58 the measured state was:

| | Count |
|---|---|
| Distinct `borderRadius` values | **21** |
| Distinct `padding` strings | **161** |
| Distinct `fontSize` values | **20** |
| Distinct title treatments (size + weight + face) | **38** |
| Card recipes for one component (bg + radius + padding) | **31** |
| Buttons bypassing the `btn()` helper | **174 of 476** |
| Background hex literals outside the palette | **124 uses, 60 distinct values** |

None of these was a bug. Every one was reasonable in isolation. Together they are why the app does
not feel like one product.

---

## Part 1 — How to use this document

**Auditing a screen you did not write:** go to Part 7. It is a checklist you can run by hand in
about ten minutes, and it maps each check to the CI guard that automates it.

**Building something new:** read Parts 2 through 5. If your element is not covered by an existing
token, Part 6 tells you what to do instead of inventing a literal.

**Deciding whether a change is allowed:** Part 8 is the decision tree.

---

## Part 2 — Surface: cream or green

The palette has exactly two families. Which one a surface uses is decided by **what the surface
is**, not by how important it feels or where it sits in the component tree.

### Cream — three cases, and only three

**1 · Scorecards and score entry.**
The hole grid, per-hole cards, the hole-score sheet, the round scorecard table, the public live
card. Surface `C.card` (`#FFFDF6`); text `C.ink`; secondary `C.faint`; dividers `C.line`.

This is the paper-scorecard metaphor, and it is not decorative. Dark-on-light is measurably easier
for dense grids of numerals, and it is the only combination that survives direct sunlight on a
phone at the course — which is where this app is used. Paper scorecards are light for the same
reason.

Reference implementation: `components/game/scorecard-views.tsx`. Copy it rather than re-deriving it.

**2 · Editable fields.**
`inputStyle` in `components/ui.tsx` uses `C.cream` (`#F7F3E8`) — **not** `C.card`. A field should
read as a filled-in slot, not as a sheet of paper. One definition covers every field in the app;
do not set a field background at a call site.

**3 · The outline of a pick control.**
An unselected choice chip is `background: transparent` with a `1.5px solid C.cream` border and a
`C.cream` label. Selected keeps its solid identity colour with `#0E241B` text.

Cream marks *tappable*. Colour marks *chosen*.

> **Never fill an unselected chip with cream.** It then outshines the selected one and the eye
> lands on the option the user did not pick. This was tested against three alternatives; the
> cream-fill version inverted the hierarchy on every screen it appeared on.

### Green — everything else

Lists (rounds, games, courses, players), Money, Insights, Contests, Skins, nav, panels, sheets,
buttons, badges, and the frame *around* a score grid.

Surface `C.green` / `C.greenMid` / `C.greenLight`; text `C.cream`; secondary `C.sage`; dividers
`rgba(255,255,255,.08)` to `rgba(255,255,255,.12)`.

### A cream grid inside a green frame is correct

That is the scorecard, and it is the reference pattern — not a violation. The rule prohibits mixing
families **within one element**, not nesting one inside the other.

```
✅  <div background=C.green>            ← chrome frame
      <span background=C.card color=C.ink>4</span>   ← data cell
    </div>

❌  <div background=C.card color=C.cream>   ← cream on cream, washed out
❌  <div background=C.greenLight color=C.ink>  ← ink on green, washed out
```

---

## Part 3 — Text colour belongs to a surface, not to a meaning

This is the rule people get wrong most often, because a colour keeps its name after the surface
under it changes, and nothing in the code objects.

| Cream-surface only | Green-surface only |
|---|---|
| `C.ink` — primary text | `C.cream` — primary text |
| `C.faint` — secondary | `C.sage` — secondary |
| `C.line` — dividers | `rgba(255,255,255,.08–.12)` — dividers |
| `C.green` used **as text** | — |

`C.gold` is legal on either family, subject to Part 4.

### The worked example

The Games list showed a share code as `color: C.green` bold inside a `C.faint` subtitle, on a
`C.card` row. That measures **12.25:1** — excellent.

Move the row to `C.greenLight` and the same code measures **1.54:1**. Invisible. Nothing in the
code changed; the surface under it did.

### The method: preserve the relationship, not the hex

`C.green` was not doing "being green". It was doing **being the darkest thing in a light
subtitle**, so the code separated from the text around it. On a green row the same job is done by
the brightest thing in a sage subtitle — `C.cream` (**7.29:1**).

> When moving a surface between families, ask what each colour on it was *contrasting against*,
> then reproduce that contrast in the other family. Do not translate hexes one-for-one.

### Known cream-only text still in the tree

Safe today because their surfaces are cream. Each breaks the same way if its surface ever flips:

- `components/game/scoring-views.tsx` — skins totals (32px), per-hole results
- `components/game/leader-row.tsx` — leader points
- `components/manage.tsx` — stat values

---

## Part 4 — Gold means someone must act

Gold is the attention channel. It is **not** "good news", "verified", or "highlighted".

Approximately 51 surfaces already use it correctly: a `C.gold` border or an amber/red wash on a
dark surface. The end-game confirmation is the proof that the system works — maximum urgency, and
correctly rendered in dark red rather than shouting in gold.

### The test

> **If the user does nothing, is anything wrong?**
> No → `C.sage` metadata. Yes → gold.

### Applied at 177.59

| Label | Before | After | Why |
|---|---|---|---|
| `· vetted ★` | `C.gold` | `C.sage` | Reassurance. Nothing to do. Also 2.38:1 on `C.card` — a contrast failure, not just a semantic one |
| `★` toggle (vetted state) | `C.gold` | `C.sage` | Must match the label it controls |
| `· ✓ in your library` | `C.gold` | `C.sage` | Same family as vetted |
| `· ⚑ corrected` | `C.sage` | *(unchanged)* | Already correct |
| `· club edit pending review` | `C.gold` | *(unchanged)* | An admin genuinely has to review it |

### Attention never earns a cream surface

Cream reads as special only while it stays rare. The app is roughly 80% green by surface count,
which is exactly why the scorecard stands out. Spend cream on alerts and you lose the contrast that
makes it work — and cream would then compete with gold and win nothing.

---

## Part 5 — The scales

Five scales. Nothing outside them.

### Radius — 4 values

| Value | Use |
|---|---|
| `999` | pill / fully-rounded — chips, dots, badges |
| `12` | card |
| `10` | control — button, input, chip with a background |
| `6` | inline tag |

**Pill radius is `999`, never `99`.** CSS clamps a corner radius to half the box, so on a 6px dot
both render identically — but two spellings of one intent means the guard needs a permanent
exception and the next person copies whichever they saw first. Normalised across 8 sites at
177.59.

> **Not yet decided:** `borderRadius: 20` (×6) and `24` (×1) are **not** clamped — they are real
> corners on normal-sized cards, so collapsing them to `12` is a genuine visual change. These are
> allowlisted pending a per-site decision. Do not sweep them.

### Padding — 5 values

| Value | Use |
|---|---|
| `13px 16px` | card |
| `11px 20px` | control |
| `8px 12px` | compact control |
| `4px 10px` | tag |
| `16px` | section gap |

From 161 distinct strings. `components/manage.tsx` alone used seven different card paddings.

### Type — 6 steps

| Size | Use |
|---|---|
| `11` | eyebrow, meta |
| `13` | secondary |
| `15` | body, card title |
| `17` | section title |
| `22` | screen title |
| `30+` | display numerals only |

**Weight:** `700` for titles, `400` for body. Not both `700` and `800` for the same job — at 177.58
the card title split 19 files using 15/700 against 23 using 15/800, which reads as sloppiness
rather than hierarchy.

**Face:** Georgia for numerals and screen titles. Sans for everything else. **A 15px card title is
never Georgia.** At 177.58 `leader-row.tsx` used Georgia and `contests-view.tsx` used sans for the
same 16px job.

### Colour

Every surface is a member of `C` in `lib/golf.ts`. Bespoke near-duplicates (`#FBFAF4` two pixels
off `C.card`, `#0E3A2C` three off `C.green`) are drift: they read identically and review as
different.

Allowlisted non-palette colours, and the only ones:

| Hex | Reason |
|---|---|
| `#DC2626` | TEST-MODE frame — deliberately alarming, deliberately not brand |
| `#003087` | PayPal brand mark |
| `#3D95CE` | Venmo brand mark |
| `#5AA9E6` / `#E8934F` | Team 1 / Team 2 identity |

---

## Part 6 — Components are mandatory

| Element | Use | Never |
|---|---|---|
| Button | `btn()` from `ui.tsx` | a hand-rolled `<button style={{background:…}}>` |
| Section header | `<Eyebrow>` | `color: C.gold` + `letterSpacing` by hand |
| Horizontal scroller | `<HScroll>` | a bare `overflowX: "auto"` div |
| Popup | `<BottomSheet>` | `position: "fixed"` + scrim + panel |

**A scrollable sheet must pass `dismissOnBackdrop={false}`.** A scroll gesture that ends on the
scrim reads as a tap and closes the sheet mid-entry. This bug has recurred three times.

### If you need a pattern that does not exist

Add a named token to `C` in `lib/golf.ts`, or a helper in `components/ui.tsx`. **Never a literal at
the call site.** A literal is invisible to review, cannot be changed globally, and will be copied.

---

## Part 7 — Auditing a screen

Run these in order against any screen. Roughly ten minutes by hand.

**1 · Surface family.** Is this a scorecard, score entry, an editable field, or a pick-control
outline? If no → every surface on it is green. If yes → only the qualifying element is cream; its
frame is still green.

**2 · Text colours match the surface.** Grep the file for `C.ink`, `C.faint`, `C.line` and
`color: C.green`. Every hit must sit on a cream surface. Grep for `C.cream` and `C.sage` — every
hit must sit on green.

**3 · Gold audit.** For each `C.gold`: if the user does nothing, is anything wrong? If no, it
should be `C.sage`.

**4 · Scales.** Every `borderRadius` ∈ {999, 12, 10, 6}. Every `padding` ∈ the five strings. Every
`fontSize` ∈ {11, 13, 15, 17, 22, 30+}.

**5 · Components.** Every `<button>` uses `btn()`. Every section header is `<Eyebrow>`. Every
`overflowX` is inside `<HScroll>`. Every overlay is `<BottomSheet>`.

**6 · The `undefined` trap.** Search for `: undefined` inside a style object. See Part 9.

**7 · Contrast.** Any text under 18px needs 4.5:1 against its own background. `C.gold` on
`C.greenLight` is 3.34:1 — it fails, and it is the most common near-miss in the app.

### Automated equivalents

| Check | Guard |
|---|---|
| 4 — scales | `ci/check-design-scale.py` |
| Colour closure | `ci/check-palette-closure.py` |
| 5, 6 — components and the `undefined` trap | `ci/check-overlay-contract.py` |
| Same-element family mixing | `ci/check-contrast.py` *(pre-existing)* |

All run in `npm run guards`. They are **ratcheted**: the current counts are frozen as a baseline,
new violations fail the build, and improvements must be committed as a lowered baseline so the
cleanup cannot silently reverse.

Steps 1, 2, 3 and 7 are **manual**. No regex can tell whether a surface *is* a scorecard.

---

## Part 8 — Decision tree

```
Adding or changing a visual element
│
├─ Is it a scorecard, score entry, an editable field,
│  or the outline of a pick control?
│   ├─ YES → cream (Part 2). Text: C.ink / C.faint. Dividers: C.line.
│   └─ NO  → green. Text: C.cream / C.sage. Dividers: rgba(255,255,255,.08–.12).
│
├─ Does it need attention?
│   ├─ Would something be WRONG if the user ignored it?
│   │   ├─ YES → C.gold border or amber/red wash, on a dark surface
│   │   └─ NO  → C.sage metadata. Not gold. Not cream.
│
├─ Is it a button, header, scroller, or popup?
│   └─ Use btn() / <Eyebrow> / <HScroll> / <BottomSheet>. No exceptions.
│
├─ Do the radius, padding and font size exist in Part 5?
│   ├─ YES → use them
│   └─ NO  → you are inventing a dialect. Use the nearest scale value.
│            If genuinely impossible, add a NAMED TOKEN and note it here.
│
└─ Is any text under 18px below 4.5:1 on its own background?
    └─ Fix it before shipping.
```

---

## Part 9 — Code hazards

### Never override a style spread with `undefined`

```jsx
// ❌ BROKEN — this is what shipped on "End game for everyone"
style={{ ...btn(true), background: cond ? "#5A1E1E" : undefined,
                       color:      cond ? "#fff"    : undefined }}

// ✅ CORRECT
style={{ ...btn(true), ...(cond ? { background: "#5A1E1E", color: "#fff" } : {}) }}
```

A JS object literal keeps the key with the value `undefined`, which overrides the spread. React
then applies **no background and no colour at all**, and the control falls back to the browser
default — light grey with accent-blue text on iOS. `btn()`'s gold is discarded entirely.

This is invisible in source review, invisible to typecheck, and invisible to the build. It only
shows up on a device. Two sites shipped this way: `components/tournaments.tsx` (end-game) and
`components/game/organizer-panel.tsx` (copy round summary). Both fixed at 177.59;
`ci/check-overlay-contract.py` now blocks the pattern.

### Radius above half the box is discarded

`borderRadius: 99` and `999` are identical on anything under ~198px tall. Use `999`.

---

## Part 10 — Known debt

Recorded so audits do not rediscover it.

| Item | Status |
|---|---|
| 161 padding strings → 5 | Ratcheted, migration pending |
| 21 radii → 4 | Ratcheted, migration pending |
| 20 font sizes → 6 | Ratcheted, migration pending |
| 38 title treatments → 1 per role | Manual, migration pending |
| 174 buttons bypassing `btn()` | Ratcheted, migration pending |
| 124 off-palette background hexes | Ratcheted, migration pending |
| `borderRadius: 20` ×6, `24` ×1 | **Undecided** — real corners, needs a per-site call |
| `components/nav-debug.tsx` | Orphan. Imported nowhere. Deletion deferred — the overlay deploy path cannot remove tracked files; needs a git-level cleanup |
| `public/ghin-autofill.js` | Orphan. Referenced nowhere, but **served publicly** at `/ghin-autofill.js` because Next serves all of `public/`. Inert — contains no credentials. Same deletion constraint |
| No component test harness | `npm test` is `tsc` + `node`, no jsdom. No component has ever been executed in a test. Every visual change is verified only by typecheck, build, and regex guards. This is the ceiling on how safely the migration can proceed |
