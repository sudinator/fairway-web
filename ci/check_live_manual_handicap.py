#!/usr/bin/env python3
"""
Any SQL that computes a player's playing handicap must prefer a MANUAL course handicap.

A manual figure is authoritative: entered for this course and this hole count, never re-derived
(0153). lib/game-shape.chBasis honours that on the client. The two public RPCs did not — they
derived from index, slope and rating whenever those were present, which for a player with a
handicap index is always. The entered number was silently discarded: a manual 12 scored as 18.87,
on the share page and on the Cup page (fixed in 0155).

The failure is invisible: the strokes are plausible, just wrong.

    python3 ci/check_live_manual_handicap.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent


def latest_bodies() -> dict:
    """The LAST definition of each function, since only that survives a rebuild."""
    fn_re = re.compile(r"create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)\s*\(", re.I)
    latest = {}
    files = sorted((ROOT / "supabase" / "migrations").glob("*.sql")) + sorted((ROOT / "migrations").glob("*.sql"))
    for f in files:
        src = f.read_text(encoding="utf-8", errors="replace")
        marks = [(m.start(), m.group(1).lower()) for m in fn_re.finditer(src)]
        for k, (pos, name) in enumerate(marks):
            end = marks[k + 1][0] if k + 1 < len(marks) else len(src)
            latest[name] = (f.name, src[pos:end])
    return latest


def main() -> int:
    fails = []
    checked = 0
    for name, (fname, body) in latest_bodies().items():
        code = re.sub(r"--[^\n]*", " ", body)
        if "'ch'" not in code and "handicap_index" not in code:
            continue
        # Only functions that actually DERIVE a playing handicap are in scope.
        if "slope" not in code or "113" not in code:
            continue
        checked += 1
        if "course_handicap_source" not in code:
            fails.append(f"{name} (latest in {fname}): derives a handicap from index/slope/rating "
                         f"without preferring a manual course_handicap — a manual figure is ignored")
            continue
        # The manual branch must come BEFORE the derivation, or the derivation wins.
        manual_at = code.index("course_handicap_source")
        derive_at = code.index("113")
        if manual_at > derive_at:
            fails.append(f"{name} (latest in {fname}): the manual branch comes AFTER the derivation, "
                         f"so the derivation still wins")

    print(f"live manual handicap: {checked} handicap-deriving function(s) checked")
    for x in fails:
        print("FAIL", x)
    if checked == 0:
        print("FAIL found no handicap-deriving SQL — guard is miswired")
        return 1
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
