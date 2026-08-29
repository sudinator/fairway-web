#!/usr/bin/env python3
"""altShotSides is the ONLY place alternate shot side handicaps are computed.

WHY THIS EXISTS
Five bugs in one week were the same shape: one rule, two live implementations, feeding two screens
that then disagreed. The last instance was the Strokes panel (its own inline side calculation,
correct) against the scorecard dots (dotStrokes, returning 0 on a filtered list) — the panel showed
7 strokes while the card showed none.

Guards that look for copied FORMULAS missed these, because the two blocks never looked alike. This
one checks for the INGREDIENTS instead: any file that combines a pair of handicaps for alt_shot
outside lib/game-shape.ts is building a second source.

WHAT IT CHECKS
Outside lib/game-shape.ts (the home) and tests, no source file may both mention alt_shot context and
sum two chBasis/course_handicap values into a side figure. The heuristic: a file containing
"alt" + "Side"/"side" logic with its own `* allowance / 100` or `* (allowance` arithmetic on chBasis.

    python3 ci/check_single_altshot_source.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOME = "lib/game-shape.ts"

failures: list[str] = []
for f in list(ROOT.glob("components/**/*.tsx")) + list(ROOT.glob("lib/**/*.ts")):
    rel = f.relative_to(ROOT).as_posix()
    if rel == HOME or ".test." in rel or rel.endswith(".d.ts"):
        continue
    src = f.read_text(encoding="utf-8")
    code = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    code = re.sub(r"^\s*//.*$", "", code, flags=re.M)
    if "alt" not in code.lower():
        continue
    # A second source needs: chBasis (or course_handicap) feeding its own allowance arithmetic
    # in an alt-shot context. Reading altShotSides' RESULT is fine; recomputing is not.
    recompute = re.findall(r"chBasis\([^)]*\)\s*[*+]", code) + re.findall(r"reduce\([^)]*\+\s*chOf", code)
    if recompute and "altShotSides(" not in code:
        failures.append(
            f"{rel}: computes handicap arithmetic in an alt-shot-aware file without altShotSides.\n"
            "  One rule, two implementations, two screens disagreeing is the pattern behind five\n"
            "  bugs in one week. Compute side handicaps ONLY via altShotSides in lib/game-shape.ts."
        )

if failures:
    print("SINGLE ALT-SHOT SOURCE — violations:\n")
    for x in failures:
        print("  " + x.replace("\n", "\n  "))
        print()
    sys.exit(1)
print("single alt-shot source: PASS (side handicaps computed only in lib/game-shape.ts)")
