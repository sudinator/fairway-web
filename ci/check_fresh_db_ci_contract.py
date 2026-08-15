from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ci = (ROOT / '.github' / 'workflows' / 'ci.yml').read_text(encoding='utf-8')
script_path = ROOT / 'ci' / 'test_fresh_db_rebuild.sh'
script = script_path.read_text(encoding='utf-8') if script_path.exists() else ''
ordering_path = ROOT / 'ci' / 'list_ordered_migrations.py'
ordering = ordering_path.read_text(encoding='utf-8') if ordering_path.exists() else ''
schema_check = (ROOT / 'ci' / 'schema-check.sh').read_text(encoding='utf-8')
rls_assert_path = ROOT / 'ci' / 'assert-core-rls-live.sql'
rls_assert = rls_assert_path.read_text(encoding='utf-8') if rls_assert_path.exists() else ''
bootstrap_path = ROOT / 'ci' / 'fresh_db_bootstrap.sql'
bootstrap = bootstrap_path.read_text(encoding='utf-8') if bootstrap_path.exists() else ''
extension_guard_path = ROOT / 'ci' / 'check_db_extension_prereqs.py'
extension_guard = extension_guard_path.read_text(encoding='utf-8') if extension_guard_path.exists() else ''
errors = []

outer_tx_begin = rls_assert.find('\nbegin;\n')
first_do = rls_assert.find('\ndo $$')
pass_result = rls_assert.find("select 'core RLS live contract PASS")
final_commit = rls_assert.rfind('\ncommit;')
rls_transaction_ok = (
    0 <= outer_tx_begin < first_do
    and pass_result >= 0
    and final_commit > pass_result
    and rls_assert[final_commit:].strip() == 'commit;'
)

checks = {
    'CI installs pinned Supabase CLI': 'supabase/setup-cli@v3' in ci and 'version: 2.101.0' in ci,
    'CI installs psql client': 'postgresql-client' in ci,
    'CI runs fresh database reconstruction': 'bash ci/test_fresh_db_rebuild.sh' in ci,
    'fresh rebuild starts a clean Supabase Postgres database': 'supabase db start' in script,
    'fresh rebuild installs source-controlled database prerequisites': 'fresh_db_bootstrap.sql' in script,
    'fresh bootstrap declares citext before migration 0001': 'create extension if not exists citext' in bootstrap.lower(),
    'extension prerequisite guard exists': 'DB extension prerequisite contract' in extension_guard,
    'fresh rebuild delegates cross-tree ordering to semantic helper': 'list_ordered_migrations.py' in script,
    'ordering helper scans supabase migration tree': "ROOT / 'supabase' / 'migrations'" in ordering,
    'ordering helper scans application migration tree': "ROOT / 'migrations'" in ordering,
    'ordering helper parses numeric migration prefix': "re.compile(r'^(\\d{4})_" in ordering,
    'ordering helper rejects duplicate migration numbers': 'duplicate migration number' in ordering,
    'ordering helper requires 0001 first': "entries[0][0] != 1" in ordering,
    'fresh rebuild applies migrations with stop-on-error': 'ON_ERROR_STOP=1 -f "$migration"' in script,
    'fresh rebuild verifies historical compatibility columns': 'assert-historical-baseline-columns.sql' in script,
    'fresh rebuild asserts live RLS baseline': 'assert-core-rls-live.sql' in script,
    'RLS verifier emits per-policy diagnostic rows before failing': 'CORE_RLS_DIFF' in rls_assert and 'differing_fields' in rls_assert,
    'RLS verifier reports Production-export, runtime-expected, and actual policy expressions': 'production_export_qual' in rls_assert and 'expected_runtime_qual' in rls_assert and 'actual_qual' in rls_assert and 'production_export_with_check' in rls_assert and 'expected_runtime_with_check' in rls_assert and 'actual_with_check' in rls_assert,
    'RLS verifier canonicalizes expected expressions through the same PostgreSQL engine': '_core_rls_expected_runtime' in rls_assert and 'create policy %I on pg_temp.%I' in rls_assert and 'pg_my_temp_schema()' in rls_assert,
    'RLS verifier keeps raw Production export visible while hard-gating runtime canonical equality': 'production_export_qual' in rls_assert and 'expected_runtime_qual' in rls_assert and 'CORE_RLS_RENDERING' in rls_assert and 'expected_runtime_qual is distinct from actual_qual' in rls_assert,
    'RLS verifier executes semantic negative canaries': all(marker in rls_assert for marker in ['__canary_remove_admin', '__canary_holes_or', '__canary_guest_without_flag', '__canary_join_without_self', '__canary_organizer_marker', '__canary_group_course_no_active', 'CORE_RLS_CANARY_PASS']),
    'RLS verifier reports database version for deparser diagnostics': 'CORE_RLS_DB_VERSION' in rls_assert and "current_setting('server_version')" in rls_assert,
    'RLS verifier encloses ON COMMIT DROP diagnostics in one top-level transaction': rls_transaction_ok,
    'fresh rebuild verifies RLS helper presence': 'public.is_game_member(uuid)' in script and 'public.shares_active_club(uuid)' in script,
    'live schema guard waits for RLS baseline migration sentinel': "0137_core_rls_baseline" in schema_check and 'schema_migrations' in schema_check,
}
for name, ok in checks.items():
    if not ok:
        errors.append(name)

if ordering_path.exists():
    result = subprocess.run(
        ['python3', str(ordering_path), str(ROOT)],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        errors.append('ordering helper executes successfully on repository migration trees')
    else:
        paths = [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]
        names = [path.name for path in paths]
        numbers = [int(name[:4]) for name in names]
        if not names or names[0][:4] != '0001':
            errors.append('ordered migration stream starts with 0001')
        if numbers != sorted(numbers):
            errors.append('ordered migration stream is numeric-monotonic')
        if len(numbers) != len(set(numbers)):
            errors.append('ordered migration stream has unique numeric prefixes')
        if '0014_round_clock.sql' in names and '0001_baseline.sql' in names:
            if names.index('0001_baseline.sql') > names.index('0014_round_clock.sql'):
                errors.append('0001 baseline executes before 0014 round clock')

if errors:
    print('Fresh DB CI contract: FAIL')
    for e in errors:
        print(' -', e)
    raise SystemExit(1)
print('Fresh DB CI contract: PASS')
