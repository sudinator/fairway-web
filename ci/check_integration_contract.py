#!/usr/bin/env python3
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
text=(root/'ci/integration/staging.mjs').read_text()
manual=(root/'.github/workflows/staging-integration.yml').read_text()
ci=(root/'.github/workflows/ci.yml').read_text()
pkg=(root/'package.json').read_text()
needles={
 'mutation safety confirmation':'BNN_STAGING_ALLOW_MUTATION',
 'production project refusal':'Refusing destructive staging integration against Production Supabase project',
 'production project ref':'epmbsmykyrnoiccwnoxq',
 'disposable users':'auth.admin.createUser',
 'RLS bypass denial':'member cannot bypass correction RPC',
 'course retry':'retry reuses the same pending correction request',
 'outsider RLS':'course correction is hidden from non-members',
 'expense rollback':'failed edit restores original shares',
 'RSVP concurrency':'Promise.all',
 'bet rollback':'failed bet repost preserves original posted expense',
 'safe group delete':'safe group delete refuses a club with other active members',
 'money audit cleanup':'service.from("money_audit").delete().eq("group_id", gid)',
 'money audit cleanup verification':'Cleanup left ${',
 'cleanup':'auth.admin.deleteUser',
}
errors=[f"missing {label}" for label,n in needles.items() if n not in text]

# Regression guard for the 177.37 URL-constructor shadowing bug: the staging
# Supabase URL variable must never be named URL, because that shadows Node's
# global URL constructor and makes `new URL(...)` fail before the safety check.
if 'const STAGING_URL = process.env.BNN_STAGING_SUPABASE_URL;' not in text:
    errors.append('staging harness must bind BNN_STAGING_SUPABASE_URL as STAGING_URL')
if 'const URL = process.env.BNN_STAGING_SUPABASE_URL;' in text:
    errors.append('staging harness shadows the global URL constructor')
if 'new URL(STAGING_URL)' not in text:
    errors.append('staging harness must parse STAGING_URL with the global URL constructor')
manual_needles={
 'manual mutation input':'confirm_mutation:',
 'manual input wiring':'BNN_STAGING_ALLOW_MUTATION: ${{ inputs.confirm_mutation }}',
 'protected staging environment':'environment: staging',
 'production ref workflow guard':'BNN_PRODUCTION_SUPABASE_PROJECT_REF: epmbsmykyrnoiccwnoxq',
}
errors += [f"manual workflow missing {label}" for label,n in manual_needles.items() if n not in manual]
if 'BNN_STAGING_ALLOW_MUTATION: YES' in manual:
    errors.append('manual workflow hardcodes BNN_STAGING_ALLOW_MUTATION=YES')
ci_needles={
 'required verify staging credentials':'BNN_STAGING_SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.BNN_STAGING_SUPABASE_SERVICE_ROLE_KEY }}',
 'required verify production ref':'BNN_PRODUCTION_SUPABASE_PROJECT_REF: epmbsmykyrnoiccwnoxq',
 'real staging gate step':'name: Real staging integration gate',
 'main target condition':"github.base_ref == 'main'",
 'staging source condition':"github.head_ref == 'staging'",
 'real harness execution':'run: npm run test:staging',
}
errors += [f"CI workflow missing {label}" for label,n in ci_needles.items() if n not in ci]
for n in ['"test:staging"','"ci:staging"']:
    if n not in pkg: errors.append(f'missing package script {n}')
if errors:
    print('STAGING INTEGRATION CONTRACT: FAIL')
    print('\n'.join(' - '+e for e in errors)); sys.exit(1)
print('STAGING INTEGRATION CONTRACT: PASS')
