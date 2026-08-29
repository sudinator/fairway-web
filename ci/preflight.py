#!/usr/bin/env python3
"""Pre-handoff gate — run what CI runs, the way CI runs it, before anything is packaged.

WHY THIS EXISTS
177.81 shipped a test harness that printed "62 passed" and then never exited. CI ran until its
30-minute job timeout on every push. It reached production because of exactly one habit: every
time I ran the screen suite I piped it to `tail`, which hides that the process never returned, and
I never once ran the whole pipeline end to end and looked at the clock.

Three separate things were true and none of them was caught:
  * the suite passed
  * the suite hung
  * the pipeline took 30 minutes

Reading only the first is how the other two shipped.

WHAT IT CHECKS THAT THE GATES DO NOT
  1. EVERY step is timed, and an implausible duration fails. A passing suite that takes minutes is
     not slow, it is stuck.
  2. Exit codes are read from the process, never from a pipeline. `cmd | tail` reports tail's
     status, which is how a hang and a failure both read as success.
  3. The suite is run TWICE — once cold, once warm — because a step that only works with warm
     caches fails on a fresh CI runner, and CI is always cold.
  4. It runs on a CLEAN EXTRACT of the packaged zip, not the working tree, so what is verified is
     what is handed over.

    python3 ci/preflight.py                 verify the working tree
    python3 ci/preflight.py --zip PATH      extract and verify a packaged drop
"""
import argparse
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Anything slower than this is treated as stuck rather than slow. Measured: lint ~15s, tsc ~25s,
# the whole suite ~25s, guards ~90s, build ~40s on this machine.
BUDGETS = {
    "lint:hooks": 120,
    "tsc --noEmit": 180,
    "npm test": 180,
    "npm run guards": 600,
    "npm run build": 300,
}


class Step:
    def __init__(self, name: str, argv: list[str], cwd: Path, env_extra: dict | None = None):
        self.name = name
        self.argv = argv
        self.cwd = cwd
        self.env_extra = env_extra or {}
        self.seconds = 0.0
        self.code: int | None = None
        self.output = ""

    def run(self, budget: int) -> bool:
        import os

        env = {**os.environ, **self.env_extra}
        started = time.monotonic()
        try:
            # capture_output, never a pipe: a shell pipeline reports the LAST command's status, so
            # `npm test | tail` exits 0 for a suite that failed or hung. That is the exact mistake
            # this file exists to make impossible.
            r = subprocess.run(
                self.argv, cwd=self.cwd, capture_output=True, text=True, env=env,
                timeout=budget,
            )
            self.code = r.returncode
            self.output = (r.stdout or "") + (r.stderr or "")
        except subprocess.TimeoutExpired as e:
            self.seconds = time.monotonic() - started
            self.code = None
            self.output = (e.stdout or b"").decode(errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
            print(f"  HUNG   {self.name:<22} exceeded {budget}s")
            print(f"         Not slow — stuck. A suite that prints its result and then hangs is the")
            print(f"         usual cause: a harness that returns on success instead of calling")
            print(f"         process.exit(0), leaving jsdom and React roots holding the event loop.")
            return False
        self.seconds = time.monotonic() - started
        status = "ok  " if self.code == 0 else "FAIL"
        print(f"  {status}   {self.name:<22} {self.seconds:6.1f}s   exit {self.code}")
        if self.code != 0:
            tail = "\n".join(self.output.strip().splitlines()[-15:])
            print("         last lines:\n         " + tail.replace("\n", "\n         "))
        return self.code == 0


def preflight(root: Path, label: str) -> bool:
    print(f"\n=== preflight: {label} ===")
    env = {
        "NEXT_PUBLIC_SUPABASE_URL": "https://preflight.supabase.co",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY": "preflight-anon-key",
    }
    # The VAPID key is read from the shipped service worker rather than hardcoded, so this cannot
    # drift from the value the build actually checks against.
    sw = (root / "public" / "sw.js")
    if sw.exists():
        import re

        m = re.search(r'const VAPID_PUBLIC_KEY = "([^"]+)"', sw.read_text(encoding="utf-8", errors="replace"))
        if m:
            env["NEXT_PUBLIC_VAPID_PUBLIC_KEY"] = m.group(1)

    steps = [
        Step("lint:hooks", ["npm", "run", "lint:hooks"], root),
        Step("tsc --noEmit", ["npx", "tsc", "--noEmit"], root),
        Step("npm test", ["npm", "test"], root, env),
        Step("npm test (warm)", ["npm", "test"], root, env),
        Step("npm run guards", ["npm", "run", "guards"], root, env),
        Step("npm run build", ["npm", "run", "build"], root, env),
    ]

    ok = True
    total = 0.0
    for s in steps:
        budget = BUDGETS.get(s.name.replace(" (warm)", ""), 300)
        if not s.run(budget):
            ok = False
            break
        total += s.seconds

    print(f"\n  total {total:.0f}s")
    if ok and total > 900:
        print("  SLOW: the pipeline is over 15 minutes. Something is stuck or newly expensive.")
        ok = False
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", help="verify a packaged drop on a clean extract")
    ap.add_argument("--base", help="clean baseline tree to extract the zip over")
    a = ap.parse_args()

    if not a.zip:
        return 0 if preflight(ROOT, "working tree") else 1

    if not a.base:
        print("--zip needs --base: a drop must be verified on top of the tree it applies to,")
        print("not in isolation, or a file the drop forgot to include will not be noticed.")
        return 1

    tmp = Path(tempfile.mkdtemp(prefix="preflight-"))
    try:
        shutil.copytree(a.base, tmp / "tree", symlinks=True, dirs_exist_ok=True)
        with zipfile.ZipFile(a.zip) as z:
            z.extractall(tmp / "tree")
        print(f"  extracted {Path(a.zip).name} over {a.base}")
        r = subprocess.run(["npm", "ci"], cwd=tmp / "tree", capture_output=True, text=True, timeout=900)
        if r.returncode != 0:
            print("  FAIL   npm ci")
            print((r.stdout + r.stderr)[-1500:])
            return 1
        print("  ok     npm ci")
        return 0 if preflight(tmp / "tree", f"clean extract of {Path(a.zip).name}") else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


sys.exit(main())
