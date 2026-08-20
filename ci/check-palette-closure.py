#!/usr/bin/env python3
"""Palette closure ratchet — DISPLAY_RULES.md Part 5, colour.

Every surface colour should be a member of `C` in lib/golf.ts. At 177.58 there were 124 background
hex literals across 60 distinct values, and most were near-duplicates of a token that already
existed: #FBFAF4 is two RGB steps from C.card, #0E3A2C is three from C.green. They render
identically and review as different, which is the worst combination — invisible in a screenshot,
noisy in a diff, and multiplied every time someone copies a nearby line.

Ratcheted rather than blocking, for the same reason as check-design-scale.py: the migration has to
be reviewable, and there is no component test harness to catch a regression.

    python3 ci/check-palette-closure.py            # check
    python3 ci/check-palette-closure.py --update   # rewrite the baseline
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "ci" / "palette_baseline.json"
GOLF = ROOT / "lib" / "golf.ts"
ROOTS = ("components", "app")

# Deliberately outside the palette. These are the ONLY permitted exceptions.
ALLOWLIST = {
    "#DC2626": "TEST-MODE frame — deliberately alarming, deliberately not brand",
    "#003087": "PayPal brand mark",
    "#3D95CE": "Venmo brand mark",
    "#5AA9E6": "Team 1 identity colour",
    "#E8934F": "Team 2 identity colour",
    # Button fills reviewed and kept at 177.68 — see DISPLAY_RULES, "Allowed off-palette
    # button fills". Brand marks cannot be recoloured; the rest are single-purpose washes
    # where a palette token would not earn its place. None is a contrast failure.
    "#6D1ED4": "Zelle brand mark",
    "#5BBE7E": "admin resolve-confirm success green (x3, admin-only)",
    "#3F3414": "caution wash — setup workspace delete",
    "#7A4E18": "caution wash — deactivate player",
    "#5A3A10": "caution wash — tournament sync",
    "#3A3320": "caution wash — money screen tab",
    # Success green on "mark settled" / confirm buttons (x6). NOT C.underDark — that token was
    # #7FD6A3 when added at 177.65 and was lifted to #A3C6F5 at 177.66 for contrast, which made
    # it a BLUE. Mapping this mint to it at 177.68 turned six success buttons light blue.
    "#7FD6A3": "success fill — mark settled / confirm (x6)",
}


def palette():
    """Read the real token values out of lib/golf.ts so this guard can never drift from them."""
    src = GOLF.read_text(encoding="utf-8", errors="replace")
    block = re.search(r"export const C\s*=\s*\{(.*?)\n\}", src, re.S)
    if not block:
        print("check-palette-closure: could not locate `export const C` in lib/golf.ts")
        sys.exit(2)
    return {h.upper() for h in re.findall(r'"(#[0-9A-Fa-f]{6})"', block.group(1))}


PAL = palette()


def scan():
    off = Counter()
    for r in ROOTS:
        for f in sorted((ROOT / r).rglob("*.tsx")):
            t = f.read_text(encoding="utf-8", errors="replace")
            for m in re.findall(r'background:\s*"(#[0-9A-Fa-f]{6})"', t):
                h = m.upper()
                if h in PAL or h in ALLOWLIST:
                    continue
                off[h] += 1
    return dict(sorted(off.items()))


now = scan()

if "--update" in sys.argv:
    BASELINE.write_text(json.dumps(now, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {BASELINE.relative_to(ROOT)} — {sum(now.values())} off-palette use(s) frozen "
          f"across {len(now)} value(s).")
    sys.exit(0)

if not BASELINE.exists():
    print(f"Missing {BASELINE.relative_to(ROOT)} — run: python3 ci/check-palette-closure.py --update")
    sys.exit(1)

base = json.loads(BASELINE.read_text(encoding="utf-8"))
regressions, improvements = [], []
for h in sorted(set(base) | set(now)):
    was, is_ = base.get(h, 0), now.get(h, 0)
    if is_ > was:
        regressions.append(f"{h}: {was} -> {is_} (+{is_ - was})")
    elif is_ < was:
        improvements.append(f"{h}: {was} -> {is_} (-{was - is_})")

if regressions:
    print("PALETTE CLOSURE FAILED — new off-palette background literal(s):")
    for r in regressions:
        print("  " + r)
    print("\nUse a token from `C` in lib/golf.ts. If a genuinely new surface is needed, add a")
    print("NAMED token there and note it in DISPLAY_RULES.md — never a literal at the call site.")
    sys.exit(1)

if improvements:
    print("PALETTE CLOSURE: debt was paid down — commit the lower baseline:")
    for i in improvements:
        print("  " + i)
    print("\nRun: python3 ci/check-palette-closure.py --update")
    sys.exit(1)

print(f"palette closure: PASS ({sum(now.values())} known off-palette use(s) across "
      f"{len(now)} value(s), none new; {len(PAL)} tokens, {len(ALLOWLIST)} allowlisted)")
