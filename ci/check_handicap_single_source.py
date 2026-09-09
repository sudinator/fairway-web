#!/usr/bin/env python3
"""
Every scorer derives a handicap through lib/game-shape.chBasis — never from handicap_index or
course_handicap directly.

chBasis is where the manual-course-handicap rule lives (0153): a manual figure is used as given, is
NOT halved for a nine, and still takes the allowance. A scorer that reads `course_handicap` or
recomputes from index/slope/rating bypasses all of that and silently ignores manual handicaps —
and the failure is invisible, because the result is still a plausible number of strokes.

Scoring surfaces only. Setup screens legitimately read and write the raw columns, as do the fixtures
that construct player rows.

    python3 ci/check_handicap_single_source.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
# Files whose job is to SCORE. Setup/entry UI is excluded: it edits the raw values by design.
SCORERS = [
    # lib/golf.ts is excluded: it DEFINES courseHandicapExact and the allowance primitives that
    # chBasis itself composes. Guarding it would forbid the implementation.
    "lib/competition.ts", "lib/live-scoring.ts", "lib/live-competition.ts",
    "lib/player-scoring.ts", "lib/segments.ts", "lib/alt-shot.ts",
    "components/game/scoring-views.tsx", "components/game/scorecard-views.tsx",
]
# A READ, not a declaration. `handicap_index?: number | null` in a type is fine; `p.handicap_index`
# used in an expression is not. Requires a leading dot and no following colon.
# A READ that feeds scoring — not a type declaration (`handicap_index?: number`) and not a presence
# check (`pp.course_handicap == null ? "-" : ...`), where the VALUE still goes through chBasis.
RAW = re.compile(
    r"\bcourseHandicapExact\s*\("
    # `?:` is an optional property and `:` a type annotation; `??` is nullish coalescing and IS a
    # read. Treating them alike let `q.course_handicap ?? 0` through.
    #
    # `.handicap_index` is deliberately NOT matched on its own. An index cannot become a scoring
    # handicap without courseHandicapExact, which IS matched — and carrying an index around for
    # DISPLAY is legitimate (the Cup roster shows it). Flagging every read of it produced a false
    # positive on exactly that, and a guard that cries wolf gets exceptions added until it is inert.
    r"|\.course_handicap\b(?!\s*(?:\?(?!\?)|:|[=!]=))"
)


def code_only(src: str) -> str:
    """Blank out comments while PRESERVING line structure, so reported line numbers are the file's.
    Collapsing them shifts every offset and the guard reports lines that do not contain the match."""
    blank = lambda m: re.sub(r"[^\n]", " ", m.group(0))
    src = re.sub(r"/\*.*?\*/", blank, src, flags=re.S)
    # Blank `//` comments to SPACES as well. Deleting them shortens lines and every offset after
    # that point maps to the wrong line — the guard then reports code that has no match on it.
    return "\n".join(re.sub(r"//.*$", blank, l) for l in src.split("\n"))


def main() -> int:
    fails: list[str] = []
    checked = 0
    for rel in SCORERS:
        f = ROOT / rel
        if not f.exists():
            fails.append(f"{rel}: listed as a scorer but does not exist — the list is stale")
            continue
        checked += 1
        src = f.read_text(encoding="utf-8")
        for m in RAW.finditer(code_only(src)):
            line = src.count("\n", 0, m.start()) + 1
            fails.append(f"{rel}:~{line}: reads `{m.group(0).strip('(')}` directly — go through chBasis, "
                         f"or manual course handicaps (0153) are silently ignored here")

    shape = (ROOT / "lib" / "game-shape.ts").read_text(encoding="utf-8")
    if 'course_handicap_source === "manual"' not in shape:
        fails.append("lib/game-shape.ts: chBasis no longer honours a manual course handicap")
    # NOT checked here: that a manual figure escapes the nine-hole halving. Position in the source
    # does not prove it — the branch can sit anywhere and still short-circuit — so asserting on
    # ordering would pass for the wrong reason. lib/manual-handicap.test.ts proves the BEHAVIOUR:
    # chBasis(manual, par, 9) must equal the entered figure, and explicitly must not be half of it.

    print(f"handicap single source: {checked} scoring surface(s) checked")
    for x in fails:
        print("FAIL", x)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
