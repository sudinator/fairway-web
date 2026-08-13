#!/usr/bin/env python3
from pathlib import Path
import re, sys

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    ROOT / "components/game/organizer-panel.tsx",
    ROOT / "components/game/scorecard-views.tsx",
    ROOT / "components/manage/courses.tsx",
]
pat = re.compile(r'const\s*\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*(?:React\.)?useState\b')
fail=[]
for path in FILES:
    body=path.read_text(encoding="utf-8")
    for value,setter in pat.findall(body):
        vc=len(re.findall(rf'\b{re.escape(value)}\b', body))
        sc=len(re.findall(rf'\b{re.escape(setter)}\b', body))
        if vc <= 1 and sc <= 1:
            fail.append(f"{path.relative_to(ROOT)}: orphan state [{value}, {setter}]")
if fail:
    print("Extracted-state hygiene FAILED")
    print("\n".join("  "+x for x in fail))
    sys.exit(1)
print("Extracted-state hygiene: PASS")
