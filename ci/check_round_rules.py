#!/usr/bin/env python3
"""210.5 — one definition of what a round is. Statistics code must use lib/round-rules (isFullCard, isValidRound,
isFull18, holeScore, handicapReading, countsForIndividualStats) instead of writing its own check — the private
checks are how an empty scorecard became "best gross 0" and a missing index became "20 → 0"."""
import re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
STATS = re.compile(r"^lib/(club-report|game-highlights|game-recap|recap-email|round-email|standout-watch|match-outcomes|cup-standing|season-summary|insights|course-insights)")
BANNED = [
    # the ELEMENT itself checked for null (scores) — not a recorded statistic like h.putts
    (re.compile(r"\.every\(\(?([a-z_]+)\)?\s*=>\s*\1\s*!=\s*null"), "a private 'every hole has a score' check — use isFullCard / isValidRound"),
    (re.compile(r"\.filter\(\(?[a-z_]*\)?\s*=>\s*[a-z_]+\s*!=\s*null\s*&&\s*Number\([a-z_]+\)\s*>\s*0\)"), "a private 'count scored holes' check — use scoredHoles / isValidRound"),
    (re.compile(r"Number\([^)]*handicap_index"), "converting a handicap index directly (a missing index becomes 0) — use handicapReading"),
]
bad = []
for path in sorted((ROOT / "lib").rglob("*.ts")):
    rel = str(path.relative_to(ROOT))
    if ".test." in rel or not STATS.match(rel): continue
    for i, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
        for rx, why in BANNED:
            if rx.search(line): bad.append(f"{rel}:{i}: {why}")
if bad:
    print("Round rules: FAIL — statistics code must use lib/round-rules:"); print("\n".join("  " + b for b in bad)); sys.exit(1)
print("Round rules: PASS (statistics code uses lib/round-rules)")
