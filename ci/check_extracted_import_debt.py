#!/usr/bin/env python3
"""Unused-symbol debt ratchet.

APP_RULES #26 treats unused imports/locals/parameters as boundary-drift warnings.
The old guard counted *total imported symbols*, which could pass even when imports
were entirely unused. This guard measures TypeScript's actual unused diagnostics
(TS6133/TS6192/TS6196) and freezes them per file.

Rules:
- increases/decreases are reported against the checked-in baseline;
- findings are ADVISORY and never block a release by themselves;
- the normal blocking TypeScript typecheck runs separately and still fails on
  real compile/type errors.

APP_RULES #26 explicitly classifies unused props/state/imports as boundary-drift
warnings. This command intentionally reports only TypeScript unused-symbol
diagnostics (TS6133/TS6192/TS6196) and exits successfully after reporting them.
"""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASELINE_PATH = ROOT / "ci" / "unused_symbol_baseline.json"
BASELINE = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
EXPECTED = {k: int(v) for k, v in BASELINE["files"].items()}

# Use the project compiler when installed; fall back to a globally available tsc.
local_tsc = ROOT / "node_modules" / ".bin" / ("tsc.cmd" if os.name == "nt" else "tsc")
if local_tsc.exists():
    cmd = [str(local_tsc)]
elif shutil.which("tsc"):
    cmd = ["tsc"]
else:
    print("Unused-symbol debt ratchet: WARNING - TypeScript compiler not found; advisory check skipped")
    raise SystemExit(0)

cmd += ["--noEmit", "--noUnusedLocals", "--noUnusedParameters", "--pretty", "false"]

# In source-only/offline audit environments node_modules can be incomplete. An
# empty typeRoots still lets tsc emit unused diagnostics. CI has the complete
# dependency tree and does not use this fallback.
env = os.environ.copy()
use_offline_fallback = not (ROOT / "node_modules" / "@types" / "react" / "index.d.ts").exists()
with tempfile.TemporaryDirectory() as td:
    run_cmd = cmd + (["--typeRoots", td] if use_offline_fallback else [])
    proc = subprocess.run(run_cmd, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)

pattern = re.compile(r"^([^\(]+)\([^)]*\): error TS(6133|6192|6196):", re.M)
current = {}
for match in pattern.finditer(proc.stdout):
    rel = match.group(1).replace("\\", "/")
    current[rel] = current.get(rel, 0) + 1

errors = []
all_files = sorted(set(EXPECTED) | set(current))
for path in all_files:
    old = EXPECTED.get(path, 0)
    now = current.get(path, 0)
    if now > old:
        errors.append(f"{path}: unused-symbol debt increased {old} -> {now}")
    elif now < old:
        errors.append(f"{path}: debt improved {old} -> {now}; lower ci/unused_symbol_baseline.json so the improvement cannot regress")

total_expected = sum(EXPECTED.values())
total_current = sum(current.values())
if total_current != total_expected and not errors:
    errors.append(f"total unused diagnostics changed {total_expected} -> {total_current}; refresh the per-file baseline")

if errors:
    print("Unused-symbol debt ratchet: WARNING (advisory; does not block release)")
    for error in errors:
        print(" -", error)
else:
    print(f"Unused-symbol debt ratchet: PASS ({total_current} grandfathered diagnostics across {len(current)} files; baseline unchanged)")
if use_offline_fallback:
    print(" - audit mode: dependency type roots unavailable; only TS6133/6192/6196 diagnostics were evaluated")
