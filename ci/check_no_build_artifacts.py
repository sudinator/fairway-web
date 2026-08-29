#!/usr/bin/env python3
"""No compiled output in the source tree.

A `tsc` invocation without `--outDir` emits .js beside every .ts it touches. 149 such files
accumulated under app/, components/ and lib/ during 177.81 and were invisible to everything:

  * `tsc --noEmit` reads the .ts sources and never looks at them
  * `next build` resolves .ts ahead of .js, so the build stayed green
  * the unit suite imports from .testout/, not from the source tree

They surfaced only because eslint tried to parse them and choked on the JSX. Had they been
committed, Next's module resolution could have served a STALE compiled component in some
configurations — a class of bug that is close to undebuggable, because the source on screen would
not be the code running.

This check is cheap and absolute: no .js, .d.ts or .js.map beside the sources, ever.

    python3 ci/check_no_build_artifacts.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIRS = ("app", "components", "lib")
SUFFIXES = (".js", ".jsx", ".d.ts", ".js.map")

# Legitimate hand-written JavaScript in the source tree, if any is ever added, goes here with a
# reason. Empty by design: everything under these directories is TypeScript.
ALLOWED: set[str] = set()

found = []
for d in DIRS:
    base = ROOT / d
    if not base.exists():
        continue
    for p in sorted(base.rglob("*")):
        if not p.is_file():
            continue
        name = p.name
        if not any(name.endswith(s) for s in SUFFIXES):
            continue
        rel = str(p.relative_to(ROOT))
        if rel in ALLOWED:
            continue
        found.append(rel)

if found:
    print(f"BUILD ARTIFACTS IN THE SOURCE TREE — {len(found)} file(s):")
    for f in found[:20]:
        print("  " + f)
    if len(found) > 20:
        print(f"  … and {len(found) - 20} more")
    print(
        "\n  These come from running tsc without --outDir. They are invisible to typecheck and to\n"
        "  the build, so nothing else will tell you they are there — and if committed, module\n"
        "  resolution can serve a stale compiled component while the source on screen looks right.\n"
        "\n  Remove them:\n"
        "    find app components lib \\( -name '*.js' -o -name '*.d.ts' -o -name '*.js.map' \\) -delete\n"
        "\n  And always compile tests with an explicit outDir (see tsconfig.screens.json)."
    )
    sys.exit(1)

print("build artifacts: PASS (no compiled output beside the sources)")
