"use client";
import { APP_VERSION } from "./app-version";
export type AutomaticUpdateState = { latest: string; checking: boolean; message: string };
const initial: AutomaticUpdateState = { latest: "", checking: false, message: "" };
let state = initial;
const listeners = new Set<() => void>();
export const automaticUpdateState = () => state;
export const serverAutomaticUpdateState = () => initial;
export const subscribeAutomaticUpdates = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function publish(patch: Partial<AutomaticUpdateState>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
let pending: Promise<void> | null = null;
export function checkAutomaticVersion(timeout = 7000): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    publish({ checking: true, message: "Checking the deployed version…" });
    try {
      const data = await Promise.race([
        (async () => {
          const response = await fetch(`/app-version.json?ts=${Date.now()}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error();
          return await response.json();
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Version check timed out")); }, timeout); }),
      ]);
      if (typeof data.version !== "string" || !data.version) throw new Error();
      publish({ latest: data.version, message: data.version === APP_VERSION ? "You’re up to date." : "A newer version is available. Refresh or close and reopen the app to load it. Your open game will not restart automatically." });
    } catch { publish({ message: "Could not check the deployed version. You can continue scoring; check again when connected." }); }
    finally { clearTimeout(timer); publish({ checking: false }); }
  })().finally(() => { pending = null; });
  return pending;
}

// Install the worker in the background. No activation handshake, score-state
// inspection, controllerchange reload, or network writes to scoring tables.
export function registerAutomaticUpdates() {
  if (!("serviceWorker" in navigator)) return () => {};
  let disposed = false, reg: ServiceWorkerRegistration | undefined;
  const clean = () => { try { reg?.active?.postMessage({ kind: "bnn-cleanup-shells", version: APP_VERSION }); } catch { /* retry on next focus */ } };
  const update = () => { if (disposed) return; void reg?.update().catch(() => {}); clean(); };
  const visible = () => { if (document.visibilityState === "visible") update(); };
  const message = (event: MessageEvent) => {
    if (event.data?.kind !== "notif-nav" || typeof event.data.link !== "string") return;
    try { const url = new URL(event.data.link, location.origin); if (url.origin === location.origin && url.pathname + url.search !== location.pathname + location.search) location.assign(url.pathname + url.search); } catch { /* malformed link */ }
  };
  void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(value => {
    if (disposed) return;
    reg = value; update();
  }).catch(() => { /* ordinary online/offline operation remains available */ });
  window.addEventListener("online", update); window.addEventListener("focus", update);
  document.addEventListener("visibilitychange", visible);
  navigator.serviceWorker.addEventListener("message", message);
  const interval = window.setInterval(update, 30 * 60 * 1000);
  return () => { disposed = true; clearInterval(interval); window.removeEventListener("online", update); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", visible); navigator.serviceWorker.removeEventListener("message", message); };
}
