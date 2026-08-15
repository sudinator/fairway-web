#!/usr/bin/env python3
"""Block react-hooks/exhaustive-deps suppressions.

The reviewed legacy suppression baseline was retired in 177.35 after the project
moved to a zero-warning hook-lint gate while exhaustive-deps itself remained
disabled. Suppressions for a disabled rule are stale by definition and can mask
future lint/configuration drift, so the permanent contract is now zero.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SEARCH_ROOTS = (ROOT / 'app', ROOT / 'components', ROOT / 'lib')
SUFFIXES = {'.ts', '.tsx', '.js', '.jsx'}
TOKEN = 'react-hooks/exhaustive-deps'

hits = []
for base in SEARCH_ROOTS:
    if not base.exists():
        continue
    for path in sorted(p for p in base.rglob('*') if p.is_file() and p.suffix in SUFFIXES):
        for lineno, line in enumerate(path.read_text(errors='ignore').splitlines(), start=1):
            if TOKEN in line and 'eslint-' in line:
                hits.append((path.relative_to(ROOT), lineno, line.strip()))

if hits:
    print('EFFECT SUPPRESSION GUARD: FAIL - react-hooks/exhaustive-deps suppressions are not allowed')
    for path, lineno, line in hits:
        print(f' + {path}:{lineno}: {line}')
    sys.exit(1)

print('EFFECT SUPPRESSION GUARD: PASS (0 react-hooks/exhaustive-deps suppressions)')
