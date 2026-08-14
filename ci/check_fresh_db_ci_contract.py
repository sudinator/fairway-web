from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ci = (ROOT / '.github' / 'workflows' / 'ci.yml').read_text(encoding='utf-8')
script_path = ROOT / 'ci' / 'test_fresh_db_rebuild.sh'
script = script_path.read_text(encoding='utf-8') if script_path.exists() else ''
errors = []

checks = {
    'CI installs pinned Supabase CLI': 'supabase/setup-cli@v3' in ci and 'version: 2.101.0' in ci,
    'CI installs psql client': 'postgresql-client' in ci,
    'CI runs fresh database reconstruction': 'bash ci/test_fresh_db_rebuild.sh' in ci,
    'fresh rebuild starts a clean Supabase Postgres database': 'supabase db start' in script,
    'fresh rebuild reads supabase migration tree': '"$ROOT/supabase/migrations"' in script,
    'fresh rebuild reads application migration tree': '"$ROOT/migrations"' in script,
    'fresh rebuild orders the combined migration stream': "-name '*.sql' -print | sort" in script,
    'fresh rebuild applies migrations with stop-on-error': 'ON_ERROR_STOP=1 -f "$migration"' in script,
    'fresh rebuild asserts live RLS baseline': 'assert-core-rls-live.sql' in script,
    'fresh rebuild verifies RLS helper presence': 'public.is_game_member(uuid)' in script and 'public.shares_active_club(uuid)' in script,
}
for name, ok in checks.items():
    if not ok:
        errors.append(name)

if errors:
    print('Fresh DB CI contract: FAIL')
    for e in errors:
        print(' -', e)
    raise SystemExit(1)
print('Fresh DB CI contract: PASS')
