#!/usr/bin/env python3
"""Protect migrations that already exist on main from being edited or deleted."""
from pathlib import Path
import hashlib
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BASE_REF = os.environ.get("GITHUB_BASE_REF", "")

# This is meaningful on PRs to main. Local runs and staging pushes report SKIP rather than guessing.
if BASE_REF != "main":
    print("Migration immutability: SKIP (only enforced on pull requests targeting main)")
    raise SystemExit(0)

subprocess.run(["git", "fetch", "origin", "main", "--depth=1"], cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def tree_files(ref: str) -> dict[str, bytes]:
    out = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", ref, "migrations"], cwd=ROOT, text=True)
    result: dict[str, bytes] = {}
    for rel in out.splitlines():
        if not rel.endswith('.sql'):
            continue
        result[rel] = subprocess.check_output(["git", "show", f"{ref}:{rel}"], cwd=ROOT)
    return result

base = tree_files("origin/main")
errors: list[str] = []
for rel, old_bytes in base.items():
    current = ROOT / rel
    if not current.exists():
        errors.append(f"deleted released migration: {rel}")
        continue
    new_bytes = current.read_bytes()
    if hashlib.sha256(old_bytes).digest() != hashlib.sha256(new_bytes).digest():
        errors.append(f"modified released migration: {rel}; create a new numbered migration instead")

if errors:
    print("Migration immutability: FAIL")
    for error in errors:
        print(f" - {error}")
    raise SystemExit(1)
print(f"Migration immutability: PASS ({len(base)} migrations already on main are byte-identical)")
