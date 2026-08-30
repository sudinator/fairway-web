#!/usr/bin/env python3
"""Permanent semantic contract for the database migration ledger."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "migrations"
NOTES = (ROOT / "MIGRATIONS.md").read_text(encoding="utf-8")

COMMENT_BLOCK = re.compile(r"/\*.*?\*/", re.S)
COMMENT_LINE = re.compile(r"--[^\n]*")
CALL = re.compile(
    r"select\s+(?:public\.)?record_migration\s*\(\s*'([^']+)'\s*\)\s*(?:where\b.*?\s*)?;",
    re.I | re.S,
)

def uncomment(sql: str) -> str:
    return COMMENT_LINE.sub("", COMMENT_BLOCK.sub("", sql))

files = sorted(MIG.glob("[0-9][0-9][0-9][0-9]_*.sql"))
errors: list[str] = []
nums: dict[int, str] = {}

for path in files:
    stem = path.stem
    num = int(stem[:4])
    if num in nums:
        errors.append(f"duplicate migration number {num:04d}: {nums[num]} and {path.name}")
    nums[num] = path.name
    if num < 113:
        continue

    sql = uncomment(path.read_text(encoding="utf-8"))
    calls = list(CALL.finditer(sql))
    own = [m for m in calls if m.group(1) == stem]
    if not own:
        errors.append(f"{path.name}: missing executable record_migration('{stem}') call")
        continue
    if len(own) > 1:
        errors.append(f"{path.name}: records its own id more than once")

    last = own[-1]
    tail = sql[last.end():].strip()
    # The inline/manual deployment workflow intentionally appends READ-ONLY verification SELECTs
    # after recording a migration. Preserve that exact staged SQL while still rejecting the thing
    # this guard exists to prevent: any schema/data mutation after the ledger says the migration is
    # complete. COMMIT is transaction control, not a post-ledger behavior change.
    if tail:
        verify_tail = re.sub(r"^\s*commit\s*;", "", tail, flags=re.I).strip()
        statements = [x.strip() for x in verify_tail.split(";") if x.strip()]
        allowed_sources = (
            "public.schema_migrations",
            "information_schema.columns",
            "information_schema.routines",
            "pg_publication_tables",
        )
        safe_verify = all(
            re.match(r"^select\b", stmt, re.I)
            and any(src in stmt.lower() for src in allowed_sources)
            and not re.search(r"\b(insert|update|delete|alter|create|drop|grant|revoke|truncate|call|do)\b", stmt, re.I)
            and "record_migration" not in stmt.lower()
            for stmt in statements
        )
        if not safe_verify:
            errors.append(f"{path.name}: only read-only verification SELECTs may follow record_migration")

# Every numbering gap inside the committed migrations sequence must be explicitly documented.
if nums:
    lo, hi = min(nums), max(nums)
    for n in range(lo, hi + 1):
        if n not in nums and not re.search(rf"\b{n:04d}\b.*(?:skip|reserved|gap)", NOTES, re.I):
            errors.append(f"migration number gap {n:04d} is not documented as skipped/reserved")

if errors:
    print("Migration ledger contract FAILED")
    print("\n".join(f"  - {e}" for e in errors))
    sys.exit(1)
print(f"Migration ledger contract: PASS ({sum(1 for n in nums if n >= 113)} migrations checked)")
