#!/usr/bin/env python3
"""
Every error string a CI SQL assertion matches on must still be raised by some migration.

The SQL assertions in ci/assert-*.sql verify authorization and locking by catching an exception and
checking `position('some text' in sqlerrm)`. That coupling is invisible from the TypeScript side: a
migration can replace a function, keep the behaviour, reword the message, and the assertion silently
stops proving anything — it reports "unexpectedly allowed" for a call that was in fact denied.

That is exactly what happened with 0153: it replaced change_game_match_length_before_scoring and
reworded 'Only the game organizer can change the number of holes'. The rebuild failed on a real
database and the failure looked like an authorization hole rather than a wording change.

This catches it without a database.

    python3 ci/check_sql_assertion_messages.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
PAT = re.compile(r"position\(\s*'([^']+)'\s+in\s+sqlerrm\s*\)")


def main() -> int:
    # Only the LAST definition of each function survives a rebuild. Concatenating every migration
    # would let an OLD copy of a message satisfy the check while the live function no longer raises
    # it — which is precisely the failure this guard exists to catch, so it must not be fooled by it.
    files = sorted((ROOT / "supabase" / "migrations").glob("*.sql")) + sorted((ROOT / "migrations").glob("*.sql"))
    latest: dict[str, str] = {}
    loose: list[str] = []
    fn_re = re.compile(r"create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)\s*\(", re.I)
    for f in files:
        src = f.read_text(encoding="utf-8", errors="replace")
        marks = [(m.start(), m.group(1).lower()) for m in fn_re.finditer(src)]
        if not marks:
            loose.append(src)
            continue
        for k, (pos, name) in enumerate(marks):
            end = marks[k + 1][0] if k + 1 < len(marks) else len(src)
            latest[name] = src[pos:end]          # later files overwrite earlier ones
        loose.append(src[: marks[0][0]])         # non-function SQL (policies, triggers, DO blocks)
    migrations = "\n".join(list(latest.values()) + loose)

    # Tie each needle to the function the assertion actually CALLS, not to the migrations at large.
    # "Some function still raises this string" is too loose: another function may legitimately use
    # the same wording, and the check would pass while the function under test no longer raises it.
    call_re = re.compile(r"(?:perform|select)\s+public\.(\w+)\s*\(", re.I)
    fails: list[str] = []
    checked = 0
    for f in sorted((ROOT / "ci").glob("assert-*.sql")):
        src = f.read_text(encoding="utf-8")
        for block in re.split(r"(?i)\bdo\s+\$\$", src):
            needles = PAT.findall(block)
            if not needles:
                continue
            called = call_re.findall(block)
            for needle in needles:
                checked += 1
                bodies = [latest[c.lower()] for c in called if c.lower() in latest]
                haystack = "\n".join(bodies) if bodies else migrations
                if needle not in haystack:
                    where = ", ".join(sorted(set(called))) or "the migrations"
                    fails.append(
                        f"ci/{f.name}: matches on '{needle}', which {where} no longer raises — the "
                        f"assertion cannot pass for the right reason, and reports a denial as a hole"
                    )

    print(f"SQL assertion messages: {checked} matched string(s) checked")
    for x in fails:
        print("FAIL", x)
    if checked == 0:
        print("FAIL found no sqlerrm assertions — the guard is miswired")
        return 1
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
