#!/usr/bin/env python3
"""212.35 — every TEAM skins engine call reads the tie setting through lib/game-shape skinsTieOf (1:1 skins ignored
"Halved" and always carried: computeHeadToHeadSkins had no tie argument). One reading, every screen."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
bad = []
for f in list((ROOT / "lib").rglob("*.ts")) + list((ROOT / "lib").rglob("*.tsx")) + list((ROOT / "components").rglob("*.tsx")) + list((ROOT / "app").rglob("*.tsx")):
    rel = f.relative_to(ROOT).as_posix()
    if ".test." in rel or "baseline" in rel or rel == "lib/golf.ts": continue
    s = f.read_text(encoding="utf-8")
    for m in re.finditer(r"(computeHeadToHeadSkins|computeTeamBestBallSkins)\(", s):
        depth, i = 1, m.end()
        while depth and i < len(s):
            depth += {"(": 1, ")": -1}.get(s[i], 0); i += 1
        call = s[m.start():i]
        if "skinsTieOf(" not in call:
            bad.append(f"{rel}:{s[:m.start()].count(chr(10)) + 1}: {m.group(1)} must pass skinsTieOf(game)")
if bad: print("SKINS TIE: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print("skins tie: PASS (every team skins call reads the tie setting through skinsTieOf)")
