// Birdie Num Num service worker.
// Goal: let the installed app open even on poor/no signal (cache the app shell),
// WITHOUT ever serving stale data. So: never touch Supabase, our API routes, or
// auth — those always go straight to the network. Everything else is
// network-first with a cache fallback, so users get fresh code when online and a
// working shell when offline.

const SW_VERSION = "1.50.0-local-20260623170729";
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
