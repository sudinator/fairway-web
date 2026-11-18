#!/usr/bin/env python3
"""Native browser dialogs — BANNED since 212.124 (ratchet reached zero; introduced 212.122). confirm()/alert()/prompt() show a grey system box headed with the web
address on a phone — off-brand. Use askConfirm() (components/confirm) and notifyError/notifyInfo (components/toast).
The remaining sites are frozen per file in ci/native_dialogs_baseline.json and may only go DOWN; a file at zero may
never gain one. The two fallbacks (confirm.tsx, toast.tsx — used only when no host is mounted) are exempt.
Run with --update after migrating sites to lower the baseline."""
import json, pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = ROOT / "ci" / "native_dialogs_baseline.json"
EXEMPT = {"components/confirm.tsx", "components/toast.tsx"}
PAT = re.compile(r"(?<![\w.])(?:window\.)?(?:confirm|alert|prompt)\(")
counts = {}
for path in sorted(list((ROOT / "components").rglob("*.tsx")) + list((ROOT / "app").rglob("*.tsx")) + list((ROOT / "lib").rglob("*.tsx"))):
    rel = str(path.relative_to(ROOT))
    if ".test." in rel or rel in EXEMPT: continue
    n = sum(1 for line in path.read_text(encoding="utf-8").splitlines() if PAT.search(line) and not line.strip().startswith("//"))
    if n: counts[rel] = n
if "--update" in sys.argv:
    BASE.write_text(json.dumps(counts, indent=2, sort_keys=True) + "\n"); print(f"native dialogs baseline: {sum(counts.values())} site(s) in {len(counts)} file(s)"); sys.exit(0)
base = json.loads(BASE.read_text()) if BASE.exists() else {}
bad = [f"{f}: {n} (baseline {base.get(f, 0)})" for f, n in counts.items() if n > base.get(f, 0)]
lower = [f for f, n in base.items() if counts.get(f, 0) < n]
if bad:
    print("NATIVE DIALOGS: FAIL — new confirm()/alert()/prompt(); use askConfirm / notifyError:"); [print("  " + b) for b in bad]; sys.exit(1)
if lower:
    print("NATIVE DIALOGS: debt was paid down — run: python3 ci/check_native_dialogs.py --update"); [print("  " + f) for f in lower]; sys.exit(1)
print(f"native dialogs: PASS ({sum(counts.values())} legacy site(s) frozen in {len(counts)} file(s); none new)")
