#!/usr/bin/env python3
"""Guard against the flex bar-chart overflow footgun.

A horizontal flex row of mapped bar "columns" (flexDirection:"column", alignItems:"center")
that contains a whiteSpace:"nowrap" label but does NOT set minWidth:0 on the column will
overflow a narrow (phone) viewport: the nowrap label pins each column to its intrinsic width,
the columns can't shrink below content, and the row runs off-screen (then gets silently clipped
by the app-shell's overflowX:hidden). See v1.158.x analytics-chart fix.

Rule: any bar-chart column wrapper (flexDirection:"column" + alignItems:"center") that has a
nowrap label within a few lines must also declare minWidth:0. Low false-positive: nav items and
other centered columns without a nowrap label are ignored.

Exits 1 on violation. Fast, static, runs in the delivery pipeline.
"""
import sys, glob, re

COL = re.compile(r'flexDirection:\s*"column".*alignItems:\s*"center"')
NOWRAP = 'whiteSpace: "nowrap"'
MINW = "minWidth: 0"

def main() -> int:
    bad = []
    for path in glob.glob("components/**/*.tsx", recursive=True) + glob.glob("components/*.tsx"):
        lines = open(path, encoding="utf-8").read().split("\n")
        for i, ln in enumerate(lines):
            if not COL.search(ln):
                continue
            # a nowrap label attached to this column within the next few lines?
            window = "\n".join(lines[i:i + 8])
            if NOWRAP in window and MINW not in ln:
                bad.append(f"{path}:{i+1}: bar-chart column with a nowrap label is missing `minWidth: 0` (will overflow narrow screens)")
    if bad:
        print("chart-overflow check FAILED:")
        for b in sorted(set(bad)):
            print("  " + b)
        print("Fix: add `minWidth: 0` to the mapped column style, and `overflow: \"hidden\"` on the row.")
        return 1
    print("chart-overflow check: clean")
    return 0

if __name__ == "__main__":
    sys.exit(main())
