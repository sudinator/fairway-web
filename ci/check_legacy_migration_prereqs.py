from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ORDERER = ROOT / 'ci' / 'list_ordered_migrations.py'

COMMENT_LINE = re.compile(r'--.*?$', re.M)
COMMENT_BLOCK = re.compile(r'/\*.*?\*/', re.S)
CREATE_POLICY = re.compile(r'\bcreate\s+policy\s+(?:"([^"]+)"|([^\s]+))\s+on\s+(?:public\.)?([A-Za-z_]\w*)', re.I)
ALTER_POLICY = re.compile(r'\balter\s+policy\s+(?:"([^"]+)"|([^\s]+))\s+on\s+(?:public\.)?([A-Za-z_]\w*)', re.I)
CREATE_FUNCTION = re.compile(r'\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([A-Za-z_]\w*)\s*\(', re.I)
ALTER_FUNCTION = re.compile(r'\balter\s+function\s+(?:public\.)?([A-Za-z_]\w*)\s*\(', re.I)
EXEC_FUNCTION = re.compile(r'\b(?:grant|revoke)\s+execute\s+on\s+function\s+(?:public\.)?([A-Za-z_]\w*)\s*\(', re.I)
DROP_FUNCTION = re.compile(r'\bdrop\s+function\s+(?!if\s+exists\b)(?:public\.)?([A-Za-z_]\w*)\s*\(', re.I)


def strip_comments(text: str) -> str:
    return COMMENT_LINE.sub('', COMMENT_BLOCK.sub('', text))


def ordered_paths():
    proc = subprocess.run([sys.executable, str(ORDERER)], cwd=ROOT, text=True, capture_output=True)
    if proc.returncode:
        raise SystemExit(proc.stderr or proc.stdout)
    return [Path(line) for line in proc.stdout.splitlines() if line.strip()]


def policy_key(match):
    return (match.group(3).lower(), (match.group(1) or match.group(2)).lower())


def main():
    policies = set()
    functions = set()
    issues = []
    for path in ordered_paths():
        text = strip_comments(path.read_text(encoding='utf-8', errors='ignore'))
        events = []
        for rx, kind in [
            (CREATE_POLICY, 'create_policy'), (ALTER_POLICY, 'alter_policy'),
            (CREATE_FUNCTION, 'create_function'), (ALTER_FUNCTION, 'alter_function'),
            (EXEC_FUNCTION, 'exec_function'), (DROP_FUNCTION, 'drop_function'),
        ]:
            for match in rx.finditer(text):
                events.append((match.start(), kind, match))
        for pos, kind, match in sorted(events, key=lambda e: e[0]):
            line = text.count('\n', 0, pos) + 1
            if kind == 'create_policy':
                policies.add(policy_key(match))
            elif kind == 'alter_policy':
                key = policy_key(match)
                if key not in policies:
                    issues.append(f'{path.name}:{line}: ALTER POLICY requires missing prior policy {key[0]}.{key[1]}')
            elif kind == 'create_function':
                functions.add(match.group(1).lower())
            else:
                name = match.group(1).lower()
                if name not in functions:
                    issues.append(f'{path.name}:{line}: {kind.replace("_", " ").upper()} requires missing prior function {name}')
                if kind == 'drop_function':
                    functions.discard(name)

    baseline = (ROOT / 'supabase' / 'migrations' / '0001_baseline.sql').read_text(encoding='utf-8')
    required = [
        'create policy "create notifications" on public.notifications',
        'with check (auth.uid() is not null)',
    ]
    for token in required:
        if token.lower() not in baseline.lower():
            issues.append(f'0001_baseline.sql missing historical notification compatibility token: {token}')

    if issues:
        print('Legacy migration prerequisite contract: FAIL')
        for issue in issues:
            print(' -', issue)
        raise SystemExit(1)
    print('Legacy migration prerequisite contract: PASS')
    print(' - globally ordered historical migration stream has no unresolved ALTER POLICY dependency')
    print(' - ALTER/GRANT/REVOKE/DROP FUNCTION references have prior CREATE FUNCTION coverage')
    print(' - pre-0017 notifications policy compatibility is explicitly reconstructed in 0001')

if __name__ == '__main__':
    main()
