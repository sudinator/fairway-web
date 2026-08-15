from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'migrations' / '0137_core_rls_baseline.sql'
MANIFEST_PATH = ROOT / 'ci' / 'core_rls_production_baseline.json'
sql = PATH.read_text(encoding='utf-8')
manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
errors = []


def split_statements(text: str):
    # 0137 contains no dollar-quoted function bodies; semicolon splitting is safe
    # and makes the policy comparison independent of line wrapping.
    out = []
    for chunk in text.split(';'):
        lines = [ln for ln in chunk.splitlines() if not ln.lstrip().startswith('--')]
        stmt = '\n'.join(lines).strip()
        if stmt:
            out.append(stmt)
    return out


def balanced_clause(stmt: str, keyword: str):
    m = re.search(rf'\b{re.escape(keyword)}\s*\(', stmt, re.I)
    if not m:
        return None
    start = stmt.find('(', m.start())
    depth = 0
    in_single = False
    i = start
    while i < len(stmt):
        ch = stmt[i]
        if ch == "'":
            # PostgreSQL single-quote escape: ''.
            if in_single and i + 1 < len(stmt) and stmt[i + 1] == "'":
                i += 2
                continue
            in_single = not in_single
        elif not in_single:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
                if depth == 0:
                    return stmt[start + 1:i]
        i += 1
    raise ValueError(f'unbalanced {keyword} clause')


def outer_balanced(s: str) -> bool:
    if not (s.startswith('(') and s.endswith(')')):
        return False
    depth = 0
    in_single = False
    for i, ch in enumerate(s):
        if ch == "'":
            if in_single and i + 1 < len(s) and s[i + 1] == "'":
                continue
            in_single = not in_single
        elif not in_single:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
                if depth == 0 and i != len(s) - 1:
                    return False
    return depth == 0


def norm_expr(expr):
    if expr is None:
        return None
    s = re.sub(r'\s+', ' ', expr.strip())
    while outer_balanced(s):
        s = re.sub(r'\s+', ' ', s[1:-1].strip())
    return s


statements = split_statements(sql)
actual_policies = {}
policy_re = re.compile(
    r'^create\s+policy\s+"([^"]+)"\s+on\s+public\.([a-zA-Z0-9_]+)\s+'
    r'as\s+(permissive|restrictive)\s+for\s+(all|select|insert|update|delete)\s+'
    r'to\s+([a-zA-Z0-9_, ]+)', re.I | re.S,
)
for stmt in statements:
    m = policy_re.match(stmt)
    if not m:
        continue
    name, table, permissive, cmd, roles = m.groups()
    actual_policies[(table, name)] = {
        'permissive': permissive.upper(),
        'cmd': cmd.upper(),
        'roles': ','.join(x.strip() for x in roles.split(',')),
        'qual': norm_expr(balanced_clause(stmt, 'using')),
        'with_check': norm_expr(balanced_clause(stmt, 'with check')),
    }

expected_policies = {}
for table, meta in manifest['tables'].items():
    if meta['rls_enabled'] and f'alter table public.{table} enable row level security;' not in sql:
        errors.append(f'{table}: RLS enable statement missing')
    force_text = f'alter table public.{table} force row level security;' if meta['rls_forced'] else f'alter table public.{table} no force row level security;'
    if force_text not in sql:
        errors.append(f'{table}: FORCE RLS state differs from Production manifest')
    for p in meta['policies']:
        expected_policies[(table, p['policyname'])] = {
            'permissive': p['permissive'].upper(),
            'cmd': p['cmd'].upper(),
            'roles': p['roles'],
            'qual': norm_expr(p['qual']),
            'with_check': norm_expr(p['with_check']),
        }

for key in sorted(set(expected_policies) | set(actual_policies)):
    expected = expected_policies.get(key)
    actual = actual_policies.get(key)
    if expected is None:
        errors.append(f'{key[0]}.{key[1]}: policy exists in 0137 but not Production manifest')
    elif actual is None:
        errors.append(f'{key[0]}.{key[1]}: Production policy missing from 0137')
    elif actual != expected:
        for field in expected:
            if actual[field] != expected[field]:
                errors.append(f'{key[0]}.{key[1]}: {field} mismatch\n    production={expected[field]!r}\n    migration ={actual[field]!r}')

# Exact Production grants from the export: the same seven table privileges for
# anon and authenticated on all 12 core tables.
privs = 'delete, insert, references, select, trigger, truncate, update'
if f'grant {privs} on table' not in sql.lower() or 'to anon, authenticated;' not in sql.lower():
    errors.append('explicit Production anon/authenticated table grant set is missing')
for table in manifest['tables']:
    for role in ('anon', 'authenticated'):
        expected_grants = sorted(manifest['tables'][table]['grants'].get(role, []))
        if expected_grants != ['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']:
            errors.append(f'{table}: manifest grant set for {role} is unexpected: {expected_grants}')
    if f'public.{table}' not in sql:
        errors.append(f'{table}: missing from explicit grant block')

# Idempotency: every policy is dropped before recreation.
drops = set(re.findall(r'^drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+public\.([a-zA-Z0-9_]+)', sql, re.I | re.M))
expected_drop_pairs = {(name, table) for (table, name) in expected_policies}
if drops != expected_drop_pairs:
    missing = expected_drop_pairs - drops
    extra = drops - expected_drop_pairs
    if missing: errors.append('missing idempotent policy drops: ' + ', '.join(f'{t}.{n}' for n,t in sorted(missing)))
    if extra: errors.append('extra policy drops: ' + ', '.join(f'{t}.{n}' for n,t in sorted(extra)))

if not re.search(r"select public\.record_migration\('0137_core_rls_baseline'\);\s*$", sql):
    errors.append('record_migration(0137_core_rls_baseline) must be the final statement')

if len(expected_policies) != 60:
    errors.append(f'Production manifest should contain 60 policies, found {len(expected_policies)}')

if errors:
    print('Core RLS baseline contract: FAIL')
    for error in errors:
        print(' -', error)
    raise SystemExit(1)

print('Core RLS baseline contract: PASS')
print(f' - exact Production policies: {len(expected_policies)}')
print(f' - RLS tables: {len(manifest["tables"])}')
print(' - table grants: exact exported privilege set for anon/authenticated')
