#!/usr/bin/env python3
"""
The public live-share page must not do its own arithmetic, and every format it renders must have a
parity case holding it against the app's answers.

  1. app/live/[token]/page.tsx renders from lib/live-scoring (liveLegs); its MatchupsBlock does not
     call the scoring engines directly.
  2. Every game_type the page's MatchupsBlock renders has at least one fixture in
     lib/live-parity.diff.test.ts, so adding a format to one side without the other fails the build.

    python3 ci/check_live_parity_coverage.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "app" / "live" / "[token]" / "page.tsx"
PARITY = ROOT / "lib" / "live-parity.diff.test.ts"
ENGINES = ("matchStatus", "matchProgress", "fourballStatus", "fourballProgress", "computeTrifecta")


def matchups_block(src: str) -> tuple[str, int]:
    i = src.find("function MatchupsBlock")
    if i < 0:
        return ("", 0)
    j = src.find("\nfunction ", i + 10)
    return (src[i : j if j > 0 else len(src)], i)


def main() -> int:
    fails: list[str] = []
    page = PAGE.read_text(encoding="utf-8")
    parity = PARITY.read_text(encoding="utf-8")

    if "liveLegs(" not in page:
        fails.append("live page does not render from lib/live-scoring.liveLegs")

    block, offset = matchups_block(page)
    if not block:
        fails.append("could not locate MatchupsBlock — guard is miswired")
    else:
        for m in re.finditer(r"\b(" + "|".join(ENGINES) + r")\s*\(", block):
            line = page.count("\n", 0, offset + m.start()) + 1
            fails.append(f"app/live/[token]/page.tsx:{line}: `{m.group(1)}` called directly in MatchupsBlock — go through lib/live-scoring")

    # The block supports the formats named in its early return (`gt !== "a" && gt !== "b" ...`);
    # branches are a mix of `gt === "x"` and a trailing else, so the guard clause is the truth.
    rendered = set(re.findall(r'gt !== "(\w+)"', block)) | set(re.findall(r'gt === "(\w+)"', block))
    if not rendered:
        fails.append("no rendered game_types found in MatchupsBlock — guard is miswired")
    covered = set(re.findall(r'game_type: "(\w+)"', parity))
    for gt in sorted(rendered - covered):
        fails.append(f"format `{gt}` is rendered by the live page but has no fixture in lib/live-parity.diff.test.ts")

    print(f"live parity coverage: rendered={sorted(rendered)} covered={sorted(covered)}")
    for f in fails:
        print("FAIL", f)
    if fails:
        return 1
    print("PASS live page renders from lib/live-scoring and every rendered format has a parity fixture")
    return 0


if __name__ == "__main__":
    sys.exit(main())
