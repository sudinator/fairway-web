#!/usr/bin/env python3
"""
Safe-area frame guard (APP_RULES #19).

A `position:fixed` element that is anchored to the top edge (`inset: 0` or `top: 0`) AND draws a visible
border will paint that top border edge-to-edge BEHIND the notch / status bar. This has bitten us more than
once — most recently the red TEST-MODE frame, whose top line ran under the notch while its bottom tucked
neatly behind the nav. The fix is always the same: anchor the top with `env(safe-area-inset-top)` instead
of pinning it to 0, so the frame (and its border) starts just below the notch.

Rule: a fixed element whose OWN style pins it to the top edge (inset:0 or top:0) and sets a real `border`
(or `borderTop`) must reference `env(safe-area-inset-top)` in that same style. Otherwise the top border
clips under the notch.

Heuristic (deliberately tight to avoid false positives): position:"fixed" + a visible border shorthand +
a top anchor (inset:0 / top:0) must all appear on the SAME style line, and that line must NOT already
reference env(safe-area-inset-top). This targets compact frame overlays (the pattern that recurs) without
touching full-screen scrims (background only, no border — those SHOULD cover the whole screen) or bordered
child elements nested inside a fixed container (their border isn't on the fixed line).
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPONENTS = ROOT / "components"

violations = []
for f in sorted(COMPONENTS.glob("*.tsx")):
    for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines()):
        if 'position: "fixed"' not in line:
            continue
        # a real, visible border on the SAME element (not border:"none", not borderRadius)
        if not re.search(r'\bborder:\s*"(?!none)', line) and 'borderTop:' not in line:
            continue
        top_anchored = bool(re.search(r'\binset:\s*0\b', line) or re.search(r'\btop:\s*0\b', line) or 'top: "0"' in line)
        if not top_anchored:
            continue
        if "env(safe-area-inset-top)" in line:
            continue
        violations.append(f"{f.relative_to(ROOT)}:{i+1}  fixed bordered frame pinned to the top edge — its top border clips under the notch; anchor the top with env(safe-area-inset-top) instead of inset:0/top:0")

if violations:
    print("SAFE-AREA FRAME CHECK FAILED - fixed borders running under the notch:")
    for v in violations:
        print("  " + v)
    sys.exit(1)
print("safe-area frame check passed: fixed bordered frames respect the top notch")
