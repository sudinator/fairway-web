#!/usr/bin/env python3
"""Component + overlay contract — DISPLAY_RULES.md Parts 6 and 9.

Two classes of defect, both invisible to typecheck, lint and the production build, and both of
which have actually shipped:

  1. The `undefined` override. `{...btn(true), background: cond ? X : undefined}` keeps the key
     with the value undefined, which overrides the spread. React then applies NO background and NO
     colour, and the control falls back to the browser default — light grey with accent-blue text
     on iOS. This shipped on "End game for everyone" and on "Copy round summary". Nothing caught it
     because the source reads as though it sets a colour, and it compiles perfectly.
     ZERO TOLERANCE — this is a rendering bug, not a style preference.

  2. Hand-rolled overlays. A `position:"fixed"` scrim plus panel that is not a <BottomSheet>
     bypasses the safe-area perimeter, the standard corner close control, and the backdrop policy.
     A scrollable sheet whose backdrop closes on tap loses the user's input when a scroll gesture
     ends on the scrim — a bug that has recurred three times.
     Ratcheted, because the existing hand-rolled overlays need converting one at a time.

    python3 ci/check-overlay-contract.py            # check
    python3 ci/check-overlay-contract.py --update   # rewrite the overlay baseline
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "ci" / "overlay_baseline.json"
ROOTS = ("components", "app")

# `background: x ? A : undefined` — or any style key resolved to undefined after a spread.
UNDEF = re.compile(
    r"\{\s*\.\.\.\s*(?:btn\([^)]*\)|inputStyle|\w+Style)[^{}]*?"
    r"\b(background|color|border|borderRadius|padding)\s*:\s*[^,}]*?\bundefined",
    re.S,
)


def sources():
    for r in ROOTS:
        yield from sorted((ROOT / r).rglob("*.tsx"))


def rel(p):
    return str(p.relative_to(ROOT))


undef_hits, overlays = [], {}

for f in sources():
    t = f.read_text(encoding="utf-8", errors="replace")

    for m in UNDEF.finditer(t):
        undef_hits.append(f"{rel(f)}:{t[:m.start()].count(chr(10)) + 1}  "
                          f"`{m.group(1)}` resolved to undefined after a style spread")

    # Hand-rolled overlay: a fixed element carrying a scrim, not rendered by BottomSheet.
    n = 0
    for m in re.finditer(r'position:\s*"fixed"', t):
        window = t[m.start():m.start() + 1400]
        before = t[max(0, m.start() - 300):m.start()]
        if "BottomSheet" in before or "BottomSheet" in window:
            continue
        if not re.search(r"rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)", window):
            continue          # no scrim — a banner or badge, not an overlay
        if "inset: 0" not in window and "inset:0" not in window:
            continue
        n += 1
    if n:
        overlays[rel(f)] = n

failed = False

# ── 1. zero tolerance ────────────────────────────────────────────────────────
if undef_hits:
    failed = True
    print("OVERLAY CONTRACT FAILED — style spread overridden with `undefined`:")
    for h in undef_hits:
        print("  " + h)
    print("\n  A key set to undefined OVERRIDES the spread. React applies nothing and the control")
    print("  falls back to the browser default button — grey with accent-blue text.")
    print("  Fix:  {...btn(true), ...(cond ? { background: X, color: Y } : {})}")
    print("  See DISPLAY_RULES.md Part 9.\n")

# ── 2. ratcheted ─────────────────────────────────────────────────────────────
if "--update" in sys.argv:
    if undef_hits:
        print("Refusing to update the baseline while zero-tolerance violations exist.")
        sys.exit(1)
    BASELINE.write_text(json.dumps(overlays, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {BASELINE.relative_to(ROOT)} — {sum(overlays.values())} hand-rolled overlay(s) frozen.")
    sys.exit(0)

if not BASELINE.exists():
    print(f"Missing {BASELINE.relative_to(ROOT)} — run: python3 ci/check-overlay-contract.py --update")
    sys.exit(1)

base = json.loads(BASELINE.read_text(encoding="utf-8"))
reg, imp = [], []
for k in sorted(set(base) | set(overlays)):
    was, is_ = base.get(k, 0), overlays.get(k, 0)
    if is_ > was:
        reg.append(f"{k}: {was} -> {is_} (+{is_ - was})")
    elif is_ < was:
        imp.append(f"{k}: {was} -> {is_} (-{was - is_})")

if reg:
    failed = True
    print("OVERLAY CONTRACT FAILED — new hand-rolled overlay(s):")
    for r in reg:
        print("  " + r)
    print("\n  Use <BottomSheet>. It owns the safe-area perimeter, the standard corner close")
    print("  control, and the backdrop policy. Pass dismissOnBackdrop={false} if the body scrolls.")

if failed:
    sys.exit(1)

if imp:
    print("OVERLAY CONTRACT: overlays were converted — commit the lower baseline:")
    for i in imp:
        print("  " + i)
    print("\nRun: python3 ci/check-overlay-contract.py --update")
    sys.exit(1)

print(f"overlay contract: PASS (0 undefined-overrides; "
      f"{sum(overlays.values())} known hand-rolled overlay(s), none new)")
