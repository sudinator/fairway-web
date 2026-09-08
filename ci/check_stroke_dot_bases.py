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
# Discovered, NOT hand-listed. The 185.0 audit hand-wrote this list from surfaces it knew about and
# missed the public share card entirely, which then shipped drawing its own hardcoded dot.
def dot_surfaces() -> list[str]:
    out = []
    for base in ("components", "app"):
        for f in sorted((ROOT / base).rglob("*.tsx")):
            rel = f.relative_to(ROOT).as_posix()
            if "node_modules" in rel or ".test." in rel:
                continue
            src = f.read_text(encoding="utf-8")
            if "BASIS_COLOR" in src or "strokeGlyph" in src or "strokeSets(" in src:
                out.append(rel)
    return out
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

    surfaces = dot_surfaces()
    if len(surfaces) < 3:
        fails.append(f"expected at least 3 dot-drawing surfaces, found {surfaces} — discovery is broken")
    for rel in surfaces:
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

    # Shape is the primary channel; colour alone cannot separate three bases at 6px for
    # colour-blind readers. One glyph definition, shared by every surface.
    ui = (ROOT / "components" / "ui.tsx").read_text(encoding="utf-8")
    if "export function strokeGlyph(" not in ui:
        fails.append("components/ui.tsx: strokeGlyph must exist — one glyph definition for every surface")
    else:
        g = ui[ui.index("export function strokeGlyph("):][:1600]
        for need, why in (("polygon", "triangle (off your opponent)"), ("borderRadius: key === \"group_low\" ? 1 : 999", "square vs circle"), ("gives", "hollow variant for strokes GIVEN")):
            if need not in g:
                fails.append(f"strokeGlyph is missing the {why}")
    for rel in surfaces:
        src = (ROOT / rel).read_text(encoding="utf-8")
        code = code_lines(src)
        if "BASIS_COLOR" in code and "strokeGlyph" not in code:
            fails.append(f"{rel}: draws basis-coloured marks without strokeGlyph — shape must carry the basis, not colour alone")

    print(f"stroke-dot bases: {len(TOKENS)} tokens, {len(surfaces)} dot surfaces discovered")
    for f in fails:
        print("FAIL", f)
    if fails:
        return 1
    print("PASS every stroke dot comes from strokeSets with one basis, one colour and a label")
    return 0


if __name__ == "__main__":
    sys.exit(main())
