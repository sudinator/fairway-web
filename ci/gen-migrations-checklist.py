#!/usr/bin/env python3
"""Regenerate MIGRATIONS.md from migrations/ without destroying manual notes.

Migrations are applied manually in the Supabase SQL editor. The database-side
``schema_migrations`` table is the source of truth from 0113 onward; this markdown
file remains the human run checklist and release commentary.

The generator:
  * preserves checked migration ids, including markdown-emphasized filenames;
  * preserves the explicit NOTES block byte-for-byte;
  * adds every migration file in filename order;
  * is idempotent.
"""
from pathlib import Path
import glob
import re

ROOT = Path(__file__).resolve().parents[1]
MIG_DIR = ROOT / "migrations"
LEDGER = ROOT / "MIGRATIONS.md"
NOTES_START = "<!-- NOTES:START -->"
NOTES_END = "<!-- NOTES:END -->"

existing = LEDGER.read_text(encoding="utf-8") if LEDGER.exists() else ""

# Accept both `- [x] 0130_foo.sql` and `- [x] **0130_foo.sql**`.
already = {
    m.group(1)
    for m in re.finditer(r"(?mi)^\s*-\s*\[x\]\s+(?:\*\*)?(\d{4})_", existing)
}

notes = ""
if NOTES_START in existing and NOTES_END in existing:
    notes = existing.split(NOTES_START, 1)[1].split(NOTES_END, 1)[0]
else:
    # Backward-compatible first conversion: preserve the historical prose that
    # followed the generated 0121 checklist entry in the pre-marker ledger.
    marker = "- [ ] 0121_money_clean_slate.sql"
    if marker not in existing:
        marker = "- [x] 0121_money_clean_slate.sql"
    if marker in existing:
        tail = existing.split(marker, 1)[1]
        if tail.strip():
            notes = tail

files = sorted(Path(p).name for p in glob.glob(str(MIG_DIR / "*.sql")))
rows = []
for filename in files:
    num = filename[:4]
    box = "x" if num in already else " "
    rows.append(f"- [{box}] {filename}")

body = (
    "# Migrations run-ledger\n\n"
    "Migrations are applied **by hand** in the Supabase SQL editor, in filename order. "
    "From migration 0113 onward, `public.schema_migrations` is the database source of truth; "
    "this file remains the human checklist and release notes.\n\n"
    "Regenerate after shipping (adds new files, keeps ticks and the notes block):\n"
    "`python3 ci/gen-migrations-checklist.py`\n\n"
    "Confirm database-applied state with:\n"
    "`select id, applied_at from public.schema_migrations order by id;`\n\n"
    f"Total: {len(files)} migrations. Unchecked = not yet confirmed applied in this checklist.\n\n"
    "## Checklist (oldest → newest)\n\n"
    + "\n".join(rows)
    + "\n\n"
    + NOTES_START
    + notes
    + ("\n" if notes and not notes.endswith("\n") else "")
    + NOTES_END
    + "\n"
)
LEDGER.write_text(body, encoding="utf-8")
unchecked = sum(1 for row in rows if "[ ]" in row)
print(f"Wrote {LEDGER}: {len(files)} migrations, {unchecked} unchecked; notes preserved.")
