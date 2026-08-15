#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
MIGRATION_ROOTS = (ROOT / 'supabase' / 'migrations', ROOT / 'migrations')
PATTERN = re.compile(r'^(\d{4})_[A-Za-z0-9_.-]+\.sql$')

entries: list[tuple[int, str, Path]] = []
errors: list[str] = []
seen_numbers: dict[int, Path] = {}

for migration_root in MIGRATION_ROOTS:
    if not migration_root.is_dir():
        errors.append(f'missing migration directory: {migration_root}')
        continue
    for path in migration_root.glob('*.sql'):
        match = PATTERN.match(path.name)
        if not match:
            errors.append(f'invalid migration filename: {path.relative_to(ROOT)}')
            continue
        number = int(match.group(1))
        prior = seen_numbers.get(number)
        if prior is not None:
            errors.append(
                f'duplicate migration number {number:04d}: '
                f'{prior.relative_to(ROOT)} and {path.relative_to(ROOT)}'
            )
            continue
        seen_numbers[number] = path
        entries.append((number, path.name, path.resolve()))

if errors:
    print('Migration ordering: FAIL', file=sys.stderr)
    for error in errors:
        print(f' - {error}', file=sys.stderr)
    raise SystemExit(1)

entries.sort(key=lambda item: (item[0], item[1]))
if not entries:
    print('Migration ordering: FAIL - no migrations found', file=sys.stderr)
    raise SystemExit(1)
if entries[0][0] != 1:
    print(
        f'Migration ordering: FAIL - first migration is {entries[0][1]}, expected 0001_*',
        file=sys.stderr,
    )
    raise SystemExit(1)

for _, _, path in entries:
    print(path)
