// Birdie Num Num service worker.
// Goal: keep the installed app on its CURRENT code version until the user explicitly
// taps Update, while never serving stale live data. Supabase/API/auth requests always
// bypass the worker. App-shell requests are cache-first for the lifetime of the active
// worker; activating a new version creates a new cache and reloads into the new shell.

const SW_VERSION = "177.42.260816";
const CACHE = `bnn-shell-${SW_VERSION}`;

self.addEventListener("install", (event) => {
  // Do NOT skipWaiting here. On UPDATE the worker stays waiting until the user taps
  // Update. Pre-cache the root shell for this worker so activation has a coherent
  // starting document even if connectivity is poor.
  event.waitUntil((async () => {
    try {
      const fresh = await fetch("/", { cache: "no-store" });
      if (fresh && fresh.status === 200) {
        const cache = await caches.open(CACHE);
        await cache.put("/", fresh.clone());
      }
    } catch { /* first navigation will populate the cache */ }
  })());
});

// The page tells a waiting worker to activate now — fired only after the user taps Update.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function shouldBypass(url) {
  return (
    url.hostname.endsWith("supabase.co") ||
    url.hostname.includes("supabase") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname === "/app-version.json" ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("google.com") ||
    url.hostname.includes("generativelanguage")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;
  if (shouldBypass(url)) return;

  // Cache-first is deliberate: the ACTIVE worker pins the installed app shell to
  // its current release. A new deployment can download a waiting worker, but the
  // old code stays in use until the user explicitly activates that worker.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200 && fresh.type === "basic") {
          const cache = await caches.open(CACHE);
          await cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        // For an uncached navigation with no network, fall back to the cached root.
        if (req.mode === "navigate") {
          const root = await caches.match("/");
          if (root) return root;
        }
        throw new Error("offline and not cached");
      }
    })()
  );
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
