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
# 204.0: one progression table (the Ryder table serves team and no-team singles alike), inside HScroll.
# 212.137: that table is the head-to-head card (components/game/head-to-head-card), which singles opens from Details ›.
card = (ROOT / "components/game/head-to-head-card.tsx").read_text(encoding="utf-8")
if card.count("<HScroll>") < 1 or card.count("MATCH PROGRESSION") < 1 or "HeadToHeadCard" not in scoring:
    errors.append("components/game/head-to-head-card.tsx: expected the match progression table inside HScroll, used by scoring-views")

if errors:
    print("MOBILE FIT CONTRACT: FAIL")
    for error in errors:
        print(" -", error)
    sys.exit(1)

print("Mobile fit contract: PASS (full-width padded boxes are border-box; match tables use HScroll)")
