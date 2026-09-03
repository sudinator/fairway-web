#!/usr/bin/env python3
"""Require one TypeScript Course Handicap formula and both public consumers."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
golf = (ROOT / "lib/golf.ts").read_text(encoding="utf-8")
shape = (ROOT / "lib/game-shape.ts").read_text(encoding="utf-8")
tests = (ROOT / "lib/game-shape.test.ts").read_text(encoding="utf-8")
formula = re.compile(r"(?:index|handicap_index)[^\n]*slope\s*/\s*113[^\n]*rating[^\n]*par")
runtime = "\n".join(
    p.read_text(encoding="utf-8")
    for p in (ROOT / "lib").glob("*.ts")
    if not p.name.endswith(".test.ts") and ".baseline." not in p.name
)
checks = [
    ("rounded display CH delegates to exact basis", "const exact = courseHandicapExact(index, slope, rating, par);" in golf),
    ("game scoring CH delegates to exact basis", "courseHandicapExact(p.handicap_index, p.slope, p.rating, coursePar)" in shape),
    ("only one inline runtime TypeScript formula remains", len(formula.findall(runtime)) == 1),
    ("exact-basis equivalence test exists", "CH basis delegates to exact WHS basis" in tests),
    ("nine-hole exact-basis test exists", "nine-hole CH halves the exact basis" in tests),
]
failed = [name for name, ok in checks if not ok]
if failed:
    print("181.13 Course Handicap source contract: FAIL")
    for name in failed:
        print(f"  - {name}")
    raise SystemExit(1)
print(f"181.13 Course Handicap source contract: PASS ({len(checks)}/{len(checks)})")
