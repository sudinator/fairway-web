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
import json
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
# Files whose job is to SCORE. Setup/entry UI is excluded: it edits the raw values by design.
# DISCOVERED, not hand-listed. A hand-written list is why components/round-editor.tsx kept its own
# handicap path through three releases: the file was never on it, so the guard had nothing to say
# about the screen a new round is actually scored on.
#
# Every file that mentions a handicap is examined. A file may only be skipped if it is named here
# WITH A REASON, so adding a new screen fails the guard by default instead of passing silently.
EXEMPT = {
    "lib/golf.ts": "defines courseHandicapExact and the allowance primitives chBasis composes",
    "lib/game-shape.ts": "defines chBasis itself",
    "lib/player-scoring.baseline.ts": "frozen baseline copy, compared against by a differential test",
    "components/game/organizer-panel.tsx": "setup UI: edits the raw columns by design",
    "components/game/setup/game-setup-workspace.tsx": "setup UI: edits the raw columns by design",
    "components/tournaments.tsx": "owns the setup save paths that write the raw columns",
    "components/round-editor.tsx": "round setup: writes course_handicap and its source; scoring reads go through chBasis",
    "components/manage.tsx": "round list/editor: writes the raw columns; scoring reads go through roundCh -> chBasis",
}

def discover() -> list[str]:
    out = []
    for base in ("lib", "components", "app"):
        for f in sorted((ROOT / base).rglob("*.ts")) + sorted((ROOT / base).rglob("*.tsx")):
            rel = f.relative_to(ROOT).as_posix()
            if ".test." in rel or "node_modules" in rel:
                continue
            src = f.read_text(encoding="utf-8", errors="replace")
            if re.search(r"\bchBasis\b|\bcourseHandicapExact\b|\.course_handicap\b|\.handicap_index\b", src):
                out.append(rel)
    return out

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
    # Known debt, frozen. These files allocate strokes from the raw column instead of chBasis, so
    # they miss the nine-hole halving; share-card.tsx also reimplements that halving and therefore
    # HALVES A MANUAL FIGURE, which 0153 exists to prevent. Recorded rather than silently allowed:
    # the list may shrink, never grow, so a NEW screen fails immediately.
    baseline = json.loads((ROOT / "ci" / "handicap_source_baseline.json").read_text())["known"]
    surfaces = [f for f in discover() if f not in EXEMPT]
    for rel in surfaces:
        f = ROOT / rel
        if not f.exists():
            fails.append(f"{rel}: listed as a scorer but does not exist — the list is stale")
            continue
        checked += 1
        src = f.read_text(encoding="utf-8")
        code = code_only(src)
        for m in RAW.finditer(code):
            line = src.count("\n", 0, m.start()) + 1
            # The enclosing call, not just the line: an argument object passed to chBasis spans
            # several lines, so a single-line window reported the helper's own body as a violation.
            lstart = code.rfind("\n", 0, m.start()) + 1
            stmt = code[max(0, lstart - 400) : code.find("\n", m.start())]
            # Two legitimate reads that are not scoring:
            #   * passing the raw columns INTO chBasis (that is the whole point of the helper);
            #   * a form control displaying the stored value for editing.
            if "chBasis(" in stmt or "value=" in stmt or "placeholder=" in stmt:
                continue
            fails.append(f"{rel}:~{line}: reads `{m.group(0).strip('(')}` directly — go through chBasis, "
                         f"or manual course handicaps (0153) are silently ignored here")

    shape = (ROOT / "lib" / "game-shape.ts").read_text(encoding="utf-8")
    if 'course_handicap_source === "manual"' not in shape:
        fails.append("lib/game-shape.ts: chBasis no longer honours a manual course handicap")
    # NOT checked here: that a manual figure escapes the nine-hole halving. Position in the source
    # does not prove it — the branch can sit anywhere and still short-circuit — so asserting on
    # ordering would pass for the wrong reason. lib/manual-handicap.test.ts proves the BEHAVIOUR:
    # chBasis(manual, par, 9) must equal the entered figure, and explicitly must not be half of it.

    print(f"handicap single source: {len(discover())} file(s) touch a handicap, "
          f"{checked} checked, {len(EXEMPT)} exempt with a stated reason")
    new = [x for x in fails if not any(x.startswith(k + ":") for k in baseline)]
    gone = [k for k in baseline if not any(x.startswith(k + ":") for x in fails)]
    for x in new:
        print("FAIL", x)
    if gone:
        print("Debt was paid down \u2014 remove from ci/handicap_source_baseline.json: " + ", ".join(gone))
    print(f"known debt: {len(baseline)} file(s) still reading a raw handicap")
    fails = new
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
