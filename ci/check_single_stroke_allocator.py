#!/usr/bin/env python3
"""One stroke allocator, and only one.

WHY THIS EXISTS
BNN had two implementations of "how many strokes does this player get on this hole":

    allocateStrokes(holes, ch)   ranks the holes actually in play and distributes
    strokesReceived(si, ch)      floor(ch/18) + (si <= ch % 18)   <- 18 HARDCODED

They agreed on a full round with a clean 1-18 stroke index, and diverged everywhere else. A
nine-hole game holds every second index, so the second form handed out roughly half the strokes
owed — the scorecard showed four dots while the Strokes panel said nine, for the same player in the
same game. It took three releases to find, because each screen looked internally consistent.

That is the worst shape a bug can take: correct in the common case, wrong in the uncommon one, and
with no single place to look. The rule is now one algorithm; strokesReceived delegates to
allocateStrokes.

WHAT THIS CHECKS
  1. `strokesReceived` still delegates — it must not regrow a formula of its own.
  2. No new hand-rolled allocation appears anywhere: an `si <= ch` comparison, a `% 18`, or a
     `/ 18` in the same expression as a stroke index.
  3. Every caller that HAS a hole list passes it, since omitting it silently falls back to a
     synthesised 1..18 and reintroduces exactly the nine-hole bug.

The behavioural half of this guarantee lives in lib/stroke-agreement.test.ts, which asserts the
scorecard dots and the Strokes panel produce the SAME total across ten handicaps on a back nine, a
front nine and a full eighteen. This file catches the shape; that file catches the numbers.

    python3 ci/check_single_stroke_allocator.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
failures: list[str] = []

# Comments explain why the OLD formula was wrong and legitimately quote it. A guard that fires on
# its own explanation teaches people to delete the explanation, so comments are stripped first.
_BLOCK = re.compile(r"/\*.*?\*/", re.S)
_LINE = re.compile(r"^\s*//.*$", re.M)


def strip_comments(text: str) -> str:
    """Blank out comments, PRESERVING line numbers so reported positions stay accurate."""
    text = _BLOCK.sub(lambda m: "\n" * m.group(0).count("\n"), text)
    return _LINE.sub("", text)

golf = (ROOT / "lib" / "golf.ts").read_text(encoding="utf-8")

# ── 1. strokesReceived must delegate, not compute ──────────────────────────
m = re.search(r"export function strokesReceived\((.*?)\n\}", golf, re.S)
if not m:
    failures.append("lib/golf.ts: strokesReceived not found — has it been renamed?")
else:
    body = m.group(0)
    if "allocateStrokes(" not in body:
        failures.append(
            "lib/golf.ts: strokesReceived no longer delegates to allocateStrokes.\n"
            "  It must not regrow its own formula. Two implementations of one rule is the defect\n"
            "  this guard exists to prevent — they agreed on 18 holes and diverged on a nine."
        )
    if re.search(r"%\s*18", body) and "Array.from" not in body:
        failures.append(
            "lib/golf.ts: strokesReceived contains a hardcoded '% 18'.\n"
            "  That is the old formula. A nine-hole game holds every SECOND stroke index, so it\n"
            "  hands out roughly half the strokes owed."
        )

# ── 2. no hand-rolled allocation elsewhere ─────────────────────────────────
# Deliberately narrow: an si/stroke_index compared against a handicap, or a modulo/divide by 18
# sitting next to one. Broad enough to catch a re-implementation, narrow enough not to fire on
# unrelated arithmetic.
PATTERNS = [
    (re.compile(r"(?:si|stroke_index|strokeIndex)\s*<=\s*(?:ch|hcp|handicap)\b"),
     "an 'si <= ch' threshold — allocate by rank instead, via allocateStrokes"),
    (re.compile(r"(?:ch|hcp|handicap)\w*\s*%\s*18\b"),
     "a '% 18' on a handicap — 18 is not always the hole count"),
    (re.compile(r"Math\.floor\(\s*(?:ch|hcp|handicap)\w*\s*/\s*18\s*\)"),
     "a 'floor(ch / 18)' — 18 is not always the hole count"),
]
# Matched by TEXT, not by file. Allowlisting all of golf.ts was too broad: it let strokesReceived
# regrow its own formula undetected, which is the one thing this guard exists to prevent.
ALLOWED_SNIPPETS = (
    # The wrapper's documented fallback, which synthesises a 1..18 index on purpose.
    "Array.from({ length: 18 }",
)
for d in ("lib", "components", "app"):
    base = ROOT / d
    if not base.exists():
        continue
    for p in sorted(base.rglob("*.ts*")):
        rel = str(p.relative_to(ROOT))
        if ".test." in rel or ".baseline." in rel:
            continue
        text = strip_comments(p.read_text(encoding="utf-8", errors="replace"))
        for pat, why in PATTERNS:
            for hit in pat.finditer(text):
                line_no = text[: hit.start()].count("\n") + 1
                src_line = text.splitlines()[line_no - 1] if line_no <= len(text.splitlines()) else ""
                if any(sn in src_line for sn in ALLOWED_SNIPPETS):
                    continue
                failures.append(f"{rel}:{line_no}: {why}\n    {hit.group(0)}")

# ── 3. callers with a hole list must pass it ───────────────────────────────
# strokesReceived(si, ch) with only two arguments, in a scope that clearly has holes available.
two_arg = re.compile(r"strokesReceived\(\s*[^,()]+,\s*[^,()]+\)")
for d in ("lib", "components"):
    for p in sorted((ROOT / d).rglob("*.ts*")):
        rel = str(p.relative_to(ROOT))
        if ".test." in rel or ".baseline." in rel:
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        for hit in two_arg.finditer(text):
            line_no = text[: hit.start()].count("\n") + 1
            line = text.splitlines()[line_no - 1]
            # Only complain when a hole collection is obviously in scope on the same line.
            # The documented no-hole-list fallback: the guard clause immediately above proves
            # there is no list to pass. Matched on content, not by file, so any OTHER bare call in
            # the same file still fails.
            if "meta.length === 0" in line:
                continue
            # A PARTIAL 18-hole round, not a nine. WHS fills unplayed holes with net par and
            # balances against the FULL 18-hole allocation, so this one must NOT re-allocate
            # across the played subset. Matched by name so any other bare call still fails.
            if "playedRecv" in line:
                continue
            if re.search(r"\bholes\b|\ball\b|\bmeta\b", line):
                failures.append(
                    f"{rel}:{line_no}: strokesReceived called WITHOUT the hole list, but one is in scope.\n"
                    f"    {line.strip()[:100]}\n"
                    "  Omitting it falls back to a synthesised 1..18 index and reintroduces the\n"
                    "  nine-hole bug silently."
                )

if failures:
    print("SINGLE STROKE ALLOCATOR — violations:\n")
    for f in failures:
        print("  " + f.replace("\n", "\n  "))
        print()
    sys.exit(1)

print("single stroke allocator: PASS (one implementation; callers pass their hole list)")
