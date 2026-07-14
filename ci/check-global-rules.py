#!/usr/bin/env python3
"""Guard the machine-checkable global rules in APP_RULES.md.

Currently enforces:
  Rule 1 — no horizontal page scroll: the app's single inner scroll container in components/home.tsx
  must set overflowX:"hidden" (alongside overflowY:"auto"). This stops the whole page drifting
  left/right; wide content must scroll inside its own local box instead.

Add more checks here as global rules become statically checkable. Exit non-zero on any violation.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
fails = []

home = (ROOT / "components" / "home.tsx").read_text(encoding="utf-8")
# Find the scrollRef container's style and confirm both axes are set correctly.
m = re.search(r'ref=\{scrollRef\}\s+style=\{\{([^}]*)\}\}', home)
if not m:
    fails.append("home.tsx: could not find the scrollRef scroll container.")
else:
    style = m.group(1)
    if 'overflowY: "auto"' not in style:
        fails.append("home.tsx scrollRef: expected overflowY:\"auto\".")
    if 'overflowX: "hidden"' not in style:
        fails.append("home.tsx scrollRef: missing overflowX:\"hidden\" — Rule 1 (no horizontal page scroll).")

if fails:
    print("GLOBAL-RULE VIOLATIONS:")
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("global-rules: pass")
