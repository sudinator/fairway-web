#!/usr/bin/env python3
"""212.37 — skins counts print through ONE function, lib/skins-format fmtSkins (thirds and quarters as ⅓ ⅔ ¼ ¾). Local
printers knew only halves (⅓ read "0") or nothing ("1.6666666666666665"). Every file that shows a skins count uses it."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
bad = []
for f in list((ROOT / "lib").rglob("*.ts*")) + list((ROOT / "components").rglob("*.tsx")) + list((ROOT / "app").rglob("*.tsx")):
    rel = f.relative_to(ROOT).as_posix()
    if ".test." in rel or "baseline" in rel or rel == "lib/skins-format.ts": continue
    s = f.read_text(encoding="utf-8")
    if re.search(r"(const|function)\s+fmtSkins\b", s): bad.append(f"{rel}: defines its own fmtSkins — import it from lib/skins-format")
must = ["lib/game-recap.ts", "lib/game-recap-sections.ts", "lib/recap-email.ts", "components/game/recap-body.tsx", "components/game/scoring-views.tsx", "app/live/[token]/page.tsx"]
for rel in must:
    s = (ROOT / rel).read_text(encoding="utf-8")
    if not re.search(r'import \{[^}]*\bfmtSkins\b[^}]*\} from "@/lib/skins-format"', s): bad.append(f"{rel}: must print skins with fmtSkins from lib/skins-format")
if bad: print("SKINS FORMAT: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print("skins format: PASS (every skins count prints through lib/skins-format)")
