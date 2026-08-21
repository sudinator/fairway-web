#!/usr/bin/env python3
"""Audit every inline Supabase call — classify, do not change.

The app talks to the database from 25 different files. This inventories every call site so the
question "which of these should move behind a repository" can be answered from evidence rather
than instinct. Nothing is modified.

Each call is classified on four axes:

  TABLE      what it touches
  OP         read / insert / update / upsert / delete / rpc / auth / storage
  ERROR      does anything inspect the result — checked / silent / try-caught
  SHAPE      the normalised query, so identical queries in different files are visible as
             duplicates. This is the axis that matters most: a query written five times is five
             places to update when the schema moves, and five chances to update only four.

    python3 ci/audit_supabase_calls.py            summary
    python3 ci/audit_supabase_calls.py --dupes    query shapes written in more than one file
    python3 ci/audit_supabase_calls.py --full     every call site
    python3 ci/audit_supabase_calls.py --csv      machine-readable
"""
import csv
import io
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODE = sys.argv[1] if len(sys.argv) > 1 else ""

# A call runs from `supabase.` to the end of its statement. Chains span lines, so the scan is
# brace/paren aware rather than line-based — a line-based regex would truncate most of them.
START = re.compile(r"\bsupabase\s*\.\s*(from|rpc|auth|storage)\b")


def extract(src, i):
    """Return the full chained expression beginning at index i."""
    depth, j, n = 0, i, len(src)
    while j < n:
        c = src[j]
        if c in "\"'`":
            q, j = c, j + 1
            while j < n and src[j] != q:
                j += 2 if src[j] == "\\" else 1
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth < 0:
                break
        elif c in ";\n" and depth == 0:
            # a newline at depth 0 ends the statement unless the chain continues
            k = j
            while k < n and src[k] in " \n\t":
                k += 1
            if k < n and src[k] == ".":
                j = k
                continue
            break
        j += 1
    return src[i:j]


def enclosing(src, pos):
    best = "?"
    for m in re.finditer(
        r"(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*[:=][^=]*?=>", src[:pos]
    ):
        best = m.group(1) or m.group(2)
    return best


def classify(expr, context):
    table = (re.search(r'from\(\s*["\']([\w.]+)["\']', expr) or [None, ""])[1] \
        if "from(" in expr else ""
    if ".rpc(" in expr:
        op = "rpc"
        table = (re.search(r'rpc\(\s*["\']([\w.]+)["\']', expr) or [None, ""])[1]
    elif ".auth" in expr:
        op, table = "auth", "auth"
    elif ".storage" in expr:
        op, table = "storage", "storage"
    else:
        op = next((o for o in ("insert", "upsert", "update", "delete") if f".{o}(" in expr), "read")

    # Error handling: destructured `error`, an `if (error)` nearby, or a try/catch around it.
    if re.search(r"\berror\b", expr) or re.search(r"\berror\b", context[-260:]):
        err = "checked"
    elif re.search(r"try\s*\{[^}]{0,400}$", context, re.S):
        err = "try-caught"
    else:
        err = "SILENT"

    # Normalised shape: table + op + the selected columns or mutated keys, whitespace collapsed.
    sel = (re.search(r'\.select\(\s*["\']([^"\']*)["\']', expr) or [None, ""])[1]
    shape = f"{table}.{op}({re.sub(r'\\s+', '', sel)[:44]})"
    return table, op, err, shape


rows = []
for d in ("components", "app", "lib"):
    for f in sorted((ROOT / d).rglob("*.ts*")):
        if ".test." in f.name:
            continue
        src = f.read_text(encoding="utf-8", errors="replace")
        for m in START.finditer(src):
            expr = extract(src, m.start())
            table, op, err, shape = classify(expr, src[max(0, m.start() - 400):m.start()])
            rows.append({
                "file": str(f.relative_to(ROOT)),
                "line": src[:m.start()].count("\n") + 1,
                "fn": enclosing(src, m.start()),
                "table": table, "op": op, "error": err, "shape": shape,
            })

if MODE == "--csv":
    w = csv.DictWriter(sys.stdout, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
    sys.exit(0)

if MODE == "--full":
    for r in sorted(rows, key=lambda x: (x["file"], x["line"])):
        print(f"  {r['file']}:{r['line']:<5} {r['op']:<8}{r['table']:<22}{r['error']:<11}{r['fn']}")
    sys.exit(0)

byshape = defaultdict(list)
for r in rows:
    byshape[r["shape"]].append(r)

if MODE == "--dupes":
    dup = {k: v for k, v in byshape.items() if len({x["file"] for x in v}) > 1}
    print(f"QUERY SHAPES WRITTEN IN MORE THAN ONE FILE — {len(dup)}\n")
    for shape, v in sorted(dup.items(), key=lambda x: -len(x[1])):
        files = sorted({x["file"].replace("components/", "") for x in v})
        print(f"  {len(v):>3}x  {shape}")
        print(f"        {', '.join(files)}")
    sys.exit(0)

print(f"INLINE SUPABASE CALLS — {len(rows)} across {len({r['file'] for r in rows})} files\n")
print("BY OPERATION")
for k, n in Counter(r["op"] for r in rows).most_common():
    print(f"  {n:>4}  {k}")
print("\nBY ERROR HANDLING")
for k, n in Counter(r["error"] for r in rows).most_common():
    print(f"  {n:>4}  {k}")
print("\nBY TABLE (top 12)")
for k, n in Counter(r["table"] for r in rows).most_common(12):
    print(f"  {n:>4}  {k}")
print("\nBY FILE (top 12)")
for k, n in Counter(r["file"].replace("components/", "") for r in rows).most_common(12):
    print(f"  {n:>4}  {k}")
dup = {k: v for k, v in byshape.items() if len({x["file"] for x in v}) > 1}
print(f"\nDUPLICATION\n  {len(byshape)} distinct query shapes")
print(f"  {len(dup)} of them written in more than one file ({sum(len(v) for v in dup.values())} call sites)")
