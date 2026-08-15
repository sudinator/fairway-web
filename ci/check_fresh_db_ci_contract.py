from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ci = (ROOT / '.github' / 'workflows' / 'ci.yml').read_text(encoding='utf-8')
script = (ROOT / 'ci' / 'test_fresh_db_rebuild.sh').read_text(encoding='utf-8')
ordering_path = ROOT / 'ci' / 'list_ordered_migrations.py'
ordering = ordering_path.read_text(encoding='utf-8') if ordering_path.exists() else ''
schema_check = (ROOT / 'ci' / 'schema-check.sh').read_text(encoding='utf-8')
live = (ROOT / 'ci' / 'assert-core-rls-live.sql').read_text(encoding='utf-8')
behavior = (ROOT / 'ci' / 'assert-core-rls-behavior.sql').read_text(encoding='utf-8')
bootstrap = (ROOT / 'ci' / 'fresh_db_bootstrap.sql').read_text(encoding='utf-8')
extension_guard = (ROOT / 'ci' / 'check_db_extension_prereqs.py').read_text(encoding='utf-8')
errors = []

checks = {
    'CI installs pinned Supabase CLI': 'supabase/setup-cli@v3' in ci and 'version: 2.101.0' in ci,
    'CI installs psql client': 'postgresql-client' in ci,
    'CI runs fresh database reconstruction': 'bash ci/test_fresh_db_rebuild.sh' in ci,
    'fresh rebuild starts a clean Supabase Postgres database': 'supabase db start' in script,
    'fresh rebuild installs source-controlled database prerequisites': 'fresh_db_bootstrap.sql' in script,
    'fresh bootstrap declares citext before migration 0001': 'create extension if not exists citext' in bootstrap.lower(),
    'extension prerequisite guard exists': 'DB extension prerequisite contract' in extension_guard,
    'fresh rebuild delegates cross-tree ordering to semantic helper': 'list_ordered_migrations.py' in script,
    'ordering helper scans both migration trees': "ROOT / 'supabase' / 'migrations'" in ordering and "ROOT / 'migrations'" in ordering,
    'ordering helper parses/rejects invalid numeric ordering': "re.compile(r'^(\\d{4})_" in ordering and 'duplicate migration number' in ordering and "entries[0][0] != 1" in ordering,
    'fresh rebuild applies migrations with stop-on-error': 'ON_ERROR_STOP=1 -f "$migration"' in script,
    'fresh rebuild verifies historical compatibility columns': 'assert-historical-baseline-columns.sql' in script,
    'fresh rebuild runs read-only structural RLS gate': 'assert-core-rls-live.sql' in script,
    'fresh rebuild runs real authorization behavior RLS gate': 'assert-core-rls-behavior.sql' in script,
    'live RLS gate compares identity/metadata but not expression text': 'policy identities+metadata' in live and 'qual is distinct from' not in live and 'with_check is distinct from' not in live and 'pg_temp' not in live and 'create policy' not in live.lower(),
    'source expression contract remains part of normal guards': 'check_core_rls_baseline.py' in (ROOT / 'package.json').read_text(encoding='utf-8'),
    'behavior gate authenticates through JWT claim and RLS role': 'set local role authenticated' in behavior and "request.jwt.claim.sub" in behavior and 'set local row_security = on' in behavior,
    'behavior gate tests three representative core relations': all(x in behavior for x in ['public.notifications','public.rounds','public.holes','CORE_RLS_BEHAVIOR_PASS']),
    'behavior gate proves denial paths': behavior.count('when insufficient_privilege then denied := true') >= 3 and behavior.rstrip().endswith('rollback;'),
    'fresh rebuild verifies RLS helper presence': 'public.is_game_member(uuid)' in script and 'public.shares_active_club(uuid)' in script,
    'live schema guard waits for RLS baseline migration sentinel': "0137_core_rls_baseline" in schema_check and 'schema_migrations' in schema_check,
}
for name, ok in checks.items():
    if not ok: errors.append(name)

if ordering_path.exists():
    result = subprocess.run(['python3', str(ordering_path), str(ROOT)], text=True, capture_output=True, check=False)
    if result.returncode != 0:
        errors.append('ordering helper executes successfully on repository migration trees')
    else:
        paths = [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]
        names = [p.name for p in paths]
        numbers = [int(name[:4]) for name in names]
        if not names or names[0][:4] != '0001': errors.append('ordered migration stream starts with 0001')
        if numbers != sorted(numbers): errors.append('ordered migration stream is numeric-monotonic')
        if len(numbers) != len(set(numbers)): errors.append('ordered migration stream has unique numeric prefixes')
        if '0014_round_clock.sql' in names and '0001_baseline.sql' in names and names.index('0001_baseline.sql') > names.index('0014_round_clock.sql'):
            errors.append('0001 baseline executes before 0014 round clock')

if errors:
    print('Fresh DB CI contract: FAIL')
    for e in errors: print(' -', e)
    raise SystemExit(1)
print('Fresh DB CI contract: PASS')
