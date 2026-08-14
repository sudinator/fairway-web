from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
pkg=(ROOT/'package.json').read_text(encoding='utf-8')
script=(ROOT/'scripts/check-vapid-key.mjs').read_text(encoding='utf-8')
sw=(ROOT/'public/sw.js').read_text(encoding='utf-8')
checks={
 'prebuild enforces VAPID drift check':'check-vapid-key.mjs' in pkg,
 'checker compares env public key':'NEXT_PUBLIC_VAPID_PUBLIC_KEY' in script and 'envKey !== swKey' in script,
 'service worker exposes canonical constant':'const VAPID_PUBLIC_KEY =' in sw,
}
failed=[k for k,v in checks.items() if not v]
if failed:
 print('VAPID source contract: FAIL')
 for x in failed: print(' -',x)
 raise SystemExit(1)
print('VAPID source contract: PASS')
