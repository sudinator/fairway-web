#!/usr/bin/env python3
"""Fail when MIGRATIONS.md is not regenerated from the committed migration files."""
from pathlib import Path
import subprocess
import sys
import tempfile
import shutil

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "ci" / "gen-migrations-checklist.py"
LEDGER = ROOT / "MIGRATIONS.md"

before = LEDGER.read_bytes()
with tempfile.TemporaryDirectory() as tmp:
    shadow = Path(tmp) / "repo"
    shadow.mkdir()
    shutil.copy2(LEDGER, shadow / "MIGRATIONS.md")
    shutil.copytree(ROOT / "migrations", shadow / "migrations")
    (shadow / "ci").mkdir()
    shutil.copy2(GEN, shadow / "ci" / "gen-migrations-checklist.py")
    proc = subprocess.run(
        [sys.executable, str(shadow / "ci" / "gen-migrations-checklist.py")],
        cwd=shadow,
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        print("Migration manifest check: FAIL")
        print(proc.stdout)
        print(proc.stderr)
        raise SystemExit(proc.returncode)
    after = (shadow / "MIGRATIONS.md").read_bytes()

if before != after:
    print("Migration manifest check: FAIL")
    print("MIGRATIONS.md is stale. Run: python3 ci/gen-migrations-checklist.py")
    raise SystemExit(1)

print("Migration manifest check: PASS (MIGRATIONS.md matches committed migration files)")
