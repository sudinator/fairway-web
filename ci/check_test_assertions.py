#!/usr/bin/env python3
"""Assertion-count ratchet — a suite must never quietly stop testing.

The recurring failure in this codebase is not a check that reports a wrong answer; it is a check
that reports SUCCESS having verified nothing. Four instances in one day:

  * the GolfCourseAPI monitor had never once run — no secret, so it failed at line 4 every week
  * the VAPID key check exited 0 with "comparison skipped" when its input was missing
  * a contrast check resolved backgrounds with a 900-character proximity lookback and passed its
    own bug
  * badges.test.ts had 11 assertions appended AFTER its report line, so they could not fail the
    build

Every one looked green. This guard catches the last shape: it records how many assertions each
suite reports and fails if that number DROPS. Deleting a test, moving assertions past the report,
or an early return that skips a block all reduce the count and are refused.

It ratchets upward: a higher count is a failure too, prompting the baseline to be committed
alongside the new tests, so the number is always a deliberate record rather than drift.

    python3 ci/check_test_assertions.py            check
    python3 ci/check_test_assertions.py --update   rewrite the baseline
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "ci" / "test_assertion_baseline.json"

# The suites print in two styles that grew up side by side. Both are matched rather than
# normalised, because rewriting 30 test files to agree would be a bigger change than the guard.
PATTERNS = [
    re.compile(r"^(?P<name>[\w /-]+?):\s*(?P<n>\d+)\s+passed,\s*(?P<f>\d+)\s+failed", re.M),
    re.compile(r"^(?P<name>[\w /-]+?):\s*PASS\s+(?P<n>\d+)\s+FAIL\s+(?P<f>\d+)", re.M),
    re.compile(r"^PASS\s+(?P<n>\d+)\s+FAIL\s+(?P<f>\d+)", re.M),
]


def collect():
    """Run the suite and total the reported assertions per named suite."""
    r = subprocess.run(["npm", "test"], cwd=ROOT, capture_output=True, text=True, timeout=1800)
    out = r.stdout + r.stderr
    if r.returncode != 0:
        print("TEST ASSERTIONS: npm test failed — fix the tests before running this guard.")
        sys.exit(1)

    counts = {}
    anonymous = 0
    for pat in PATTERNS:
        for m in pat.finditer(out):
            n = int(m.group("n"))
            name = (m.groupdict().get("name") or "").strip()
            if not name:
                # The unnamed "PASS n FAIL m" suites cannot be told apart, so they are summed into
                # one bucket. A drop in the total still fails, which is what matters.
                anonymous += n
                continue
            counts[name] = counts.get(name, 0) + n
    if anonymous:
        counts["(unnamed suites)"] = anonymous
    return dict(sorted(counts.items())), sum(counts.values())


now, total = collect()

if "--update" in sys.argv:
    BASELINE.write_text(json.dumps({"total": total, "suites": now}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {BASELINE.relative_to(ROOT)} — {total} assertions across {len(now)} suite(s).")
    sys.exit(0)

if not BASELINE.exists():
    print(f"Missing {BASELINE.relative_to(ROOT)} — run with --update")
    sys.exit(1)

base = json.loads(BASELINE.read_text(encoding="utf-8"))
prev, prev_suites = base["total"], base["suites"]

dropped = {k: (prev_suites[k], now.get(k, 0)) for k in prev_suites if now.get(k, 0) < prev_suites[k]}
gained = {k: (prev_suites.get(k, 0), now[k]) for k in now if now[k] > prev_suites.get(k, 0)}

if dropped:
    print("TEST ASSERTIONS FAILED — a suite is verifying LESS than it was:")
    for k, (was, is_) in sorted(dropped.items()):
        print(f"  {k}: {was} -> {is_}  ({was - is_} fewer)")
    print("\n  A suite that stops asserting still reports success, which is the failure mode this")
    print("  exists to catch. Check for: assertions added after the report line, an early return")
    print("  skipping a block, or a deleted test. If the removal is deliberate, run --update.")
    sys.exit(1)

if gained:
    print("TEST ASSERTIONS: more assertions than the baseline — commit the new number:")
    for k, (was, is_) in sorted(gained.items()):
        print(f"  {k}: {was} -> {is_}  (+{is_ - was})")
    print("\n  Run: python3 ci/check_test_assertions.py --update")
    sys.exit(1)

print(f"test assertions: PASS ({total} across {len(now)} suite(s), none lost)")
