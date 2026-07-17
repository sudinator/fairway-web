// Birdie Num Num service worker.
// Goal: let the installed app open even on poor/no signal (cache the app shell),
// WITHOUT ever serving stale data. So: never touch Supabase, our API routes, or
// auth — those always go straight to the network. Everything else is
// network-first with a cache fallback, so users get fresh code when online and a
// working shell when offline.

const SW_VERSION = "174.0.260716-local-20260717033447";
const CACHE = `bnn-shell-${SW_VERSION}`;

self.addEventListener("install", (event) => {
  // Do NOT skipWaiting here. On a first install there's no active worker to wait
  // behind, so the worker activates on its own. On an UPDATE, staying in the
  // "waiting" state is what lets the page detect it and show the "Update
  // available" prompt — the user's tap (SKIP_WAITING below) is what activates it.
});

// The page tells a waiting worker to activate now — fired when the user taps
// "Update". This is the ONLY place we skip waiting, so updates are user-driven.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop old shell caches on version bump.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function shouldBypass(url) {
  // Never intercept anything that must be live: data, auth, AI, external APIs.
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
  if (req.method !== "GET") return; // only cache GETs
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return; // let cross-origin go straight through
  if (shouldBypass(url)) return; // live data — don't touch

  // Network-first: try the network, fall back to cache when offline.
  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        // Cache a copy of successful same-origin responses for offline use.
        if (fresh && fresh.status === 200 && fresh.type === "basic") {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        // For navigations with nothing cached, try the cached root as a last resort.
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
