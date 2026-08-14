#!/usr/bin/env python3
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
SQL_PATH = ROOT / 'migrations' / '0136_core_rls_helpers.sql'
BASELINE_PATH = ROOT / 'ci' / 'core_rls_helpers_production_baseline.json'
sql = SQL_PATH.read_text(encoding='utf-8')
baseline = json.loads(BASELINE_PATH.read_text(encoding='utf-8'))['functions']
errors = []


def norm(s: str) -> str:
    return re.sub(r'\s+', ' ', s.strip()).lower()


def extract_function(name: str):
    # The migration deliberately uses $function$ for all six functions.
    pat = re.compile(
        rf"create\s+or\s+replace\s+function\s+public\.{re.escape(name)}\s*\((.*?)\)\s*"
        rf"returns\s+boolean\s+language\s+sql\s+stable\s+security\s+definer\s+"
        rf"set\s+search_path\s+to\s+'public'\s+as\s+\$function\$(.*?)\$function\$\s*;",
        re.I | re.S,
    )
    m = pat.search(sql)
    if not m:
        return None
    return {'identity_arguments': norm(m.group(1)), 'body': norm(m.group(2))}

actual_names = set(re.findall(r'create\s+or\s+replace\s+function\s+public\.([a-zA-Z0-9_]+)\s*\(', sql, re.I))
expected_names = set(baseline)
if actual_names != expected_names:
    missing = expected_names - actual_names
    extra = actual_names - expected_names
    if missing:
        errors.append('missing Production helper(s): ' + ', '.join(sorted(missing)))
    if extra:
        errors.append('unexpected helper(s) in 0136: ' + ', '.join(sorted(extra)))

for name, expected in baseline.items():
    actual = extract_function(name)
    if actual is None:
        errors.append(f'{name}: exact SECURITY DEFINER/STABLE/search_path=public definition not found')
        continue
    if actual['identity_arguments'] != norm(expected['identity_arguments']):
        errors.append(f"{name}: signature mismatch: {actual['identity_arguments']!r} != {norm(expected['identity_arguments'])!r}")
    if actual['body'] != norm(expected['body']):
        errors.append(f"{name}: function body differs from Production export")

if not re.search(r"select\s+public\.record_migration\('0136_core_rls_helpers'\);\s*$", sql, re.I):
    errors.append('record_migration(0136_core_rls_helpers) must be the final statement')

if errors:
    print('Core RLS helper baseline contract: FAIL')
    for e in errors:
        print(' -', e)
    raise SystemExit(1)

print('Core RLS helper baseline contract: PASS')
print(' - exact Production helper definitions:', len(baseline))
