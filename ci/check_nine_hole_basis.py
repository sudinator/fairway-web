#!/usr/bin/env python3
"""The nine-hole halving rule, asserted where it actually lives: the migration SQL.

WHY THIS EXISTS
The halving used to be in TypeScript (`nineHoleBasis`) and was covered by 17 assertions. It moved
to migration 0139 — write-time, once, in the database — and the helper was deleted, because an
exported function that halves a rating sitting next to code that must NOT halve is a trap. It was
exactly that trap: it reintroduced a second halve at read time and a 2.43 differential displayed as
17.7.

Deleting it left the rule with no automated coverage at all, since the migration is SQL and no test
runs it. This closes that gap. It checks the SQL text rather than behaviour — the fresh-database CI
job proves the migration APPLIES; this proves it says the right thing.

THE RULE
  rating          -> halved for an exact nine (no per-nine rating exists to use)
  course_par      -> SUMMED from holes_meta, never halved
  course_handicap -> halved
  slope           -> NEVER halved. It is a RATIO on the 55-155 scale, not a stroke count. A
                     published 9-hole Slope for a hard nine is still ~140, not ~70. Halving it
                     applies the difficulty adjustment twice: 3.5 strokes too few on a 113 course,
                     4.8 on a 155 course, and the error GROWS with difficulty.
  ONLY n = 9      -> a 10-17 hole round is an eighteen with holes missing and keeps the net-par
                     fill. Different situations; the code must not collapse them.

    python3 ci/check_nine_hole_basis.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "migrations" / "0139_nine_hole_round_basis.sql"

failures: list[str] = []

if not MIG.exists():
    print(f"NINE-HOLE BASIS: {MIG.name} is missing — the halving rule has no home.")
    sys.exit(1)

sql = MIG.read_text(encoding="utf-8")
# Comments quote the rule and legitimately mention halving slope in order to forbid it.
code = re.sub(r"^\s*--.*$", "", sql, flags=re.M)

# ── the three fields that must halve ───────────────────────────────────────
for field, pattern in [
    ("rating", r"rating\s*(?:=\s*)?case when n = 9 then\s*pl\.rating\s*/\s*2"),
    # Par is SUMMED from holes_meta, never halved: a back nine is commonly par 35 or 37, and half
    # of 71 is 36 — wrong on both. holes_meta carries every hole's real par.
    ("course_par", r"course_par\s*(?:=\s*)?case when n = 9 then\s*parsum"),
    ("course_handicap", r"course_handicap\s*(?:=\s*)?case when n = 9 then\s*round\(\s*pl\.course_handicap\s*/\s*2"),
]:
    n = len(re.findall(pattern, code))
    # Two posting functions, each with an INSERT and an UPDATE path = 4 sites... but the INSERT
    # uses positional values, so the field name is absent there. Require at least the two UPDATEs.
    if n < 2:
        failures.append(
            f"{field}: expected at least 2 'case when n = 9 then ... / 2' sites, found {n}.\n"
            "  Both posting functions (post_game_rounds_internal and post_group_rounds) must halve\n"
            "  it, on both their INSERT and UPDATE paths."
        )

# ── par must be SUMMED, never halved ──────────────────────────────────────
if re.search(r"course_par\s*/\s*2", code):
    failures.append(
        "course_par is being halved. It must be SUMMED from holes_meta.\n"
        "  A back nine is commonly par 35 or 37; half of 71 is 36 — wrong on both. This shipped:\n"
        "  a par-35 nine displayed as Par 36 while its own scorecard totalled 35."
    )
if "parsum" not in code:
    failures.append("no summed-par variable found — course_par must come from holes_meta, not a halve.")

# ── slope must NEVER be halved ─────────────────────────────────────────────
if re.search(r"slope\s*(?:=\s*)?case when n = 9", code) or re.search(r"pl\.slope\s*/\s*2", code):
    failures.append(
        "slope is being halved. It must NOT be.\n"
        "  Slope is a RATIO on the 55-155 scale, not a stroke count — a published 9-hole Slope for\n"
        "  a hard nine is still ~140, not ~70. Halving applies the difficulty adjustment twice:\n"
        "  3.5 strokes too few on a 113 course, 4.8 on a 155 course, and the error grows with\n"
        "  difficulty, hurting exactly the players it should help most."
    )

# ── only an exact nine ─────────────────────────────────────────────────────
loose = re.findall(r"case when n\s*(<=|<|>|>=)\s*\d+", code)
if loose:
    failures.append(
        f"the hole-count test is a RANGE ({loose[0]}), not 'n = 9'.\n"
        "  A 10-17 hole round is an eighteen with holes missing and keeps the net-par fill."
    )
if "case when n = 9" not in code:
    failures.append("no 'case when n = 9' found — the halving is not conditional on an exact nine.")

# ── the read side must NOT halve again ─────────────────────────────────────
golf = (ROOT / "lib" / "golf.ts").read_text(encoding="utf-8")
golf_code = re.sub(r"^\s*//.*$", "", golf, flags=re.M)
golf_code = re.sub(r"/\*.*?\*/", "", golf_code, flags=re.S)
m = re.search(r"export function roundDifferential\(.*?\n\}", golf_code, re.S)
if m:
    body = m.group(0)
    if re.search(r"/\s*2\b", body) or "nineHoleBasis" in body:
        failures.append(
            "lib/golf.ts roundDifferential halves the rating.\n"
            "  It must not: the STORED rating is already the nine-hole figure, halved once at write\n"
            "  time by migration 0139. Halving again turned a 2.43 differential into 17.7 and made\n"
            "  the explainer's own arithmetic disagree with its headline."
        )
if "function nineHoleBasis" in golf_code:
    failures.append(
        "lib/golf.ts still exports nineHoleBasis.\n"
        "  It was removed deliberately: a helper that halves a rating, next to code that must not\n"
        "  halve, reads as the sanctioned way and reintroduces the double halve."
    )

if failures:
    print("NINE-HOLE BASIS — violations:\n")
    for f in failures:
        print("  " + f.replace("\n", "\n  "))
        print()
    sys.exit(1)

print("nine-hole basis: PASS (halved once at write time; slope untouched; read side does not halve)")
