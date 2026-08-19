#!/usr/bin/env python3
"""Design-scale ratchet — DISPLAY_RULES.md Part 5.

The app was built screen by screen and each screen invented its own geometry. At 177.58 the
measured state was 21 borderRadius values, 161 padding strings and 20 fontSize values for what is
functionally a handful of roles. That is why the app does not feel like one product.

Collapsing 900+ call sites in one commit is not reviewable, and this project has no component test
harness (npm test is tsc + node, no jsdom), so a sweeping visual change would be verified only by
"it compiles". Instead this guard FREEZES the current per-value counts. New uses of a non-scale
value fail the build; the backlog gets paid down screen by screen, and each improvement must be
committed as a lowered baseline so the cleanup cannot silently reverse.

    python3 ci/check-design-scale.py            # check
    python3 ci/check-design-scale.py --update   # rewrite the baseline (say why in the commit)
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "ci" / "design_scale_baseline.json"
ROOTS = ("components", "app")

# DISPLAY_RULES.md Part 5. Anything outside these is drift.
ALLOWED_RADIUS = {999, 12, 10, 6}
ALLOWED_PADDING = {"13px 16px", "11px 20px", "8px 12px", "4px 10px", "16px"}
ALLOWED_FONTSIZE = {11, 13, 15, 17, 22}          # plus anything >= 30 (display numerals)
DISPLAY_NUMERAL_MIN = 30

# Real corners on normal-sized cards, not clamped pills. Collapsing them to 12 is a genuine
# visual change, so they are held out pending a per-site decision (DISPLAY_RULES Part 10).
RADIUS_PENDING_DECISION = {20, 24}


def sources():
    for r in ROOTS:
        yield from sorted((ROOT / r).rglob("*.tsx"))


def scan():
    rad, pad, fs = Counter(), Counter(), Counter()
    for f in sources():
        t = f.read_text(encoding="utf-8", errors="replace")
        for m in re.findall(r"borderRadius:\s*(\d+)", t):
            v = int(m)
            if v not in ALLOWED_RADIUS and v not in RADIUS_PENDING_DECISION:
                rad[v] += 1
        for m in re.findall(r'padding:\s*"([^"]+)"', t):
            v = m.strip()
            if v not in ALLOWED_PADDING:
                pad[v] += 1
        for m in re.findall(r"fontSize:\s*(\d+)", t):
            v = int(m)
            if v not in ALLOWED_FONTSIZE and v < DISPLAY_NUMERAL_MIN:
                fs[v] += 1
    return {
        "radius": {str(k): v for k, v in sorted(rad.items())},
        "padding": {k: v for k, v in sorted(pad.items())},
        "fontSize": {str(k): v for k, v in sorted(fs.items())},
    }


now = scan()

if "--update" in sys.argv:
    BASELINE.write_text(json.dumps(now, indent=2) + "\n", encoding="utf-8")
    tot = sum(sum(d.values()) for d in now.values())
    print(f"Wrote {BASELINE.relative_to(ROOT)} — {tot} off-scale use(s) frozen.")
    sys.exit(0)

if not BASELINE.exists():
    print(f"Missing {BASELINE.relative_to(ROOT)} — run: python3 ci/check-design-scale.py --update")
    sys.exit(1)

base = json.loads(BASELINE.read_text(encoding="utf-8"))

regressions, improvements = [], []
for cat in ("radius", "padding", "fontSize"):
    b, n = base.get(cat, {}), now.get(cat, {})
    for key in sorted(set(b) | set(n)):
        was, is_ = b.get(key, 0), n.get(key, 0)
        if is_ > was:
            regressions.append(f"{cat} {key!r}: {was} -> {is_} (+{is_ - was})")
        elif is_ < was:
            improvements.append(f"{cat} {key!r}: {was} -> {is_} (-{was - is_})")

if regressions:
    print("DESIGN SCALE RATCHET FAILED — new off-scale values were introduced:")
    for r in regressions:
        print("  " + r)
    print("\nDISPLAY_RULES.md Part 5 lists the allowed values:")
    print(f"  radius   {sorted(ALLOWED_RADIUS, reverse=True)}")
    print(f"  padding  {sorted(ALLOWED_PADDING)}")
    print(f"  fontSize {sorted(ALLOWED_FONTSIZE)} plus >= {DISPLAY_NUMERAL_MIN} for display numerals")
    sys.exit(1)

if improvements:
    print("DESIGN SCALE: debt was paid down — commit the lower baseline so it cannot come back:")
    for i in improvements:
        print("  " + i)
    print("\nRun: python3 ci/check-design-scale.py --update")
    sys.exit(1)

tot = sum(sum(d.values()) for d in now.values())
print(f"design scale: PASS ({tot} known off-scale use(s), none new)")
