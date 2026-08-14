from pathlib import Path
src = Path('app/layout.tsx').read_text()
required = [
    'process.env.VERCEL_GIT_COMMIT_REF === "staging"',
    'top: "env(safe-area-inset-top, 0px)"',
    'border: "6px solid #FFD400"',
    '>STAGING</div>',
]
missing = [x for x in required if x not in src]
if missing:
    raise SystemExit('staging environment marker contract failed: ' + ', '.join(missing))
print('staging environment marker contract: PASS')
