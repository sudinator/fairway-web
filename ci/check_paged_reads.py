#!/usr/bin/env python3
"""210.4 — no silent 1,000-row cut-offs. Supabase returns at most 1,000 rows per request (tables AND list-returning
server functions). Every list read in the app must either go through lib/fetch-all (fetchAll / fetchAllIn / rpcAll)
or carry a `// bounded: <why>` note on the same line or the line before — a written judgement that the list is
naturally small (one game's players, one round's holes, one club's members). Single-row reads (.single(),
.maybeSingle()), explicit .limit(...) and count-only reads are exempt."""
import re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
LIST_FNS = set((ROOT / "ci" / "list_functions.txt").read_text().split())
READ = re.compile(r'\.from\("([a-z_]+)"\)\s*\.select\(|\.rpc\("([a-z_]+)"')
EXEMPT = re.compile(r'\.(single|maybeSingle)\(\)|\.limit\(|count:\s*"exact"|head:\s*true|\.range\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(')
bad = []
for path in list((ROOT / "components").rglob("*.ts*")) + list((ROOT / "lib").rglob("*.ts*")) + list((ROOT / "app").rglob("*.ts*")):
    if ".test." in path.name or path.name == "fetch-all.ts": continue
    lines = path.read_text(encoding="utf-8").split("\n")
    for i, line in enumerate(lines):
        for m in READ.finditer(line):
            table, fn = m.group(1), m.group(2)
            if fn and fn not in LIST_FNS: continue            # not a list-returning function
            stmt = " ".join(lines[i:i + 4])                   # the statement may continue on the next lines
            if EXEMPT.search(stmt.split(";")[0]): continue
            ctx = lines[i] + (lines[i - 1] if i else "")
            if "// bounded:" in ctx or re.search(r'fetchAll(In|Rpc)?<|rpcAll\(', ctx): continue
            bad.append(f"{path.relative_to(ROOT)}:{i + 1}: {table or fn}")
if bad:
    print("Unpaged list reads (page with lib/fetch-all, or add `// bounded: <why>`):")
    print("\n".join("  " + b for b in bad)); sys.exit(1)
print("Paged reads: PASS (every list read is paged or marked bounded)")
