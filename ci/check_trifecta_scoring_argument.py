#!/usr/bin/env python3
"""
Every production call to computeTrifecta must pass the `scoring` argument (8th) explicitly.

computeTrifecta(holes, members, aIds, bIds, allowancePct, mode, swap, scoring) defaults `scoring`
to "per_hole" when omitted. Under "per_hole" the two singles are scored on the four-ball basis
(strokes off the foursome's low); under "match" (Ryder Cup) each single is a 1-v-1 and strokes are
the difference between the two players. The player card in tournaments.tsx omitted the argument
and disagreed with the Results page from the 14th hole on (Architects Golf Club, Jul 5 2026 —
lib/trifecta-card-scoring.test.ts pins the real rows).

A silent default is how that bug got in. This guard makes the omission a build failure. Tests and
baselines are exempt: they exercise the default deliberately.

    python3 ci/check_trifecta_scoring_argument.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
SCAN = ["components", "app", "lib"]
EXEMPT = re.compile(r"(\.test\.tsx?$)|(\.baseline\.ts$)|(^lib/golf\.ts$)")
REQUIRED_ARGS = 8
CALL = re.compile(r"\bcomputeTrifecta\s*\(")


def top_level_args(src: str, start: int) -> tuple[int, int]:
    """Count top-level comma-separated arguments of the call whose '(' is at `start`.
    Returns (arg_count, end_index). Handles nested brackets, strings and template literals."""
    depth = 0
    i = start
    n = len(src)
    args = 0
    saw_content = False
    while i < n:
        c = src[i]
        if c in "\"'`":
            q = c
            i += 1
            while i < n and src[i] != q:
                if src[i] == "\\":
                    i += 1
                i += 1
            saw_content = True
        elif c in "([{":
            depth += 1
            if depth > 1:
                saw_content = True
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return (args + 1 if saw_content else 0, i)
        elif c == "," and depth == 1:
            args += 1
        elif not c.isspace() and depth >= 1:
            saw_content = True
        i += 1
    raise SystemExit(f"unbalanced computeTrifecta call at offset {start}")


def main() -> int:
    failures: list[str] = []
    seen = 0
    for base in SCAN:
        for path in sorted((ROOT / base).rglob("*.ts*")):
            rel = path.relative_to(ROOT).as_posix()
            if EXEMPT.search(rel) or "node_modules" in rel:
                continue
            src = path.read_text(encoding="utf-8")
            for m in CALL.finditer(src):
                line = src.count("\n", 0, m.start()) + 1
                # Prose in a line comment ("computeTrifecta (the Results page)") is not a call.
                line_start = src.rfind("\n", 0, m.start()) + 1
                if "//" in src[line_start:m.start()]:
                    continue
                count, _ = top_level_args(src, m.end() - 1)
                seen += 1
                if count < REQUIRED_ARGS:
                    failures.append(f"{rel}:{line}: computeTrifecta called with {count} args — scoring (arg {REQUIRED_ARGS}) must be passed explicitly")
    print(f"computeTrifecta production call sites checked: {seen}")
    for f in failures:
        print("FAIL", f)
    if seen == 0:
        print("FAIL no computeTrifecta call sites found — guard is miswired")
        return 1
    if failures:
        return 1
    print("PASS every computeTrifecta call passes scoring explicitly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
