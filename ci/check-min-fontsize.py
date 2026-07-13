#!/usr/bin/env python3
"""Fail if any shipped source sets a font under 11px (the app's minimum readable size).

Catches three literal forms: fontSize: N, fontSize: "Npx"/'Npx'/`Npx`, and CSS font-size:Npx.
Dynamic sizes (fontSize: someVar / expression) can't be checked statically and are the author's
responsibility; the known dynamic floors (Avatar initialsFont) are hard-floored at 11 in code.
Mockups (mockups/) are excluded — they aren't shipped."""
import os, re, sys

ROOTS = ["components", "lib", "app"]
FLOOR = 11.0
num_re = re.compile(r'fontSize\s*:\s*(\d+(?:\.\d+)?)\b')
px_re  = re.compile(r'''fontSize\s*:\s*['"`]\s*(\d+(?:\.\d+)?)px''')
css_re = re.compile(r'font-size\s*:\s*(\d+(?:\.\d+)?)px')

bad = []
for r in ROOTS:
    for dp, dn, fn in os.walk(r):
        if "node_modules" in dp or ".next" in dp:
            continue
        for f in fn:
            if not f.endswith((".tsx", ".ts", ".jsx", ".js", ".css")):
                continue
            fp = os.path.join(dp, f)
            for i, line in enumerate(open(fp, encoding="utf-8", errors="ignore"), 1):
                for m in list(num_re.finditer(line)) + list(px_re.finditer(line)) + list(css_re.finditer(line)):
                    if float(m.group(1)) < FLOOR:
                        bad.append(f"{fp}:{i}  fontSize {m.group(1)} (< {FLOOR:g})  | {line.strip()[:100]}")

if bad:
    print(f"FONT-SIZE CHECK FAILED — {len(bad)} font(s) under {FLOOR:g}px:")
    for b in bad:
        print("  " + b)
    sys.exit(1)
print(f"font-size check passed: no shipped font under {FLOOR:g}px")
