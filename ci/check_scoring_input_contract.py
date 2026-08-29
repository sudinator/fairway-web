#!/usr/bin/env python3
"""Prevent UI scoring paths from feeding rounded display handicaps into canonical match engines."""
import re, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
fail=[]
for f in list((ROOT/'components').rglob('*.tsx')):
    src=f.read_text(encoding='utf-8')
    rel=f.relative_to(ROOT).as_posix()
    for fn in ('matchStatus','matchProgress'):
        for m in re.finditer(rf'{fn}\s*\((.*?)\)', src, flags=re.S):
            if '.course_handicap' in m.group(1):
                fail.append(f'{rel}: {fn} receives stored rounded course_handicap; use chBasis(...) exact input')
# The alternate-shot running score must consume the canonical side handicap, not rounded partner allowances.
t = (ROOT/'components/tournaments.tsx').read_text(encoding='utf-8')
anchor=t.find('if (game.game_type === "alt_shot"')
if anchor >= 0:
    block=t[anchor:anchor+2600]
    if 'altShotProgress' in block and 'applyAllowance(chBasis' in block:
        fail.append('components/tournaments.tsx: alternate-shot matchRun rounds partner handicaps before combining; use altShotSides')
    if 'altShotProgress' in block and 'altShotSides(' not in block:
        fail.append('components/tournaments.tsx: alternate-shot matchRun must derive side handicaps from altShotSides')
if fail:
    print('SCORING INPUT CONTRACT FAILED:')
    for x in fail: print('  '+x)
    sys.exit(1)
print('scoring input contract: PASS (match engines use exact basis; alt-shot uses canonical side handicaps)')
