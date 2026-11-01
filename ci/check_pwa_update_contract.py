from pathlib import Path

root = Path(__file__).resolve().parents[1]
sw = (root / "public/sw.js").read_text(encoding="utf-8")
reg = (root / "components/register-sw.tsx").read_text(encoding="utf-8")
flow = (root / "lib/app-update.ts").read_text(encoding="utf-8")
manage = (root / "components/app-update-checker.tsx").read_text(encoding="utf-8")
writer = (root / "scripts/write-version.mjs").read_text(encoding="utf-8")

checks = {
    "service worker version is app-version based, not build-id based": "const swVersion = appVersion;" in writer,
    "service worker uses cache-first shell behavior": "const cached = await caches.match(req);" in sw and "if (cached) return cached;" in sw,
    "register-sw prompt is version-driven": "const hasUpdate = versionUpdate && !blocked;" in reg,
    "register-sw does not treat waiting worker alone as an update": "const hasUpdate = !!waiting || versionUpdate;" not in reg,
    "help checker compares deployed version, not waiting worker": "const isNewer = !!update.latest && update.latest !== APP_VERSION;" in manage,
    "worker requires all windows ready": "ready.every(Boolean) && sameWindows" in sw,
    "reload checks scoring safety": "if (updatesBlocked()) { pendingReload.current = true; reportDeferredReload(); return; }" in reg,
    "shared activation rechecks safety after download": "if (updatesBlocked())" in flow and "applyAppUpdate" in manage,
    "worker returns refused and accepted outcomes": 'kind: "bnn-update-result"' in sw and "accepted: false" in sw and "accepted: true" in sw,
    "dismissal is wired": "onDismiss={dismissUpdate}" in reg,
    "success checks installed version": 'target === APP_VERSION ? "success"' in flow,
    "game registers protection": "useScoringUpdateProtection(\"game\"" in (root / "components/tournaments.tsx").read_text(),
    "personal round registers protection": "useScoringUpdateProtection(\"round\"" in (root / "components/round-editor.tsx").read_text(),
    "service-worker activation remains explicit": 'postMessage("SKIP_WAITING", [channel.port2])' in flow and 'event.data !== "SKIP_WAITING"' in sw,
}

bad = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(("PASS" if ok else "FAIL") + ": " + name)
if bad:
    raise SystemExit("PWA update contract failed: " + "; ".join(bad))
