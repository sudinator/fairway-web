#!/usr/bin/env python3
"""Regenerate MIGRATIONS.md from the migrations/ directory.

Manual-run workflow: migrations are applied by hand in the Supabase SQL editor, so there is no
schema_migrations tracking table. This checklist is the ledger — tick a box once you've run that
migration. Re-running this script ADDS any new migration files while PRESERVING existing ticks,
so newly shipped migrations show up unchecked and previously-run ones stay checked.

Usage:  python3 ci/gen-migrations-checklist.py
"""
import os, re, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG_DIR = os.path.join(ROOT, "migrations")
LEDGER = os.path.join(ROOT, "MIGRATIONS.md")

# Preserve which migrations were already ticked.
already = set()
if os.path.exists(LEDGER):
    for line in open(LEDGER, encoding="utf-8"):
        m = re.match(r"\s*-\s*\[x\]\s+(\d{4})_", line, re.I)
        if m:
            already.add(m.group(1))

files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(MIG_DIR, "*.sql")))
rows = []
for f in files:
    num = f[:4]
    box = "x" if num in already else " "
    rows.append(f"- [{box}] {f}")

body = (
    "# Migrations run-ledger\n\n"
    "Migrations are applied **by hand** in the Supabase SQL editor, in filename order. There is no\n"
    "auto-tracking, so this file is the record: **tick a box after you run that migration.**\n\n"
    "Regenerate after shipping (adds new files, keeps your ticks):\n"
    "`python3 ci/gen-migrations-checklist.py`\n\n"
    "Each release's DEPLOY_NOTES also flags any migration that must be run for that version.\n\n"
    f"Total: {len(files)} migrations. Unchecked = not yet confirmed applied.\n\n"
    "## Checklist (oldest → newest)\n\n" + "\n".join(rows) + "\n"
)
open(LEDGER, "w", encoding="utf-8").write(body)
unchecked = [r for r in rows if "[ ]" in r]
print(f"Wrote {LEDGER}: {len(files)} migrations, {len(unchecked)} unchecked.")
