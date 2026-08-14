from pathlib import Path

root = Path(__file__).resolve().parents[1]
sw = (root / "public/sw.js").read_text(encoding="utf-8")
reg = (root / "components/register-sw.tsx").read_text(encoding="utf-8")
manage = (root / "components/manage.tsx").read_text(encoding="utf-8")
writer = (root / "scripts/write-version.mjs").read_text(encoding="utf-8")

checks = {
    "service worker version is app-version based, not build-id based": "const swVersion = appVersion;" in writer,
    "service worker uses cache-first shell behavior": "const cached = await caches.match(req);" in sw and "if (cached) return cached;" in sw,
    "register-sw prompt is version-driven": "const hasUpdate = versionUpdate;" in reg,
    "register-sw does not treat waiting worker alone as an update": "const hasUpdate = !!waiting || versionUpdate;" not in reg,
    "help checker compares deployed version, not waiting worker": "const isNewer = !!serverVersion && serverVersion !== APP_VERSION;" in manage,
    "service-worker activation remains explicit": 'postMessage("SKIP_WAITING")' in reg and 'event.data === "SKIP_WAITING"' in sw,
}

bad = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(("PASS" if ok else "FAIL") + ": " + name)
if bad:
    raise SystemExit("PWA update contract failed: " + "; ".join(bad))
