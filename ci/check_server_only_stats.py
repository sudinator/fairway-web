#!/usr/bin/env python3
"""211.6 — badges and player cards are computed by the SERVER (lib/member-stats-server.ts). The modules that write
them (lib/badge-sync, lib/card-sync) may only be imported there (and by tests): a screen importing them would mean
the phone writing results the server should decide — and since 0207 / 0208, those writes would fail silently."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
ALLOWED = {"lib/member-stats-server.ts"}
bad = []
for f in list(ROOT.glob("components/**/*.tsx")) + list(ROOT.glob("components/**/*.ts")) + list(ROOT.glob("app/**/*.ts*")) + list(ROOT.glob("lib/**/*.ts*")):
    rel = str(f.relative_to(ROOT))
    if rel in ALLOWED or ".test." in rel or rel in ("lib/badge-sync.ts", "lib/card-sync.ts"): continue
    src = f.read_text(encoding="utf-8", errors="replace")
    if re.search(r'from\s+["\'](@/lib/|\./|\.\./)*(lib/)?(badge-sync|card-sync)["\']', src): bad.append(rel)
if bad:
    print("SERVER-ONLY STATS: FAIL — badge-sync / card-sync imported outside the server:\n  " + "\n  ".join(bad)); sys.exit(1)
print("server-only stats: PASS (badges and player cards are written only by lib/member-stats-server)")
