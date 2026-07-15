#!/usr/bin/env python3
"""
Bottom-sheet safe-area guard (APP_RULES #17).

A bottom-docked popup whose content doesn't clear the tab bar + iOS home indicator leaves its last
button hidden behind the nav bar (these are viewport-fixed, so on iOS PWAs they paint over the nav).
Every bottom-docked sheet panel must include env(safe-area-inset-bottom) in its bottom padding — the
shared <BottomSheet> bakes this in.

Heuristic: a "bottom sheet panel" is a style block with position:fixed and either bottom:0 or a
top-rounded corner (borderRadius:"16px 16px 0 0" / borderTopLeftRadius). Such a block must reference
env(safe-area-inset-bottom) within its style (checked over the style line + a few following lines).
components/ui.tsx is exempt (it defines <BottomSheet>, which uses the SHEET_PANEL_BOTTOM constant).
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPONENTS = ROOT / "components"
EXEMPT = {"ui.tsx"}

def is_panel(line):
    if "borderRadius: \"16px 16px 0 0\"" in line or "borderTopLeftRadius" in line:
        return True
    if 'position: "fixed"' in line and re.search(r"bottom:\s*0\b", line):
        return True
    return False

violations = []
for f in sorted(COMPONENTS.glob("*.tsx")):
    if f.name in EXEMPT:
        continue
    lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
    for i, line in enumerate(lines):
        if not is_panel(line):
            continue
        window = " ".join(lines[i:i + 7])
        if "env(safe-area-inset-bottom)" not in window:
            violations.append(f"{f.relative_to(ROOT)}:{i+1}  bottom sheet panel without env(safe-area-inset-bottom) (use <BottomSheet> or add it)")

if violations:
    print("BOTTOM-SHEET CHECK FAILED - popups not clearing the nav/safe area:")
    for v in violations:
        print("  " + v)
    sys.exit(1)
print("bottom-sheet check passed: all bottom popups clear the safe area")
