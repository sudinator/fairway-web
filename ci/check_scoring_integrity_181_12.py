#!/usr/bin/env python3
"""Permanent source contract for the 181.12 scoring-integrity corrections."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
golf = (ROOT / "lib/golf.ts").read_text(encoding="utf-8")
shape = (ROOT / "lib/game-shape.ts").read_text(encoding="utf-8")
competition = (ROOT / "lib/competition.ts").read_text(encoding="utf-8")
skins = (ROOT / "components/game/scoring-views.tsx").read_text(encoding="utf-8")
room = (ROOT / "components/tournaments.tsx").read_text(encoding="utf-8")
tests = (ROOT / "lib/golf.test.ts").read_text(encoding="utf-8")

checks = [
    ("rounded CH delegates to exact CH", "const exact = courseHandicapExact(index, slope, rating, par);" in golf),
    ("game shape delegates to exact CH", "courseHandicapExact(p.handicap_index, p.slope, p.rating, coursePar)" in shape),
    ("offline reconciliation is three-way", "watermark?:" in golf and "return wv == null ? lv : null" in golf),
    ("reload supplies confirmed watermark", "mergeBackupRow(p, backup, n, watermark)" in room),
    ("remote-clear regression exists", "remote clear defeats stale device score" in tests),
    ("Team Skins exposes unattributed total", "unassignedTotal" in skins and "Setup needs attention" in skins),
    ("Cup Trifecta rejects mismatched contract", "Ryder Cup Trifecta requires Best Ball team scoring and Match scoring" in competition),
    ("Cup Trifecta passes stored settings", "game.team_score_mode!, !!f.swap, game.trifecta_scoring!" in competition),
    ("Cup Trifecta no longer hardcodes settings", '\"best_ball\", !!f.swap, \"match\"' not in competition),
]

failed = [name for name, passed in checks if not passed]
if failed:
    print("181.12 scoring integrity: FAIL")
    for name in failed:
        print(f"  - {name}")
    raise SystemExit(1)

print(f"181.12 scoring integrity: PASS ({len(checks)}/{len(checks)})")
