#!/usr/bin/env python3
"""
Trifecta singles are computed in exactly ONE place: computeTrifecta.

Until 183.1 the public live share page (app/live/[token]/page.tsx) called computeTrifecta for the
foursome and then threw its singles away, recomputing them with matchStatus() on the raw pair.
matchStatus is count-based, so a single decided 4 & 2 on the 16th kept counting and the public page
rendered "won 4 UP" while Results said "4 & 2" (staging game 641032; lib/live-trifecta-labels.test.ts).

Rule: in any block that renders Trifecta, the singles must come from computeTrifecta's contests.
Concretely — the live page may call matchStatus for the standalone `match` format, but not inside
its Trifecta branch, and every Trifecta leg label must run through the shared trifectaRowState.

    python3 ci/check_trifecta_one_singles_source.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
LIVE = ROOT / "app" / "live" / "[token]" / "page.tsx"
VIEWS = ROOT / "components" / "game" / "scoring-views.tsx"


def trifecta_branch(src: str) -> tuple[str, int]:
    """The live page's Trifecta RENDERING block only.

    Both the standings calculator and MatchupsBlock name their result `tri`, so anchor inside
    MatchupsBlock and stop at the next top-level function. Returns (text, offset) so reported line
    numbers are the file's, not the block's.
    """
    m = src.find("function MatchupsBlock")
    if m < 0:
        return ("", 0)
    # 184.0: the page no longer calls computeTrifecta itself — it reads legs from lib/live-scoring.
    i = src.find("const mine = legs.filter(", m)
    if i < 0:
        i = src.find("const tri = computeTrifecta(", m)
    if i < 0:
        return ("", 0)
    j = src.find("\nfunction ", i)
    return (src[i : j if j > 0 else len(src)], i)


def main() -> int:
    fails: list[str] = []
    live = LIVE.read_text(encoding="utf-8")
    branch, offset = trifecta_branch(live)
    if not branch:
        fails.append("live page: could not locate the Trifecta rendering block — guard is miswired")
    else:
        for m in re.finditer(r"\b(matchStatus|matchProgress|fourballStatus|fourballProgress)\s*\(", branch):
            line = live.count("\n", 0, offset + m.start()) + 1
            fails.append(f"app/live/[token]/page.tsx:{line}: `{m.group(1)}` inside the Trifecta block — singles must come from computeTrifecta's contests")
        if "legs" not in branch and "computeTrifecta" not in branch:
            fails.append("live page: Trifecta legs come from neither lib/live-scoring nor computeTrifecta")
        if "singles.map" in branch and "contestLabel(c)" not in branch:
            fails.append("live page: Trifecta singles are not labelled through contestLabel/trifectaRowState")
        if "trifectaRowState" not in live:
            fails.append("live page: does not use the shared trifectaRowState")

    views = VIEWS.read_text(encoding="utf-8")
    if "trifectaRowState" not in views:
        fails.append("scoring-views.tsx: in-game Trifecta row does not use the shared trifectaRowState")

    golf = (ROOT / "lib" / "golf.ts").read_text(encoding="utf-8")
    if "export function trifectaRowState(" not in golf:
        fails.append("lib/golf.ts: trifectaRowState must live in the engine so every renderer shares one rule")

    for f in fails:
        print("FAIL", f)
    if fails:
        return 1
    print("PASS Trifecta singles have one source (computeTrifecta) and one label rule (trifectaRowState)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
