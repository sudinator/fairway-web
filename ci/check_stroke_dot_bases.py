#!/usr/bin/env python3
"""
Every stroke dot has ONE basis, ONE colour, and a written label (185.0).

Before this, orange meant "whatever this format scores off" — the full course handicap in Stableford,
the match basis in a four-ball — so the same dot meant different things by game, and a Trifecta drew
the team-leg basis and the course handicap while the SINGLES basis (which decides two of the three
points) was drawn nowhere.

Rules:
  1. Surfaces that draw dots take them from lib/game-shape.strokeSets, not from ad-hoc arithmetic.
  2. The legacy dot colours C.dot / C.indivDot are not used for stroke dots any more — the basis
     tokens are (C.basisCourse / C.basisOpponent / C.basisGroupLow and their *Dark* variants).
     C.indivDot in particular is tuned for dark grounds and measured 1.83:1 on the cream scorecard.
  3. Each basis token is defined as a light/dark PAIR, because no single hex is legible on both the
     cream card and the dark green header.
  4. strokeSets never returns an unlabelled basis.

    python3 ci/check_stroke_dot_bases.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
DOT_SURFACES = ["components/ui.tsx", "components/game/scorecard-views.tsx"]
TOKENS = ["basisCourse", "basisCourseDark", "basisOpponent", "basisOpponentDark", "basisGroupLow", "basisGroupLowDark"]


def code_lines(src: str) -> str:
    """Strip comments properly — a wrapped `/* ... */` continuation line does not start with `*`,
    and the comments here legitimately NAME the legacy colours while explaining why they are gone."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return "\n".join(re.sub(r"//.*$", "", l) for l in src.split("\n"))


def main() -> int:
    fails: list[str] = []
    golf = (ROOT / "lib" / "golf.ts").read_text(encoding="utf-8")
    shape = (ROOT / "lib" / "game-shape.ts").read_text(encoding="utf-8")

    for t in TOKENS:
        if not re.search(rf"\b{t}:\s*\"#", golf):
            fails.append(f"lib/golf.ts: basis token `{t}` is not defined — each basis needs a light/dark pair")

    if "export function strokeSets(" not in shape:
        fails.append("lib/game-shape.ts: strokeSets must exist — it is the single source for every dot")
    else:
        body = shape[shape.index("export function strokeSets("):]
        for m in re.finditer(r"key:\s*\"(\w+)\"", body):
            seg = body[m.start():m.start() + 400]
            if "label:" not in seg:
                fails.append(f"strokeSets returns basis `{m.group(1)}` without a label")

    # Whoever supplies the card's sets must compute them from the one source.
    tour = (ROOT / "components" / "tournaments.tsx").read_text(encoding="utf-8")
    if "strokeSets(" not in code_lines(tour):
        fails.append("components/tournaments.tsx: must supply the card's stroke sets from strokeSets")

    for rel in DOT_SURFACES:
        src = (ROOT / rel).read_text(encoding="utf-8")
        code = code_lines(src)
        # A surface either computes the sets itself or receives them as data. ScoreEntryCard takes
        # them as a prop from its caller; that caller must be the one calling strokeSets.
        if "strokeSets(" not in code and "sets" not in code:
            fails.append(f"{rel}: draws dots but neither calls strokeSets nor consumes a sets prop")
        for legacy in ("C.dot", "C.indivDot"):
            for m in re.finditer(rf"{re.escape(legacy)}\b", code):
                line = src.count("\n", 0, src.find(code[max(0, m.start() - 20):m.start() + 10])) + 1
                fails.append(f"{rel}: legacy dot colour `{legacy}` still used for a stroke dot (line ~{line}) — use a basis token")

    print(f"stroke-dot bases: {len(TOKENS)} tokens, {len(DOT_SURFACES)} dot surfaces checked")
    for f in fails:
        print("FAIL", f)
    if fails:
        return 1
    print("PASS every stroke dot comes from strokeSets with one basis, one colour and a label")
    return 0


if __name__ == "__main__":
    sys.exit(main())
