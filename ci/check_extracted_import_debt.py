#!/usr/bin/env python3
from pathlib import Path
import json, re, sys
ROOT=Path(__file__).resolve().parents[1]
baseline=json.loads((ROOT/'ci/extracted_import_debt_baseline.json').read_text())
def count(body):
    n=0
    for m in re.finditer(r'import\s+(.+?)\s+from\s+["\'][^"\']+["\'];',body,re.S):
        clause=m.group(1).strip()
        if clause.startswith('{'):
            n += len([x for x in clause[1:-1].split(',') if x.strip()])
        elif ',' in clause:
            n += 1
            rest=clause.split(',',1)[1]
            if '{' in rest:
                n += len([x for x in rest[rest.index('{')+1:rest.rindex('}')].split(',') if x.strip()])
        else:
            n += 1
    return n
bad=[]
for rel,limit in baseline.items():
    actual=count((ROOT/rel).read_text(encoding='utf-8'))
    if actual>limit:
        bad.append(f'{rel}: imported-symbol debt increased {limit} -> {actual}')
if bad:
    print('Extracted import-debt ratchet FAILED')
    print('\n'.join('  '+x for x in bad)); sys.exit(1)
print('Extracted import-debt ratchet: PASS')
