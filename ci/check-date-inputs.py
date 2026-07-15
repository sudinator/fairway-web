#!/usr/bin/env python3
"""
Date-input compliance guard.

Known iOS bug: a bare <input type="date"> renders inconsistently on iPhone (wrong
size, clipped, or invisible native chrome). The app has two compliant patterns:
  1. The shared <ShortDateInput> component in components/ui.tsx (styled display over
     a transparent native picker) — always preferred.
  2. A raw <input type="date"> that neutralizes native chrome with
     WebkitAppearance:"none" (and appearance:"none"), inline OR via a style const that
     carries the workaround.

Fails otherwise. components/ui.tsx is exempt (ShortDateInput's transparent overlay).
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPONENTS = ROOT / "components"
EXEMPT = {"ui.tsx"}

violations = []
for f in sorted(COMPONENTS.glob("*.tsx")):
    if f.name in EXEMPT:
        continue
    text = f.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    compliant_vars = set(
        m.group(1) for m in re.finditer(r"(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*\{[^\n]*WebkitAppearance", text)
    )
    for i, line in enumerate(lines):
        if 'type="date"' not in line:
            continue
        window = " ".join(lines[i:i + 4])
        ok = "WebkitAppearance" in window
        if not ok:
            for ref in re.findall(r"style=\{(\w+)\}", window):
                if ref in compliant_vars:
                    ok = True
                    break
        if not ok:
            violations.append(f"{f.relative_to(ROOT)}:{i+1}  raw type=\"date\" without the iOS appearance workaround (use <ShortDateInput> or a style with WebkitAppearance:'none')")

if violations:
    print("DATE-INPUT CHECK FAILED - iOS-unsafe date field(s):")
    for v in violations:
        print("  " + v)
    sys.exit(1)
print("date-input check passed: all date fields are iOS-safe")
