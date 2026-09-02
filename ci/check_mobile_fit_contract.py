#!/usr/bin/env python3
"""Permanent mobile-fit guard for full-width inline-style boxes and match scrollers."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []

for path in (ROOT / "components").rglob("*.tsx"):
    text = path.read_text(encoding="utf-8")
    # Container-only contract. Form controls commonly spread inputStyle, which already supplies
    # border-box; treating the rest of a dense JSX line as one style object creates false positives.
    for match in re.finditer(r'<div\b[^>]*?style=\{\{(.*?)\}\}', text, re.S):
        style = match.group(1)
        if 'width: "100%"' not in style:
            continue
        if "padding:" not in style and "border:" not in style:
            continue
        if 'boxSizing: "border-box"' not in style:
            line_no = text.count("\n", 0, match.start()) + 1
            errors.append(
                f"{path.relative_to(ROOT)}:{line_no}: full-width padded container must use boxSizing:border-box"
            )

scoring = (ROOT / "components/game/scoring-views.tsx").read_text(encoding="utf-8")
if re.search(r'<div\s+style=\{\{\s*overflowX:\s*"auto"', scoring):
    errors.append("components/game/scoring-views.tsx: match progression must use HScroll")
if scoring.count("<HScroll>") < 2:
    errors.append("components/game/scoring-views.tsx: expected both match progression tables inside HScroll")

if errors:
    print("MOBILE FIT CONTRACT: FAIL")
    for error in errors:
        print(" -", error)
    sys.exit(1)

print("Mobile fit contract: PASS (full-width padded boxes are border-box; match tables use HScroll)")
