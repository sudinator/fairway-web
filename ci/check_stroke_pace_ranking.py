#!/usr/bin/env python3
"""212.31 — stroke play leaderboards rank on PAR PACE (strokes vs the par of the holes played), the rule Stableford
and the six-hole segments already use. Production game 494730 (Oct 23 2026) showed a player net 3 thru 1 (E) "leading"
a player net 6 thru 3 (-5) because the app and the public live page sorted on raw totals. One rule, two screens: both
must rank through lib/player-scoring strokePace."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
bad = []
ps = (ROOT / "lib/player-scoring.ts").read_text(encoding="utf-8")
m = re.search(r"export function rankVal\([^)]*\)[^{]*\{(.*?)\n\}", ps, re.S)
if not m or "strokePace(" not in m.group(1): bad.append("lib/player-scoring.ts rankVal must rank stroke play through strokePace")
if not re.search(r"export function strokePace\(total: number, parPlayed: number, thru: number\)", ps): bad.append("lib/player-scoring.ts must export strokePace(total, parPlayed, thru)")
live = (ROOT / "app/live/[token]/page.tsx").read_text(encoding="utf-8")
if not re.search(r'import \{[^}]*\bstrokePace\b[^}]*\} from "@/lib/player-scoring"', live): bad.append("app/live/[token]/page.tsx must import strokePace from lib/player-scoring")
mo = re.search(r"const metricOf = [^\n]*", live)
if not mo or "isStroke ? strokeMetric(p)" not in mo.group(0): bad.append("app/live/[token]/page.tsx metricOf must rank stroke play through strokeMetric (strokePace)")
sm = re.search(r"const strokeMetric = [^\n]*", live)
if not sm or "strokePace(" not in sm.group(0): bad.append("app/live/[token]/page.tsx strokeMetric must call strokePace")
if bad:
    print("STROKE PACE RANKING: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print("stroke pace ranking: PASS (app and live leaderboards rank stroke play on par pace, one shared rule)")
