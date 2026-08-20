#!/usr/bin/env python3
"""Tap-target floor — no button smaller than ~24px tall.

Apple's HIG minimum is 44pt. This app had 30 buttons rendering under 24px, the worst an 18px
band around 11px text — a miss-and-retry on a phone, one-handed, outdoors, which is exactly how
this app gets used. Fixed at 177.71 by raising VERTICAL padding only, so nothing got wider and
nothing wraps.

Height is estimated as fontSize * 1.25 (the line box) + 2 * vertical padding. Buttons inside a
container with alignItems/alignSelf "stretch" are skipped: they fill the parent, so the estimate
does not apply.

Ratcheted rather than absolute, because 152 buttons sit in the 24-31px band. Those are tight but
hittable, and standardising them would move layout across the app for a benefit nobody would
feel — see DISPLAY_RULES on why padding is not prescribed.
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "ci" / "tap_target_baseline.json"
FLOOR = 24


def px(s):
    s = s.strip()
    if s == "0":
        return 0
    m = re.fullmatch(r"(\d+)px", s)
    return int(m.group(1)) if m else None


def scan():
    small = {}
    for d in ("components", "app"):
        for f in sorted((ROOT / d).rglob("*.tsx")):
            t = f.read_text(encoding="utf-8", errors="replace")
            for m in re.finditer(r"<button\b", t):
                w = t[m.start():m.start() + 560]
                pm = re.search(r'padding:\s*"([^"]+)"', w)
                fm = re.search(r"fontSize:\s*(\d+)", w)
                if not pm:
                    continue
                parts = pm.group(1).split()
                if len(parts) != 2:
                    continue
                v, h = px(parts[0]), px(parts[1])
                if v is None or h is None:
                    continue
                ctx = t[max(0, m.start() - 260):m.start()]
                if 'alignItems: "stretch"' in ctx or 'alignSelf: "stretch"' in ctx:
                    continue
                size = int(fm.group(1)) if fm else 14
                if round(size * 1.25 + 2 * v) < FLOOR:
                    small[str(f.relative_to(ROOT))] = small.get(str(f.relative_to(ROOT)), 0) + 1
    return dict(sorted(small.items()))


now = scan()

if "--update" in sys.argv:
    BASELINE.write_text(json.dumps(now, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {BASELINE.relative_to(ROOT)} — {sum(now.values())} button(s) under {FLOOR}px.")
    sys.exit(0)

if not BASELINE.exists():
    print(f"Missing {BASELINE.relative_to(ROOT)} — run with --update")
    sys.exit(1)

base = json.loads(BASELINE.read_text(encoding="utf-8"))
reg = [f"{k}: {base.get(k, 0)} -> {now[k]}" for k in now if now[k] > base.get(k, 0)]
imp = [f"{k}: {base[k]} -> {now.get(k, 0)}" for k in base if now.get(k, 0) < base[k]]

if reg:
    print(f"TAP TARGET FLOOR FAILED — new button(s) under {FLOOR}px tall:")
    for r in reg:
        print("  " + r)
    print("\n  Raise the VERTICAL padding. Leave horizontal alone so nothing gets wider.")
    sys.exit(1)
if imp:
    print("TAP TARGETS: improved — commit the lower baseline:")
    for i in imp:
        print("  " + i)
    sys.exit(1)
print(f"tap targets: PASS ({sum(now.values())} known under {FLOOR}px, none new)")
