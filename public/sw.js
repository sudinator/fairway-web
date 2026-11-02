// Birdie Num Num service worker.
// Goal: keep the installed app on its CURRENT code version until the user explicitly
// taps Update, while never serving stale live data. Supabase/API/auth requests always
// bypass the worker. App-shell requests are cache-first for the lifetime of the active
// worker; activating a new version creates a new cache and reloads into the new shell.

const SW_VERSION = "212.83.261101";
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

// Every open window must explicitly acknowledge that scoring is safe. A frozen,
// old or unreachable window is NOT consent. No heartbeat expiry can end a round.
let updateAttempt = null;
async function safeActivation() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const requestId = crypto.randomUUID();
  const results = await Promise.all(windows.map(client => new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve({ ready: false, blockers: [{ key: `tab:${client.id}`, title: "Another BNN tab did not respond", action: "Finish and sync rounds in your other BNN tabs/windows, then close them and try again. An older or sleeping tab cannot confirm that updating is safe. Do not clear browser data." }] }); }, 4000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve({ ready: event.data?.ready === true, blockers: Array.isArray(event.data?.blockers) ? event.data.blockers.map(item => ({ ...item, key: `tab:${client.id}:${item.key}` })) : [] }); };
    try { client.postMessage({ kind: "bnn-update-check", requestId }, [channel.port2]); }
    catch { clearTimeout(timer); channel.port1.close(); resolve({ ready: false, blockers: [{ key: `tab:${client.id}`, title: "Another BNN tab could not be checked", action: "Finish and sync any rounds in that tab, close it, then try again." }] }); }
  })));
  const now = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const sameWindows = now.length === windows.length && now.every(c => windows.some(w => w.id === c.id));
  const blockers = results.flatMap(result => result.ready ? [] : result.blockers.length ? result.blockers : [{ key: "other-tab", title: "Another BNN tab is not ready", action: "Return to that tab and finish saving its scores, then try again." }]);
  if (!sameWindows) blockers.push({ key: "tabs-changed", title: "The open BNN tabs changed during the update check", action: "Wait until the other tabs finish opening or closing, then try again." });
  const ready = results.map(result => result.ready);
  if (ready.every(Boolean) && sameWindows) { await self.skipWaiting(); return { kind: "bnn-update-result", accepted: true, blockers: [] }; }
  windows.forEach(client => { try { client.postMessage({ kind: "bnn-update-release", requestId }); } catch {} });
  return { kind: "bnn-update-result", accepted: false, blockers, message: "Update paused. Another open BNN tab needs attention; your scores have not been changed." };
}
self.addEventListener("message", event => {
  if (event.data?.kind === "bnn-score-review-alone") {
    event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
      event.ports[0]?.postMessage({ alone: windows.length === 1 && windows[0].id === event.source?.id });
    }));
    return;
  }
  if (event.data !== "SKIP_WAITING") return;
  if (!updateAttempt) updateAttempt = safeActivation().finally(() => { updateAttempt = null; });
  event.waitUntil(updateAttempt.then(result => { if (event.ports[0]) event.ports[0].postMessage(result); }).catch(() => { if (event.ports[0]) event.ports[0].postMessage({ kind: "bnn-update-result", accepted: false, message: "The update check failed. Keep your saved scores and try again when connected." }); }));
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
    // Public share pages (/live/<token>, /lineup/<token>) are opened from chats, usually in Safari,
    // where nobody can tap Update. Cache-first pinned a broken /lineup page in Safari across two
    // fixes (201.2 -> 201.4, 2026-10-08). They are not the installed app shell: always network.
    url.pathname.startsWith("/live/") ||
    url.pathname.startsWith("/lineup/") ||
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
