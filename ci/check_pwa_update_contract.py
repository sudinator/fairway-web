from pathlib import Path
root = Path(__file__).resolve().parents[1]
sw = (root / 'public/sw.js').read_text()
reg = (root / 'components/register-sw.tsx').read_text()
flow = (root / 'lib/automatic-updates.ts').read_text()
manage = (root / 'components/app-update-checker.tsx').read_text()
checks = {
    'worker installs automatically': 'await self.skipWaiting()' in sw,
    'open documents are not claimed or reloaded': 'await self.clients.claim()' not in sw and 'location.reload(' not in flow and 'controllerchange' not in reg,
    'navigation checks network before offline cache': 'req.mode === "navigate"' in sw and 'fetch(req, { cache: "no-store" })' in sw,
    'fresh page survives a cache quota failure': 'cache quota cannot block a fresh page' in sw,
    'API/auth/live/version traffic bypasses cache': all(x in sw for x in ['/api/', '/auth/', '/live/', '/lineup/', '/app-version.json']),
    'activation does not inspect scores or require other tabs': 'safeActivation' not in sw and 'bnn-update-check' not in sw,
    'update registration never reads score blockers': all(x not in flow + reg + manage for x in ['updatesBlocked(', 'updateBlockers(', 'reconcileUpdateGames(', 'applyAppUpdate(', '<SavedScoreReview']),
    'no scoring interlocks mounted by scorecards': all('useScoringUpdateProtection(' not in (root / f).read_text() for f in ['components/round-editor.tsx', 'components/tournaments.tsx']),
    'worker cache cleanup is restricted to its current sole document': 'windows.length !== 1' in sw and 'event.data.version === SW_VERSION' in sw and 'windows[0].id !== event.source?.id' in sw,
    'push support retained': 'self.addEventListener("push"' in sw and 'self.addEventListener("notificationclick"' in sw,
    'legacy archives remain exportable': 'Download recovery copies' in manage,
}
for label, result in checks.items(): print(('PASS: ' if result else 'FAIL: ') + label)
if not all(checks.values()): raise SystemExit('Automatic update contract failed')
