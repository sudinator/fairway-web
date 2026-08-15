from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = ROOT / 'ci' / 'fresh_db_bootstrap.sql'
ORDERER = ROOT / 'ci' / 'list_ordered_migrations.py'

# Known extension-owned SQL surfaces used by this repository. This is deliberately
# explicit so a provider/library dependency cannot silently become a fresh-DB
# prerequisite. Add new extension surfaces here when the repo adopts them.
EXTENSIONS = {
    'citext': re.compile(r'\bcitext\b', re.I),
    'pg_cron': re.compile(r'\bcron\.', re.I),
}
CREATE_EXT = re.compile(
    r'\bcreate\s+extension\s+(?:if\s+not\s+exists\s+)?["\']?([A-Za-z0-9_-]+)["\']?',
    re.I,
)

def executable_lines(text: str):
    in_block = False
    for raw in text.splitlines():
        line = raw
        # Remove /* ... */ blocks sufficiently for migration/extension declarations.
        cleaned = ''
        i = 0
        while i < len(line):
            if in_block:
                end = line.find('*/', i)
                if end < 0:
                    i = len(line)
                    continue
                in_block = False
                i = end + 2
                continue
            start = line.find('/*', i)
            if start < 0:
                cleaned += line[i:]
                break
            cleaned += line[i:start]
            i = start + 2
            in_block = True
        cleaned = cleaned.split('--', 1)[0]
        if cleaned.strip():
            yield cleaned

if not BOOTSTRAP.exists():
    raise SystemExit('DB extension prerequisite contract: FAIL\n - missing ci/fresh_db_bootstrap.sql')

bootstrap_text = BOOTSTRAP.read_text(encoding='utf-8')
declared = set()
for line in executable_lines(bootstrap_text):
    m = CREATE_EXT.search(line)
    if m:
        declared.add(m.group(1).lower())

result = subprocess.run(
    ['python3', str(ORDERER), str(ROOT)],
    capture_output=True,
    text=True,
    check=False,
)
if result.returncode != 0:
    raise SystemExit('DB extension prerequisite contract: FAIL\n - migration ordering helper failed')

errors = []
for path_text in result.stdout.splitlines():
    if not path_text.strip():
        continue
    path = Path(path_text.strip())
    for line_no, line in enumerate(executable_lines(path.read_text(encoding='utf-8')), 1):
        create = CREATE_EXT.search(line)
        # CREATE EXTENSION itself establishes availability for following statements.
        if create:
            declared.add(create.group(1).lower())
            continue
        for ext, pattern in EXTENSIONS.items():
            if pattern.search(line) and ext not in declared:
                errors.append(
                    f'{path.name}: extension {ext} is used before it is declared/bootstrap-installed'
                )

if errors:
    print('DB extension prerequisite contract: FAIL')
    for err in sorted(set(errors)):
        print(' -', err)
    raise SystemExit(1)

print('DB extension prerequisite contract: PASS')
print(' bootstrap extensions:', ', '.join(sorted(set(
    m.group(1).lower()
    for line in executable_lines(bootstrap_text)
    for m in [CREATE_EXT.search(line)]
    if m
))))
