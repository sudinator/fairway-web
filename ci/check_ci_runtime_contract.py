from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
workflows=ROOT/'.github/workflows'
node_workflows=['ci.yml','staging-integration.yml','external-api-contracts.yml']
errors=[]
for name in node_workflows:
    text=(workflows/name).read_text(encoding='utf-8')
    if "node-version-file: '.nvmrc'" not in text:
        errors.append(f'{name}: setup-node must use .nvmrc')
    if 'node-version:' in text:
        errors.append(f'{name}: hard-coded node-version remains')
rob=(workflows/'robustness.yml').read_text(encoding='utf-8')
if 'Types, tests, build' in rob or 'npm test' in rob or 'npm run build' in rob:
    errors.append('robustness.yml: duplicate full app CI still present; CI / verify is the single app build gate')
if (ROOT/'.nvmrc').read_text().strip() != '22':
    errors.append('.nvmrc: expected pinned major 22')
import json
pkg=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))
if pkg.get('engines',{}).get('node') != '22.x':
    errors.append('package.json: engines.node must be exactly 22.x so Vercel and CI use the same major')
lock=json.loads((ROOT/'package-lock.json').read_text(encoding='utf-8'))
if lock.get('packages',{}).get('',{}).get('engines',{}).get('node') != '22.x':
    errors.append('package-lock.json: root engines.node must match package.json (22.x)')
if errors:
    print('CI runtime contract: FAIL')
    for e in errors: print(' -',e)
    raise SystemExit(1)
print('CI runtime contract: PASS (Node 22 pinned in .nvmrc + package engines; duplicate app build removed)')
