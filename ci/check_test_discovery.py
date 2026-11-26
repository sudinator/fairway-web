#!/usr/bin/env python3
"""Every test and guard runs (212.131; widened 212.132). The suite is a hand-maintained list in package.json, so a test can
exist and never run: lib/release-check.test.tsx sat unexecuted beside 183 others until the external review's inventory
found it; the cold review of 212.132 then found three ci/check_*.py guards no script ran (one of them asserting an API
removed in 183.0). This fails the build when:
  - a lib/*.test.ts(x) file is not executed by a REACHABLE package.json script — reachable means `test`, `guards`,
    `ci:app`, `ci`, or anything a workflow step runs, following `npm run x` edges (a script nothing runs does not count);
  - a file listed in tsconfig.screens.json is compiled but never run;
  - a ci/test-*.cjs|mjs or ci/check*.py is not invoked as a `node ci/…` / `python3 ci/…` token by a reachable script, a
    workflow, or a ci/*.sh — unless named in OPTIONAL with the reason.
A retired test or guard is deleted, never left behind."""
import json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
scripts = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]
workflows = "".join(p.read_text(encoding="utf-8") for p in (ROOT / ".github" / "workflows").glob("*.yml"))
shells_all = {p.name: p.read_text(encoding="utf-8") for p in (ROOT / "ci").glob("*.sh")}
# reachable scripts: the roots, plus whatever a workflow runs, following `npm run x` edges
roots = {"test", "guards", "ci:app", "ci"} | set(re.findall(r"npm run ([\w:-]+)", workflows))
reach, todo = set(), [r for r in roots if r in scripts]
while todo:
    name = todo.pop()
    if name in reach: continue
    reach.add(name)
    todo += [x for x in re.findall(r"npm run ([\w:-]+)", scripts[name]) if x in scripts]
# only shells that a reachable script or a workflow runs count (an orphan ci/*.sh would otherwise make its guards look wired)
reachable_text = " ".join(scripts[n] for n in reach) + " " + workflows
shells = "".join(text for name, text in shells_all.items() if name in reachable_text or name in "".join(t for n, t in shells_all.items() if n in reachable_text))
commands = reachable_text + " " + shells
executed = set(re.findall(r"node \.testout[\w-]*/(?:lib/)?([\w.-]+)\.test\.js", commands))
screens = json.loads((ROOT / "tsconfig.screens.json").read_text(encoding="utf-8"))["files"]
OPTIONAL = {
    "test-built-phone-diagnostics.cjs": "post-build smoke against a running local Next build; run by hand",
    "test-game-reset-isolated.cjs": "PGlite-engine probe (needs @electric-sql/pglite, not a dependency); superseded by the fresh-database chain's assert-game-reset-fencing.sql",
    "check_security_contract.py": "needs a database URL; run by ci/test_fresh_db_local.sh and the rebuild workflow",
}
problems = []
for f in sorted(list((ROOT / "lib").glob("*.test.ts")) + list((ROOT / "lib").glob("*.test.tsx"))):
    name = f.name.rsplit(".test.", 1)[0]
    if name not in executed:
        problems.append(f"lib/{f.name}: exists but no reachable package.json script runs {name}.test.js — add it to the suite (and tsconfig.screens.json if it renders) or delete it")
for entry in screens:
    if ".test." in entry and entry.rsplit("/", 1)[-1].rsplit(".test.", 1)[0] not in executed:
        problems.append(f"{entry}: compiled by tsconfig.screens.json but run by no reachable package.json script")
invoked = set(re.findall(r"(?:node|python3) ci/([\w.-]+)", commands))
ci_files = sorted(list((ROOT / "ci").glob("test-*.cjs")) + list((ROOT / "ci").glob("test-*.mjs")) + list((ROOT / "ci").glob("check*.py")))
for f in ci_files:
    if f.name not in invoked and f.name not in OPTIONAL:
        problems.append(f"ci/{f.name}: no reachable script, workflow or ci/*.sh invokes it — wire it, delete it, or list it in OPTIONAL with the reason")
for name in OPTIONAL:
    if not (ROOT / "ci" / name).exists(): problems.append(f"OPTIONAL lists ci/{name}, which no longer exists — remove the entry")
if problems:
    print("TEST DISCOVERY: FAIL — a test or guard that does not run is one that cannot fail:"); [print("  " + p) for p in problems]; sys.exit(1)
print(f"test discovery: PASS ({len(executed)} lib test files executed by reachable scripts; {len([f for f in ci_files if f.name in invoked])} ci/ tests and guards wired, {len(OPTIONAL)} optional by name; none orphaned)")
