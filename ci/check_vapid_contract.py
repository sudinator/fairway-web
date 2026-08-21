from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
pkg=(ROOT/'package.json').read_text(encoding='utf-8')
script=(ROOT/'scripts/check-vapid-key.mjs').read_text(encoding='utf-8')
sw=(ROOT/'public/sw.js').read_text(encoding='utf-8')
ci=(ROOT/'.github/workflows/ci.yml').read_text(encoding='utf-8')
checks={
 'prebuild enforces VAPID drift check':'check-vapid-key.mjs' in pkg,
 'checker compares env public key':'NEXT_PUBLIC_VAPID_PUBLIC_KEY' in script and 'envKey !== swKey' in script,
 'service worker exposes canonical constant':'const VAPID_PUBLIC_KEY =' in sw,
 # The checker used to exit 0 with "comparison skipped" when the variable was unset, so deleting
 # it from Vercel would have produced a green build that verified nothing. Absence of the input is
 # a failure of the check, not a pass — the same shape as GOLF_API_KEY sitting unset for months
 # while its workflow reported nothing wrong. An explicit opt-out is allowed for local builds only.
 'missing key FAILS rather than silently skipping':
   'VAPID_CHECK_OPTIONAL' in script and 'process.exit(1)' in script.split('if (!envKey)')[1].split('if (envKey !== swKey)')[0],
 # ...which means CI must supply the key, or every build fails on configuration.
 'CI supplies the key so the check actually runs':'NEXT_PUBLIC_VAPID_PUBLIC_KEY' in ci,
}
failed=[k for k,v in checks.items() if not v]
if failed:
 print('VAPID source contract: FAIL')
 for x in failed: print(' -',x)
 raise SystemExit(1)
print('VAPID source contract: PASS')
