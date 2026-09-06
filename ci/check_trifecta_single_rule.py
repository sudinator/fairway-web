#!/usr/bin/env python3
"""
Trifecta has ONE rule (183.0): two genuine 1-v-1 singles plus a four-ball, one point each, decided as
matches. The former "per_hole" variant (one net per player off the foursome low, three points a hole)
was never played in production and produced the 182.0 card/Results disagreement when a caller fell
into it by default. This guard keeps it gone:

  1. No production source mentions `per_hole` or `TrifectaScoring`.
  2. computeTrifecta has no scoring parameter (exactly: holes, members, aIds, bIds, allowancePct,
     mode, swap) and every production call passes at most 7 arguments.
  3. The games.trifecta_scoring column is only ever written as "match" (or null for non-Trifecta);
     the column survives because the Ryder Cup trigger (0146) requires it.

Tests and baselines are exempt from (1): they document the removed behaviour as a regression fence.

    python3 ci/check_trifecta_single_rule.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
SCAN = ["components", "app", "lib"]
EXEMPT = re.compile(r"(\.test\.tsx?$)|(\.baseline\.ts$)")


def top_level_args(src: str, start: int) -> int:
    depth = 0; i = start; n = len(src); args = 0; content = False; pending = False
    while i < n:
        c = src[i]
        if c in "\"'`":
            q = c; i += 1
            while i < n and src[i] != q:
                if src[i] == "\\": i += 1
                i += 1
            content = True; pending = True
        elif c in "([{":
            depth += 1
            if depth > 1: content = True
        elif c in ")]}":
            depth -= 1
            if depth == 0: return args + (1 if pending else 0)
        elif c == "," and depth == 1:
            args += 1; pending = False   # a trailing comma does not start another argument
        elif not c.isspace() and depth >= 1: content = True; pending = True
        i += 1
    raise SystemExit("unbalanced call")


def main() -> int:
    fails: list[str] = []
    calls = 0
    for base in SCAN:
        for path in sorted((ROOT / base).rglob("*.ts*")):
            rel = path.relative_to(ROOT).as_posix()
            if "node_modules" in rel or EXEMPT.search(rel):
                continue
            src = path.read_text(encoding="utf-8")
            for m in re.finditer(r"\bper_hole\b|\bTrifectaScoring\b", src):
                line = src.count("\n", 0, m.start()) + 1
                line_start = src.rfind("\n", 0, m.start()) + 1
                if "//" in src[line_start:m.start()] or src[line_start:m.start()].lstrip().startswith("*"):
                    continue  # prose in a comment describing the removal is fine
                fails.append(f"{rel}:{line}: `{m.group(0)}` in production source")
            for m in re.finditer(r"\bcomputeTrifecta\s*\(", src):
                line_start = src.rfind("\n", 0, m.start()) + 1
                if "//" in src[line_start:m.start()]:
                    continue
                count = top_level_args(src, m.end() - 1)
                if rel == "lib/golf.ts" and src[line_start:m.start()].strip().startswith("export function"):
                    if count != 7:
                        fails.append(f"{rel}: computeTrifecta declares {count} parameters, expected 7 (no scoring parameter)")
                    continue
                calls += 1
                if count > 7:
                    line = src.count("\n", 0, m.start()) + 1
                    fails.append(f"{rel}:{line}: computeTrifecta called with {count} args — a scoring argument no longer exists")
            for m in re.finditer(r"trifecta_scoring\s*:\s*([^,\n}]+)", src):
                val = m.group(1).strip()
                if "test" in rel or rel.startswith("lib/game-types") or rel.startswith("app/live"):
                    continue
                if not re.fullmatch(r'(o\.gameType === "trifecta" \? )?"match"( : null)?|"match"|null', val):
                    line = src.count("\n", 0, m.start()) + 1
                    fails.append(f"{rel}:{line}: trifecta_scoring written as `{val}` — only \"match\" (or null) is allowed")
    print(f"computeTrifecta production call sites checked: {calls}")
    for f in fails: print("FAIL", f)
    if calls == 0:
        print("FAIL no computeTrifecta call sites found — guard is miswired"); return 1
    if fails: return 1
    print("PASS one Trifecta rule: no per-hole variant, no scoring argument, column only written as \"match\"")
    return 0


if __name__ == "__main__":
    sys.exit(main())
