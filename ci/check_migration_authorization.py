#!/usr/bin/env python3
"""Guard: privileged migrations must declare their authorization model.

Any migration numbered >= 0125 (when the standard took effect) that creates SECURITY DEFINER
functions or grants execute to authenticated/anon/public must contain an `-- AUTHORIZATION:` header
line stating who may call it and how that is enforced inside the function. See SECURITY_CHECKLIST.md.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENFORCE_FROM = 125

def migration_number(p: Path):
    m = re.match(r"^(\d+)_", p.name)
    return int(m.group(1)) if m else None

def main() -> int:
    failures = []
    for d in (ROOT / "migrations", ROOT / "supabase" / "migrations"):
        if not d.exists():
            continue
        for f in sorted(d.glob("*.sql")):
            n = migration_number(f)
            if n is None or n < ENFORCE_FROM:
                continue
            text = f.read_text(encoding="utf-8", errors="replace")
            low = text.lower()
            privileged = ("security definer" in low) or re.search(
                r"grant\s+execute[^;]*to\s+(authenticated|anon|public)", low)
            if privileged and "-- authorization:" not in low:
                failures.append(
                    f"{f.relative_to(ROOT)}: contains SECURITY DEFINER or a broad EXECUTE grant "
                    f"but no '-- AUTHORIZATION:' header (see SECURITY_CHECKLIST.md)")
    if failures:
        print("MIGRATION AUTHORIZATION GUARD FAILED:")
        for x in failures:
            print("  " + x)
        return 1
    print("migration authorization guard: ok")
    return 0

if __name__ == "__main__":
    sys.exit(main())
