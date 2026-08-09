#!/usr/bin/env python3
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
text=(root/'ci/integration/staging.mjs').read_text()
pkg=(root/'package.json').read_text()
needles={
 'mutation safety confirmation':'BNN_STAGING_ALLOW_MUTATION',
 'disposable users':'auth.admin.createUser',
 'RLS bypass denial':'member cannot bypass correction RPC',
 'course retry':'retry reuses the same pending correction request',
 'outsider RLS':'course correction is hidden from non-members',
 'expense rollback':'failed edit restores original shares',
 'RSVP concurrency':'Promise.all',
 'bet rollback':'failed bet repost preserves original posted expense',
 'safe group delete':'safe group delete refuses a club with other active members',
 'cleanup':'auth.admin.deleteUser',
}
errors=[f"missing {label}" for label,n in needles.items() if n not in text]
for n in ['"test:staging"','"ci:staging"']:
    if n not in pkg: errors.append(f'missing package script {n}')
if errors:
    print('STAGING INTEGRATION CONTRACT: FAIL')
    print('\n'.join(' - '+e for e in errors)); sys.exit(1)
print('STAGING INTEGRATION CONTRACT: PASS')
