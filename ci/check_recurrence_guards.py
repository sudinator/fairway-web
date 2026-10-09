#!/usr/bin/env python3
"""Guards for incidents that have already happened once and must not happen twice (audit, 201.4).
Each check names the release where the class of bug last shipped. Negative-tested in the audit.

  A. Server-side wall-clock formatting (199.2): code that runs on the server (app/api/**, lib/push-send.ts,
     ci/external/*.mjs) must not format a time for display without an explicit timeZone — Vercel runs in
     UTC and "2:38am" reached a user at 10:38pm. Migrations from 0176 on: to_char() of a timestamptz
     column must carry `at time zone`.
  B. NULL-unsafe SQL assertions (201.2): in ci/assert-*.sql, `if <var> <> 'x'` or `if <var> not like 'x'`
     on a plpgsql variable never raises when the variable is NULL — a missing row passes. Use
     `is distinct from` / `is null or not like`.
  C. is_admin() called with an argument (188.2): the helper takes none; a call with one silently
     resolved to nothing and "Create live link did nothing".
  D. Fixed listen ports in CI helpers (197.1, 197.2): the runner shares its network with the Supabase CLI
     stack, whose ports move between versions. Bind 0.
  E. Ad-hoc first-name shortening (202.2): `name.split(" ")[0]` scattered across seven files showed three
     "Amit"s on one scorecard. lib/short-names.ts is the one rule (first name unless it collides, then
     last initial, then full name); components and lib must go through it. components/player-card.tsx is
     the documented exception (a single person's own name; no set to collide with).
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
problems = []

# A. server-side time formatting
server_files = list((ROOT / "app" / "api").rglob("*.ts")) + [ROOT / "lib" / "push-send.ts"] + list((ROOT / "ci" / "external").glob("*.mjs"))
for f in server_files:
    if not f.exists(): continue
    src = f.read_text(encoding="utf-8")
    for i, line in enumerate(src.splitlines(), 1):
        if re.search(r"\.toLocale(Time|Date)?String\(|Intl\.DateTimeFormat\(", line) and "timeZone" not in line:
            problems.append(f"A {f.relative_to(ROOT)}:{i}: formats a time on the server without timeZone (199.2)")
for m in sorted((ROOT / "migrations").glob("*.sql")):
    try: num = int(m.name[:4])
    except ValueError: continue
    if num < 176: continue
    for i, line in enumerate(m.read_text(encoding="utf-8").splitlines(), 1):
        if re.search(r"to_char\(\s*[\w.]*(_at|now\(\))\b", line) and "at time zone" not in line:
            problems.append(f"A {m.relative_to(ROOT)}:{i}: to_char() of a timestamp without `at time zone` (199.2)")

# B. NULL-unsafe assertions
for f in sorted((ROOT / "ci").glob("assert-*.sql")):
    for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        m = re.search(r"\bif\s+([a-z_][a-z0-9_]*)\s+(<>|not like)\s+'", line)
        if m and m.group(1) not in ("current_user", "session_user", "current_role"):
            problems.append(f"B {f.relative_to(ROOT)}:{i}: `if {m.group(1)} {m.group(2)} '…'` is NULL-unsafe — use `is distinct from` / `is null or not like` (201.2)")

# C. is_admin() with an argument
for f in list((ROOT / "migrations").glob("*.sql")) + list((ROOT / "components").rglob("*.tsx")) + list((ROOT / "lib").rglob("*.ts")) + list((ROOT / "app").rglob("*.ts*")):
    src = f.read_text(encoding="utf-8", errors="ignore")
    for i, line in enumerate(src.splitlines(), 1):
        if re.search(r"\bis_admin\(\s*[^)\s]", line) and "function public.is_admin(" not in line and not line.lstrip().startswith("--") and not line.lstrip().startswith("//"):
            problems.append(f"C {f.relative_to(ROOT)}:{i}: is_admin() called with an argument — the helper takes none (188.2)")

# D. fixed ports
for f in (ROOT / "ci").rglob("*.mjs"):
    for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        if re.search(r"\.listen\(\s*[1-9]\d*", line):
            problems.append(f"D {f.relative_to(ROOT)}:{i}: fixed listen port in a CI helper — bind 0 (197.2)")

# E. ad-hoc name shortening
ALLOW_E = {ROOT / "lib" / "short-names.ts", ROOT / "components" / "player-card.tsx"}
for f in list((ROOT / "components").rglob("*.tsx")) + list((ROOT / "lib").rglob("*.ts")):
    if f in ALLOW_E or f.name.endswith(".test.ts") or f.name.endswith(".test.tsx"): continue
    for i, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
        if re.search(r"\.split\(\s*[\"']\s[\"']\s*\)\s*\[\s*0\s*\]|\.split\(/\\s\+/\)", line) and ("name" in line.lower()):
            problems.append(f"E {f.relative_to(ROOT)}:{i}: shortens a name by hand — use shortNamer/shortLabels from lib/short-names (202.2)")

if problems:
    print("recurrence guards: FAIL")
    for p in problems: print("  " + p)
    sys.exit(1)
print("recurrence guards: PASS (server time formatting, NULL-safe assertions, is_admin arity, OS-assigned ports, one name-shortening rule)")
