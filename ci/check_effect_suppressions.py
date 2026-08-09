#!/usr/bin/env python3
"""Prevent unreviewed growth in react-hooks/exhaustive-deps suppressions.
The current debt is baselined by file + exact source line. Moving/changing one forces review.
"""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'ci/effect_suppressions_baseline.txt'
current=[]
for p in sorted((ROOT/'components').rglob('*.tsx')):
    for line in p.read_text(errors='ignore').splitlines():
        if 'react-hooks/exhaustive-deps' in line:
            current.append(f"{p.relative_to(ROOT)}|{line.strip()}")
expected=[x.strip() for x in BASE.read_text().splitlines() if x.strip() and not x.startswith('#')]
new=sorted(set(current)-set(expected)); missing=sorted(set(expected)-set(current))
if new:
    print('EFFECT SUPPRESSION GUARD: FAIL — unreviewed suppressions')
    for x in new: print(' +',x)
    sys.exit(1)
if missing:
    print(f'EFFECT SUPPRESSION GUARD: PASS ({len(current)} current; {len(missing)} legacy suppressions removed/changed — update baseline after review)')
else:
    print(f'EFFECT SUPPRESSION GUARD: PASS ({len(current)} reviewed legacy suppressions; no new suppressions)')
