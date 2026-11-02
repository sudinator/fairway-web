"use client";
import { APP_VERSION } from "./app-version";
export type AutomaticUpdateState = { latest: string; checking: boolean; message: string; updating: boolean; notice: string; completed: boolean };
const initial: AutomaticUpdateState = { latest: "", checking: false, message: "", updating: false, notice: "", completed: false };
let state = initial;
const listeners = new Set<() => void>();
export const automaticUpdateState = () => state;
export const serverAutomaticUpdateState = () => initial;
export const subscribeAutomaticUpdates = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function publish(patch: Partial<AutomaticUpdateState>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
const validVersion = (v: unknown): v is string => typeof v === "string" && /^\d+\.\d+\.\d{6}$/.test(v);
export function newerVersion(candidate: string, current = APP_VERSION) {
  if (!validVersion(candidate) || !validVersion(current)) return false;
  const a = candidate.split(".").map(Number), b = current.split(".").map(Number);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, timeout: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Request timed out")); }, timeout); })]); }
  finally { clearTimeout(timer); }
}
async function deployedVersion(timeout: number) {
  return bounded(async signal => {
    const response = await fetch(`/app-version.json?ts=${Date.now()}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error("Version unavailable");
    const data = await response.json();
    if (!validVersion(data?.version)) throw new Error("Invalid version");
    return data.version as string;
  }, timeout);
}
let pending: Promise<void> | null = null;
export function checkAutomaticVersion(timeout = 7000): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    publish({ checking: true });
    try {
      const latest = await deployedVersion(timeout);
      publish({ latest, ...(!newerVersion(latest) && !state.updating && !state.completed ? { notice: "" } : {}), message: newerVersion(latest) ? `Version ${latest} is available. Tap Update now when you are ready to reload.` : latest === APP_VERSION ? "You’re up to date." : `This device is on ${APP_VERSION}; the server reports ${latest}. No older version will be requested.` });
    } catch { publish({ message: "Could not check the deployed version. You can continue scoring; check again when connected." }); }
    finally { publish({ checking: false }); }
  })().finally(() => { pending = null; });
  return pending;
}
// Only a confirmed result may expire. A pending release is never hidden.
export function clearConfirmedUpdateNotice() {
  if (state.completed && !state.updating && !newerVersion(state.latest)) publish({ notice: "", completed: false });
}
let applying: Promise<void> | null = null;
let navigationTimer: ReturnType<typeof setTimeout> | undefined;
async function activateDownloadedWorker(timeout: number) {
  if (!("serviceWorker" in navigator)) return;
  await bounded(async signal => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || signal.aborted) return;
    await reg.update();
    if (signal.aborted) throw new Error("Update timed out");
    const worker = reg.installing || reg.waiting;
    if (!worker) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { worker.removeEventListener("statechange", changed); signal.removeEventListener("abort", aborted); };
      const aborted = () => { cleanup(); reject(new Error("Update timed out")); };
      const changed = () => {
        if (worker.state === "installed") worker.postMessage("SKIP_WAITING");
        if (worker.state === "activated" || worker.state === "redundant") {
          cleanup();
          if (worker.state === "redundant") reject(new Error("Update installation failed")); else resolve();
        }
      };
      worker.addEventListener("statechange", changed); signal.addEventListener("abort", aborted, { once: true }); changed();
    });
  }, timeout);
}
// Explicit user action only: no score inspection, writes, deletion or automatic reload.
export function requestAppUpdate(timeout = 12000, navigate: (url: string) => void = url => window.location.assign(url)): Promise<void> {
  if (applying) return applying;
  if (state.updating) return Promise.resolve();
  applying = (async () => {
    publish({ updating: true, completed: false, notice: "Checking the connection and downloading the update…" });
    try {
      const latest = await deployedVersion(timeout);
      publish({ latest });
      if (!newerVersion(latest)) { publish({ updating: false, completed: true, notice: latest === APP_VERSION ? `You’re up to date: ${APP_VERSION}.` : `The server reports ${latest}. This device remains on ${APP_VERSION}; no older version was requested.` }); return; }
      await activateDownloadedWorker(timeout);
      const url = new URL(window.location.href);
      url.searchParams.set("bnnUpdate", latest);
      url.searchParams.set("bnnUpdateAt", String(Date.now()));
      // A fallback copy survives a worker's offline-root fallback. It contains no scores.
      try { sessionStorage.setItem("bnn-update-attempt", latest); } catch { /* URL also carries the target */ }
      publish({ notice: `Loading version ${latest}…` });
      navigate(url.href);
      navigationTimer = setTimeout(() => publish({ updating: false, notice: `The app did not restart. You are still on ${APP_VERSION}. Check your connection and retry Update now.` }), timeout);
    } catch { publish({ updating: false, notice: `Update could not finish. You are still on ${APP_VERSION}. Check your connection and retry Update now. Saved scores and drafts have not been removed.` }); }
  })().finally(() => { applying = null; });
  return applying;
}
function restoreUpdateResult() {
  const url = new URL(window.location.href);
  let target = url.searchParams.get("bnnUpdate");
  try { target ||= sessionStorage.getItem("bnn-update-attempt"); sessionStorage.removeItem("bnn-update-attempt"); } catch { /* URL result still works */ }
  if (url.searchParams.has("bnnUpdate")) { url.searchParams.delete("bnnUpdate"); url.searchParams.delete("bnnUpdateAt"); window.history.replaceState(window.history.state, "", url.href); }
  if (!validVersion(target)) return;
  publish({ completed: !newerVersion(target), notice: !newerVersion(target) ? `Updated successfully. You’re on version ${APP_VERSION}.` : `Update did not complete: this device is still on ${APP_VERSION}; requested ${target}. Reconnect and retry Update now.`, updating: false });
}
// Background download waits for explicit activation. The banner offers an
// explicit fresh navigation; unfinished rounds are not an installation gate.
export function registerAutomaticUpdates() {
  restoreUpdateResult();
  let disposed = false, reg: ServiceWorkerRegistration | undefined;
  const clean = () => { try { reg?.active?.postMessage({ kind: "bnn-cleanup-shells", version: APP_VERSION }); } catch { /* retry on next focus */ } };
  const update = () => { if (disposed) return; void reg?.update().catch(() => {}); void checkAutomaticVersion(); clean(); };
  const visible = () => { if (document.visibilityState === "visible") update(); };
  const message = (event: MessageEvent) => {
    if (event.data?.kind !== "notif-nav" || typeof event.data.link !== "string") return;
    try { const url = new URL(event.data.link, window.location.origin); if (url.origin === window.location.origin && url.pathname + url.search !== window.location.pathname + window.location.search) window.location.assign(url.pathname + url.search); } catch { /* malformed link */ }
  };
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(value => { if (!disposed) { reg = value; void reg.update().catch(() => {}); clean(); } }).catch(() => { /* explicit navigation remains available */ });
    navigator.serviceWorker.addEventListener("message", message);
  }
  void checkAutomaticVersion();
  window.addEventListener("online", update); window.addEventListener("focus", update);
  document.addEventListener("visibilitychange", visible);
  const interval = window.setInterval(update, 30 * 60 * 1000);
  return () => { disposed = true; clearTimeout(navigationTimer); clearInterval(interval); window.removeEventListener("online", update); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", visible); if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", message); };
}
