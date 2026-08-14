from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / 'ci' / 'core_rls_production_baseline.json').read_text(encoding='utf-8'))

# Functions built into PostgreSQL/Supabase auth or SQL syntax. Everything else invoked
# by a Production policy must be recreated by source before migration 0137 runs.
BUILTINS = {
    'coalesce', 'lower', 'exists', 'auth.uid', 'auth.role', 'auth.jwt'
}

# Collect function-like calls from the exact Production policy expressions.
required = set()
for table in MANIFEST['tables'].values():
    for policy in table['policies']:
        for expr in (policy.get('qual'), policy.get('with_check')):
            if not expr:
                continue
            # Qualified auth.* calls first.
            for name in re.findall(r'\b(auth\.(?:uid|role|jwt))\s*\(', expr, re.I):
                required.add(name.lower())
            # Unqualified application/builtin calls.
            for name in re.findall(r'(?<![\w.])([A-Za-z_][A-Za-z0-9_]*)\s*\(', expr):
                lname = name.lower()
                if lname not in {'and','or','where','from','on','exists','coalesce','lower'}:
                    required.add(lname)

custom = sorted(x for x in required if x not in BUILTINS)

# Fresh rebuild order is historical Supabase baseline migrations 0001-0013 followed by
# the primary migrations/ chain 0014 onward. Only definitions before 0137 count.
sources = []
for d in (ROOT / 'supabase' / 'migrations', ROOT / 'migrations'):
    for p in sorted(d.glob('*.sql')):
        m = re.match(r'(\d{4})_', p.name)
        if d.name == 'migrations' and m and int(m.group(1)) >= 137:
            continue
        sources.append((p, p.read_text(encoding='utf-8', errors='replace')))

def defined(name: str):
    pat = re.compile(
        rf'\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?{re.escape(name)}\s*\(',
        re.I,
    )
    return [p for p, text in sources if pat.search(text)]

missing = []
for name in custom:
    hits = defined(name)
    if not hits:
        missing.append(name)

# Core tables themselves must be source-recreatable before the RLS migration.
all_sql = '\n'.join(text for _, text in sources)
missing_tables = []
for table in sorted(MANIFEST['tables']):
    if not re.search(rf'\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?{re.escape(table)}\b', all_sql, re.I):
        missing_tables.append(table)

if missing or missing_tables:
    print('Core RLS source-closure contract: FAIL')
    if missing:
        print(' - Production policies depend on helper functions missing from the rebuild source: ' + ', '.join(missing))
    if missing_tables:
        print(' - Production RLS tables missing from rebuild source: ' + ', '.join(missing_tables))
    raise SystemExit(1)

print('Core RLS source-closure contract: PASS')
print(' - core tables:', len(MANIFEST['tables']))
print(' - policy helper functions:', ', '.join(custom))
