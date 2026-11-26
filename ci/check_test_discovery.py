#!/usr/bin/env python3
"""Every test file runs (212.131). The suite is a hand-maintained list in package.json, so a test file can exist and never
run: lib/release-check.test.tsx sat unexecuted beside 183 others until the external review's inventory found it (the
P3 finding). This fails the build when a lib/*.test.ts(x) file is not executed by any package.json script — i.e. its compiled
`<name>.test.js` is not a `node …` step anywhere — and when a file listed in tsconfig.screens.json is compiled but never run.
A test that is deliberately retired is deleted (or moved to docs/history/), never left behind."""
import json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
scripts = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]
# every configured command (the suite itself, and lanes such as test:setup-nav that run one compiled test on their own)
executed = set(re.findall(r"node \.testout[\w-]*/(?:lib/)?([\w.-]+)\.test\.js", " ".join(scripts.values())))
screens = json.loads((ROOT / "tsconfig.screens.json").read_text(encoding="utf-8"))["files"]
problems = []
for f in sorted(list((ROOT / "lib").glob("*.test.ts")) + list((ROOT / "lib").glob("*.test.tsx"))):
    name = f.name.rsplit(".test.", 1)[0]
    if name not in executed:
        problems.append(f"lib/{f.name}: exists but no package.json script runs {name}.test.js — add it to the suite (and tsconfig.screens.json if it renders) or delete it")
for entry in screens:
    if ".test." in entry and entry.rsplit("/", 1)[-1].rsplit(".test.", 1)[0] not in executed:
        problems.append(f"{entry}: compiled by tsconfig.screens.json but run by no package.json script")
if problems:
    print("TEST DISCOVERY: FAIL — a test file that does not run is a test that cannot fail:"); [print("  " + p) for p in problems]; sys.exit(1)
print(f"test discovery: PASS ({len(executed)} test files executed by package.json scripts; none orphaned)")
