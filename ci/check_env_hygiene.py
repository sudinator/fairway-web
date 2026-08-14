#!/usr/bin/env python3
from pathlib import Path
import re, sys
ROOT=Path(__file__).resolve().parents[1]
ignore=(ROOT/'.gitignore').read_text(encoding='utf-8').splitlines()
example=(ROOT/'.env.example').read_text(encoding='utf-8')
errors=[]
for rule in ['.env','.env.*','!.env.example']:
    if rule not in ignore:
        errors.append(f'.gitignore missing {rule}')
refs=set()
for base in ['app','components','lib','scripts','ci']:
    root=ROOT/base
    if not root.exists(): continue
    for p in root.rglob('*'):
        if p.suffix not in {'.ts','.tsx','.js','.mjs','.py'} or not p.is_file(): continue
        refs.update(re.findall(r'process\.env\.([A-Z0-9_]+)', p.read_text(encoding='utf-8',errors='replace')))
refs.update(re.findall(r'process\.env\.([A-Z0-9_]+)', (ROOT/'next.config.mjs').read_text(encoding='utf-8',errors='replace')) if (ROOT/'next.config.mjs').exists() else [])
defined=set(re.findall(r'^([A-Z][A-Z0-9_]*)=', example, re.M))
missing=sorted(refs-defined)
if missing: errors.append('.env.example missing referenced variables: '+', '.join(missing))
if errors:
    print('Environment hygiene FAILED')
    print('\n'.join('  - '+e for e in errors)); sys.exit(1)
print(f'Environment hygiene: PASS ({len(refs)} referenced variables documented)')
