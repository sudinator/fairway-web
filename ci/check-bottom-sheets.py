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
        window = " ".join(lines[max(0, i - 3):i + 7])
        # Decorative, non-interactive overlays (border frames, scrims marked aria-hidden or
        # pointer-events:none) are not popups — they carry no controls to hide behind the nav/notch.
        if 'pointerEvents: "none"' in window or 'aria-hidden' in line:
            continue
        # Compliant if it reserves the bottom safe inset, OR it sits ABOVE the nav (docked at bottom:navH,
        # so the always-visible nav — which already carries the safe inset — is between it and the edge).
        if "env(safe-area-inset-bottom)" not in window and "bottom: navH" not in window and 'bottom: "100%"' not in window:
            violations.append(f"{f.relative_to(ROOT)}:{i+1}  bottom sheet panel without env(safe-area-inset-bottom) (use <BottomSheet> or add it)")
        # A capped sheet MUST cap against the dynamic viewport minus the notch. ANY viewport-relative
        # maxHeight (%, vh, or dvh) that does not subtract env(safe-area-inset-top) lets the panel's top
        # ride up under the notch/status bar — this bit us twice: "82vh" (large-viewport vh) and "100%"
        # (100% of the full-screen fixed overlay). Small fixed-px caps (maxHeight: 280) are fine.
        for mh in re.findall(r'maxHeight:\s*"([^"]+)"', window):
            if re.search(r'(?:%|d?vh)', mh) and "env(safe-area-inset-top)" not in mh:
                violations.append(f"{f.relative_to(ROOT)}:{i+1}  sheet maxHeight '{mh}' doesn't reserve the notch — use calc(100dvh - env(safe-area-inset-top) - 20px)")
                break

if violations:
    print("BOTTOM-SHEET CHECK FAILED - popups not clearing the nav/safe area:")
    for v in violations:
        print("  " + v)
    sys.exit(1)
print("bottom-sheet check passed: all bottom popups clear the safe area")
