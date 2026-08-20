#!/usr/bin/env python3
"""Runtime-computed colour matrix.

A colour produced by a helper (`ptsColor(p)`, `flightTagColor(k)`, `KIND_COLOR[kind]`) cannot be
read by a static scanner — but its RANGE is finite and knowable. Every one of these returns from a
small fixed set, so enumerating that set and checking each member against the background it renders
on gives complete coverage without running the app.

That is the point: "computed at runtime" is not the same as "unauditable". It only means the audit
has to enumerate rather than pattern-match.

    python3 ci/computed_colour_matrix.py <tree>
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()


def palette():
    src = (ROOT / "lib" / "golf.ts").read_text(encoding="utf-8", errors="replace")
    blk = re.search(r"export const C\s*=\s*\{(.*?)\n\}", src, re.S).group(1)
    return {"C." + n: h.upper() for n, h in re.findall(r"(\w+)\s*:\s*\"(#[0-9A-Fa-f]{6})\"", blk)}


C = palette()


def lum(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    ch = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    ch = [(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4) for c in ch]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def ratio(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)


def vals(*names):
    """Resolve a mix of tokens and literals to concrete hex."""
    out = []
    for n in names:
        n = n.strip().strip('"')
        out.append(C[("C." + n) if not n.startswith("#") and ("C." + n) in C else n]
                   if not n.startswith("#") else n.upper())
    return out


# ── Each entry: the helper, every value it can return, and the surface(s) it renders on ─────
# Return sets read directly from the source, not assumed.
CASES = [
    # lib/golf.ts  ptsColor(): null -> C.faint | >2 -> #1A7A3C | ==2 -> C.bogey | else C.birdie
    ("ptsColor()  Stableford points", [
        ("no score", C["C.faint"]), ("more than 2", "#1A7A3C"),
        ("exactly 2", C["C.bogey"]), ("under 2", C["C.birdie"])],
     [("scorecard cell", "#FBFAF4")], 13),

    # lib/flights.ts  flightTagColor(): A/B/C/D/other — used as a BACKGROUND with #06251A ink
    ("flightTagColor()  flight tag fill", [
        ("A", "#5AA9E6"), ("B", C["C.gold"]), ("C", "#8FE0B0"),
        ("D", "#E0915B"), ("other", C["C.sage"])],
     [("dark ink on the tag", "#06251A")], 11),

    # game/scorecard-views.tsx  colorFor(): alternating player accent (non-team branch)
    ("colorFor()  player accent", [
        ("even index", C["C.overDark"]), ("odd index", "#E0C25E")],
     [("scorecard header strip", C["C.greenLight"])], 11),

    # dashboard.tsx  d.c — differential bar colours
    ("dashboard d.c  stat bars", [
        ("blue", "#38BDF8"), ("green", "#4ADE80"),
        ("purple", "#C77DFF"), ("red", "#FB7185")],
     [("C.green text on the bar itself", C["C.green"])], 12),

    # feedback.tsx  KIND_COLOR — each chip has ONE text colour, so these are pairs, not
    # a cross-product. Listing each as its own single-state case keeps that honest.
    ("KIND_COLOR  bug chip", [("white on red", "#FFFFFF")], [("bug chip", "#B83A2E")], 12),
    ("KIND_COLOR  wish chip", [("white on blue", "#FFFFFF")], [("wish chip", "#2E5AB8")], 12),
    ("KIND_COLOR  question chip", [("dark on gold", C["C.green"])], [("question chip", C["C.gold"])], 12),

    # game/leader-row.tsx  relCol (line 52) and col (line 65)
    ("leader-row relCol / col  net vs par", [
        ("no thru", C["C.sage"]), ("under", C["C.underDark"]),
        ("over", C["C.overRedDark"]), ("level", C["C.sage"])],
     [("leader row", C["C.greenLight"]), ("own row", C["C.greenMid"])], 15),

    # achievements.tsx  col — hole vs par
    ("achievements col  hole vs par", [
        ("no score", C["C.sage"]), ("under", C["C.underDark"]),
        ("over", C["C.overDark"]), ("level", C["C.cream"])],
     [("achievements panel", C["C.greenLight"])], 12),

    # compare-stats.tsx  catVerdict -> SYN_GOOD / SYN_OK / SYN_WEAK
    ("catVerdict vcol  vs peers", [
        ("strength", "#8FE0B0"), ("on par", "#F0C97B"), ("focus here", "#FFB3BC")],
     [("compare panel", C["C.greenLight"])], 11),
]

rows, fails = [], []
for name, states, surfaces, size in CASES:
    need = 3.0 if size >= 18 else 4.5
    for label, fg in states:
        for sname, bg in surfaces:
            r = ratio(fg, bg)
            ok = r >= need
            rows.append((name, label, fg, sname, bg, size, r, need, ok))
            if not ok:
                fails.append((name, label, fg, sname, bg, size, r, need))

cur = None
for name, label, fg, sname, bg, size, r, need, ok in rows:
    if name != cur:
        print(f"\n{name}   ({size}px, needs {need}:1)")
        cur = name
    mark = "ok  " if ok else "FAIL"
    print(f"   {mark}  {label:<12} {fg}  on {sname:<28} {bg}   {r:5.2f}:1")

print(f"\n{'='*74}")
print(f"{len(rows)} combinations checked · {len(fails)} below threshold")
if fails:
    print("\nFAILING COMBINATIONS:")
    for name, label, fg, sname, bg, size, r, need in fails:
        print(f"  {name} / {label}: {fg} on {bg} = {r:.2f}:1 (needs {need})")
