#!/usr/bin/env python3
"""List idiom ratchet (212.123). DISPLAY_RULES Part 5 defines two list idioms: data rows (28px avatars) and list cards
(32px avatars); inline name chips use 22px and a profile hero 48/64. Any other <Avatar size> is drift — the existing
ones are frozen per file in ci/list_idiom_baseline.json and may only go down. Also checks that data-row and list-card
names keep their documented weights by forbidding the leaderboard serif on a person's name inside a list.
Run with --update after retiring sites."""
import json, pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = ROOT / "ci" / "list_idiom_baseline.json"
ALLOWED = {22, 28, 32, 48, 64}
counts = {}
for path in sorted(list((ROOT / "components").rglob("*.tsx")) + list((ROOT / "app").rglob("*.tsx"))):
    rel = str(path.relative_to(ROOT))
    if ".test." in rel: continue
    t = path.read_text(encoding="utf-8")
    n = sum(1 for v in re.findall(r"<Avatar[^>]*size=\{(\d+)\}", t) if int(v) not in ALLOWED)
    n += len(re.findall(r'fontFamily: "Georgia, serif"[^}]*}}>\{[a-zA-Z_.?]*(?:display_name|\.name)\}', t))
    if n: counts[rel] = n
if "--update" in sys.argv:
    BASE.write_text(json.dumps(counts, indent=2, sort_keys=True) + "\n"); print(f"list idiom baseline: {sum(counts.values())} site(s) in {len(counts)} file(s)"); sys.exit(0)
base = json.loads(BASE.read_text()) if BASE.exists() else {}
bad = [f"{f}: {n} (baseline {base.get(f, 0)})" for f, n in counts.items() if n > base.get(f, 0)]
lower = [f for f, n in base.items() if counts.get(f, 0) < n]
if bad:
    print("LIST IDIOM: FAIL — an avatar size outside {22, 28, 32, 48, 64} or a serif name in a list (DISPLAY_RULES Part 5):"); [print("  " + b) for b in bad]; sys.exit(1)
if lower:
    print("LIST IDIOM: debt was paid down — run: python3 ci/check_list_idiom.py --update"); [print("  " + f) for f in lower]; sys.exit(1)
print(f"list idiom: PASS ({sum(counts.values())} legacy site(s) frozen in {len(counts)} file(s); none new)")
