#!/usr/bin/env python3
"""Every public route (a page under app/ that renders OUTSIDE the app shell — the share links) must
own its scroll container. html/body are locked for iOS bounce prevention (app/globals.css), so a
public page without `className="live-scroll"` cannot scroll and taps below the fold hit nothing.
Happened at 184.1 (/live) and again at 201.2 (/lineup): this guard makes the second time the last.

A route is "public" if it sits under app/live or app/lineup, or its page (or the view component it
renders) contains the marker comment PUBLIC ROUTE. The check passes if the page file or any
component it imports from @/components contains className="live-scroll".
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIRS = [ROOT / "app" / "live", ROOT / "app" / "lineup"]

def imported_components(src: str):
    for m in re.finditer(r'from\s+"@/components/([\w/-]+)"', src):
        p = ROOT / "components" / (m.group(1) + ".tsx")
        if p.exists():
            yield p

problems = []
checked = 0
for d in PUBLIC_DIRS:
    for page in d.rglob("page.tsx"):
        checked += 1
        src = page.read_text(encoding="utf-8")
        texts = [src] + [p.read_text(encoding="utf-8") for p in imported_components(src)]
        if not any('className="live-scroll"' in t for t in texts):
            problems.append(f"{page.relative_to(ROOT)}: no live-scroll container (page or its components) — html/body are locked, this page will not scroll")

if problems:
    print("public routes scroll: FAIL")
    for p in problems: print("  " + p)
    sys.exit(1)
print(f"public routes scroll: PASS ({checked} public page(s) own their scroll container)")
