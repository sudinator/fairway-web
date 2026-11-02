// Birdie Num Num: background download, explicit activation, fresh online navigation.
// No clients.claim(): do not take over uncontrolled documents. Activation can
// change a controlled page’s controller; the new app never reloads on that event.
const SW_VERSION = "212.87.261102";
const CACHE = `bnn-shell-${SW_VERSION}`;
// Commit an offline shell only after its initial scripts/styles are cached.
// Otherwise a background update could leave an offline restart with new HTML
// whose code was never downloaded while the old game was still running.
async function cacheShell(response, request = "/") {
  const cache = await caches.open(CACHE), html = await response.clone().text();
  const paths = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m => m[1]);
  paths.push(...[...html.matchAll(/\/_next\/static\/[^"'<>\\\s]+/g)].map(m => m[0]));
  const assets = [...new Set(paths.map(p => new URL(p.replaceAll("&amp;", "&"), self.location.origin)).filter(u => u.origin === self.location.origin && /\.(?:js|css)(?:\?|$)/.test(u.pathname + u.search)).map(u => u.href))];
  await Promise.all(assets.map(async url => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try { const asset = await fetch(url, { cache: "no-store", signal: controller.signal }); if (!asset.ok) throw new Error("Shell asset unavailable"); await cache.put(url, asset); }
    finally { clearTimeout(timer); }
  }));
  await cache.put(request, response.clone());
}
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try { const fresh = await fetch("/", { cache: "no-store", signal: controller.signal }); if (fresh.ok) await cacheShell(fresh); } catch { /* keep existing complete offline shell */ }
    finally { clearTimeout(timer); }
    // Wait for the explicit Update now action. Older open app versions reload
    // on controllerchange; automatic activation would restart their scorecards.
  })());
});
self.addEventListener("activate", event => {
  // Old windows may still need their assets. Prune only after a current-version
  // document confirms it is the sole window in this browser's registration.
  event.waitUntil(Promise.resolve());
});
self.addEventListener("message", event => {
  // Compatible with the existing production Update button; no score-state gate.
  if (event.data === "SKIP_WAITING") { event.waitUntil(self.skipWaiting()); return; }
  if (event.data?.kind === "bnn-cleanup-shells" && event.data.version === SW_VERSION) {
    event.waitUntil((async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (windows.length !== 1 || windows[0].id !== event.source?.id || !await (await caches.open(CACHE)).match("/")) return;
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith("bnn-shell-") && k !== CACHE).map(k => caches.delete(k)));
    })());
  }
});
function shouldBypass(url) {
  return url.pathname.startsWith("/live/") || url.pathname.startsWith("/lineup/") || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname === "/app-version.json";
}
self.addEventListener("fetch", event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || shouldBypass(url)) return;
  event.respondWith((async () => {
    if (req.mode === "navigate") {
      // Navigation is always fresh online; a failure retains offline scoring.
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        if (fresh.ok) { event.waitUntil(cacheShell(fresh.clone(), req).catch(() => { /* cache quota cannot block a fresh page */ })); return fresh; }
        const saved = await (await caches.open(CACHE)).match(req) || await (await caches.open(CACHE)).match("/") || await caches.match(req) || await caches.match("/");
        return saved || fresh;
      } catch {
        const saved = await (await caches.open(CACHE)).match(req) || await (await caches.open(CACHE)).match("/") || await caches.match(req) || await caches.match("/");
        if (saved) return saved;
        return new Response("BNN is offline. Reconnect once to load the app; saved scores have not been removed.", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    }
    const saved = await caches.match(req);
    if (saved) return saved;
    const fresh = await fetch(req);
    if (fresh.ok && fresh.type === "basic") await (await caches.open(CACHE)).put(req, fresh.clone());
    return fresh;
  })());
});

// ---- Web Push (phase 1: display + click routing; server sender arrives in phase 2) ----
// Public VAPID key (safe to embed) — used only to re-subscribe if the browser rotates
// the subscription. The client subscribe path reads the same value from env.
const VAPID_PUBLIC_KEY = "BPosOVuEyjpY3zfcnhq_LP__z1IEs2_sgNPg9JNYG38_n54R5wpGgRx4cyq-lr5w9_UIdMC0Fn2bIocDJj9H0fc";

function b64ToUint8(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data ? event.data.text() : "" }; }
  const title = payload.title || "Birdie Num Num";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || undefined,          // same tag replaces an earlier one instead of stacking
    renotify: !!payload.tag,
    data: { link: payload.link || "/" },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Focus an already-open BNN tab and route it; otherwise open a new one.
    for (const c of all) {
      if (c.url.includes(self.location.origin)) {
        await c.focus();
        try { c.postMessage({ kind: "notif-nav", link }); } catch {}
        return;
      }
    }
    await self.clients.openWindow(link);
  })());
});

// If the browser invalidates/rotates the subscription, transparently re-subscribe so
// the device keeps receiving pushes. The page picks up the new subscription on next open.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    try {
      await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(VAPID_PUBLIC_KEY),
      });
    } catch { /* page will re-subscribe on next open */ }
  })());
});
