#!/usr/bin/env python3
"""212.76 (owner, Oct 30): a live player's course handicap is read from ONE place — lib/game-shape (chBasis /
courseHandicapOf / hasCourseHandicap). Game 947286 showed CH 18 on the card and CH 13 on the leaderboard because the
leaderboard read the player row's STORED number after an override was cleared. This guard fails on any new direct read
of `.course_handicap` on a live-game player outside the accessor.

Allowed: a posted ROUND's snapshot (rounds-based files), the accessor itself, the manual editor's initial value and the
"was N" message (both deliberately read the stored/previous figure), and the writes that set it."""
import re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
# files whose `.course_handicap` is a ROUND's snapshot or the accessor itself
ROUND_FILES = {"lib/golf.ts", "lib/round-prep.ts", "lib/personal-bests.ts", "lib/season-summary.ts", "lib/badges.ts",
               "components/round-detail.tsx", "components/round-editor.tsx", "components/manage.tsx", "lib/draft.ts", "lib/game-shape.ts", "lib/manual-handicap.ts"}
# exact lines allowed elsewhere (deliberate reads of the stored / previous figure)
ALLOW = [
    re.compile(r"isManual && p\.course_handicap != null \? String\(p\.course_handicap\)"),   # the manual editor's initial value
    re.compile(r"was \$\{p\.course_handicap\}"),                                               # the "set your handicap … was N" message
    re.compile(r"course_handicap: p\.course_handicap"),                                       # passing the row INTO the accessor
    re.compile(r"course_handicap: (value|derived|ch|null|manual)"),                           # writes
]
bad = []
for path in list((ROOT / "components").rglob("*.tsx")) + list((ROOT / "lib").rglob("*.ts")) + list((ROOT / "lib").rglob("*.tsx")) + list((ROOT / "app").rglob("*.tsx")):
    rel = str(path.relative_to(ROOT))
    if ".test." in rel or rel in ROUND_FILES: continue
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not re.search(r"\.course_handicap\b(?!_)", line): continue
        if any(a.search(line) for a in ALLOW): continue
        bad.append(f"{rel}:{n}: {line.strip()[:110]}")
if bad:
    print("COURSE HANDICAP READS: FAIL — a live player's stored course_handicap read outside the accessor (use courseHandicapOf / hasCourseHandicap from lib/game-shape):")
    for b in bad: print("  " + b)
    sys.exit(1)
print("course handicap reads: PASS (every live-player course handicap comes from lib/game-shape)")
