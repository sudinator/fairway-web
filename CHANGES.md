# Display Rules — Drop 1 · docs, guards, and locked decisions

**Base:** `fairway-web-staging` @ **177.58.260816**
**Suggested version:** `177.59.260818`
**Risk:** low — cosmetic and additive. **No migrations. No schema, RLS or RPC changes.**

Verified on the modified tree:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **rc 0** |
| `npm run lint:hooks` | **rc 0** |
| `npm run guards` (51 → 54 checks) | **rc 0** |
| `npm test` | **rc 0** |
| `npm run build` | **rc 0** |

The change set below was produced by diffing against your upload, so it is provably complete —
nothing else in the tree was touched. `public/sw.js`, `lib/app-version.ts` and
`public/app-version.json` were restored to their shipped values after the local build stamped them,
and are **not** in this drop.

---

## 1 · New files (7)

### `DISPLAY_RULES.md`
The standalone visual specification. Ten parts: the two surface families and when each applies,
the surface-bound text-colour rule, gold semantics, the five scales, mandatory components, a manual
audit checklist, a decision tree, code hazards, and a known-debt register. Written so someone who
was not part of the design conversation can audit a screen they did not write and build a new one
correctly.

APP_RULES #25/#26 are the short enforceable statements; this is the long form with the reasoning
and the worked examples.

### `ci/check-design-scale.py` + `ci/design_scale_baseline.json`
Ratchets `borderRadius`, `padding` and `fontSize` against the allowed sets in DISPLAY_RULES Part 5.
**1,680 off-scale uses frozen.** New ones fail the build; improvements must be committed as a
lowered baseline so cleanup cannot silently reverse. `borderRadius: 20` and `24` are held out
pending a per-site decision — they are real corners, not clamped pills.

### `ci/check-palette-closure.py` + `ci/palette_baseline.json`
Every `background:` hex literal must be a member of `C` in `lib/golf.ts` or explicitly allowlisted.
**122 off-palette uses across 58 values frozen.** The guard parses `lib/golf.ts` at runtime, so it
can never drift from the real token values. Allowlist: `#DC2626` (TEST-MODE frame),
`#003087`/`#3D95CE` (PayPal/Venmo brand marks), `#5AA9E6`/`#E8934F` (team identity).

### `ci/check-overlay-contract.py` + `ci/overlay_baseline.json`
Two checks. **Zero-tolerance:** the `undefined`-override pattern (see §2.2) — a rendering bug, never
grandfathered. **Ratcheted:** hand-rolled `position:"fixed"` overlays that bypass `<BottomSheet>`;
**8 frozen.**

> All three guards were negative-tested: each was deliberately violated, confirmed to fail with a
> useful message, then restored and confirmed to pass. A guard that cannot fail is decoration.

---

## 2 · Modified files (8)

### 2.1 `components/ui.tsx` — behavioural + cosmetic
- `inputStyle` background `C.card` → `C.cream`. One edit; affects **every editable field in the
  app**. A field should read as a filled-in slot, not a sheet of paper. *(DISPLAY_RULES Part 2)*
- `borderRadius: 99` → `999` (1 site). **Zero pixel change** — CSS clamps radius to half the box,
  so on a 6px dot both render identically. Removes a second spelling of "pill". *(Part 5)*

**On staging, look at:** any form — Add course, Create game, Profile. Fields should be very
slightly warmer. Nothing should move.

### 2.2 `components/tournaments.tsx` — **bug fix**, plus cosmetic
- **"End game for everyone" was rendering as the browser's default button** — light grey with
  iOS accent-blue text — instead of the intended gold. Cause: `{...btn(!canFinishGroup),
  background: cond ? "#5A1E1E" : undefined, color: cond ? "#fff" : undefined}`. A JS object keeps
  the key with the value `undefined`, which overrides the spread; React then applies no background
  and no colour at all. Invisible to typecheck, lint and the build — it only appears on a device.
  Fixed with a conditional spread. *(Part 9)*
- `borderRadius: 99` → `999` (1 site). No pixel change.

**On staging, look at:** open a game as organizer where you are not the group marker. The
"🔒 End game for everyone" button should now be styled BNN gold, not grey with blue text.

### 2.3 `components/game/organizer-panel.tsx` — **bug fix**
Same `undefined`-override on the "Copy round summary" button, visible after a game ends. Same fix.

**On staging, look at:** end a game, open the organizer panel, find "⧉ Copy round summary". Should
be gold, not grey.

### 2.4 `components/game/scorecard-views.tsx` — cosmetic, no pixel change
`borderRadius: 99` → `999` on 6 stroke dots (5–9px). Identical rendering.

### 2.5 `components/manage/courses.tsx` — cosmetic
Gold now means *someone must act*. Reassurance is `C.sage` metadata.
- `· vetted ★` label: `C.gold` → `C.sage`. Also fixes contrast — `C.gold` on `C.card` measured
  **2.38:1** at 12px, well under the 4.5:1 floor.
- The `★` toggle button that sets vetted: `C.gold` → `C.sage`, so control and label agree.
- `· club edit pending review` **deliberately stays gold** — an admin genuinely has to act. Comment
  added so it is not "cleaned up" later.
- `· ⚑ corrected` was already `C.sage`. Unchanged.

**On staging, look at:** Courses → My Club Courses. The `vetted ★` tag and the ★ button should read
sage-green, not gold. `club edit pending review` should still be gold.

### 2.6 `components/round-setup.tsx` — cosmetic
`· ✓ in your library` : `C.gold` → `C.sage`. Same reassurance-vs-action distinction.

**On staging, look at:** New round → course picker, on a course already in your library.

### 2.7 `components/game/game-list.tsx` — cosmetic
Share code `color: C.green` → `C.cream`. `C.green` as text is cream-surface only: it measures
12.25:1 on `C.card` but **1.54:1** on `C.greenLight` — invisible. The code's job was being the
darkest thing in a light subtitle; on green the equivalent is the brightest thing in a sage
subtitle. *(Part 3)*

> Note: this row is still cream today, so the code currently renders `C.cream` on `C.card` at
> 1.09:1 — **it will be hard to read on staging until the row surface flips green** in Drop 2.
> This is deliberate: fixing it now means the pair changes together rather than the row shipping
> with an invisible code. **If you would rather it stay legible in the interim, say so and I will
> revert this one line and re-apply it with the surface change.**

### 2.8 `package.json`
Three guards appended to `npm run guards`. No other script touched. **Version not bumped** — left
for you.

---

## 3 · Documentation

### `APP_RULES.md` — rules 25 and 26 rewritten
Rule 25 replaces *"Text and surface colours come from the SAME light/dark family"* with
*"Cream is the scorecard. Green is everything else."* — the job-based rule, plus the surface-bound
text-colour clause, gold semantics, and the five scales. Rule 26 covers mandatory components and
the `undefined`-override hazard. Both point to `DISPLAY_RULES.md` for the full spec.

No other rule was modified.

---

## 4 · Suggested DEPLOY_NOTES entry

```
177.59.260818 — Display rules: documentation, guards, and two rendering fixes

FIXES
- "End game for everyone" (tournaments.tsx) and "Copy round summary" (organizer-panel.tsx)
  were rendering as the browser's default button — grey with iOS accent-blue text — because a
  style spread was overridden with `undefined`. Both now render correctly via btn().
  Invisible to typecheck, lint and build; caught only by device inspection.

VISUAL
- Editable fields move from C.card to C.cream app-wide (inputStyle, one definition).
- Gold now strictly means "someone must act". "vetted ★", the ★ toggle, and "✓ in your library"
  move to C.sage. "club edit pending review" stays gold. Also fixes a 2.38:1 contrast failure.
- Games-list share code moves to C.cream (C.green-as-text is cream-surface only).
- borderRadius 99 → 999 on 8 stroke dots. No pixel change.

DOCS + CI
- NEW DISPLAY_RULES.md — the authoritative visual spec, with a manual audit checklist.
- APP_RULES 25/26 rewritten around it.
- NEW ci/check-design-scale.py, check-palette-closure.py, check-overlay-contract.py, all
  ratcheted and wired into `npm run guards` (51 → 54 checks). Baselines: 1,680 off-scale
  geometry uses, 122 off-palette colours, 8 hand-rolled overlays. The undefined-override
  pattern is zero-tolerance.

NO MIGRATIONS. Cosmetic + CI only.
```

---

## 5 · Not done — awaiting your decision

**Drop 2, the screen migration.** Collapsing 1,680 off-scale uses, 122 colour literals, 38 title
treatments and 174 ad-hoc buttons across nearly every screen. Held back deliberately: with the
guards now landed, each screen becomes a reviewable diff that cannot silently reverse, instead of
one commit spanning 60 files. There is still no component test harness — `npm test` is `tsc` +
`node`, no jsdom — so a change that size is verified only by typecheck, build and regex guards.

**Open items carried into DISPLAY_RULES Part 10:**
- `borderRadius: 20` (×6) and `24` (×1) — real corners, need a per-site call
- `components/nav-debug.tsx` and `public/ghin-autofill.js` — orphans; deletion deferred to a
  git-level cleanup because the overlay deploy path cannot remove tracked files
- The `game-list.tsx` share-code interim legibility question in §2.7
