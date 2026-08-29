#!/usr/bin/env python3
"""Source contract for mandatory live migration-parity release gates."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ci = (ROOT / '.github' / 'workflows' / 'ci.yml').read_text(encoding='utf-8')
staging = (ROOT / '.github' / 'workflows' / 'staging-integration.yml').read_text(encoding='utf-8')
package = (ROOT / 'package.json').read_text(encoding='utf-8')
checks = {
    'staging parity in primary CI': 'node ci/check_live_migration_parity.mjs staging' in ci,
    'production parity job': 'production-migration-parity:' in ci,
    'production parity in primary CI': 'node ci/check_live_migration_parity.mjs production' in ci,
    'production environment isolation': 'environment: production' in ci,
    'production service-role secret': 'BNN_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY' in ci,
    'manual staging workflow parity': 'node ci/check_live_migration_parity.mjs staging' in staging,
    'manifest freshness guard wired': 'python3 ci/check_migration_manifest.py' in package,
    'released migration immutability guard wired': 'python3 ci/check_migration_immutability.py' in package,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    print('Migration parity contract: FAIL')
    for name in failed:
        print(f' - {name}')
    sys.exit(1)
print(f'Migration parity contract: PASS ({len(checks)}/{len(checks)})')
