"use client";
import { APP_VERSION } from "./app-version";
import { updateBlockers, type UpdateBlocker, updatesBlocked, releaseUpdateInput, holdUpdateInput } from "./update-safety";

export type UpdateState = { phase: "idle" | "checking" | "preparing" | "blocked" | "reloading" | "failed" | "success"; message: string; latest: string; blockers: UpdateBlocker[]; dismissed: boolean };
const initial: UpdateState = { phase: "idle", message: "", latest: "", blockers: [], dismissed: false };
let state = initial;
const listeners = new Set<() => void>();
export const updateState = () => state;
export const serverUpdateState = () => initial;
export function subscribeAppUpdate(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function set(patch: Partial<UpdateState>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
const DISMISS = "bnn_update_dismissed_v1", ATTEMPT = "bnn_update_attempt_v1";
let hiddenVersion = "";
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
function dismissed(version: string) { try { return hiddenVersion === version || window.localStorage.getItem(DISMISS) === version; } catch { return hiddenVersion === version; } }
export function reportDeferredReload() {
  clearTimeout(reloadTimer);
  releaseUpdateInput();
  set({ phase: "blocked", message: "The new version is ready, but restarting is paused to protect your current scoring. Resolve the items below first.", blockers: updateBlockers(), dismissed: false });
}
export function dismissUpdate() {
  hiddenVersion = state.latest || APP_VERSION;
  try { window.localStorage.setItem(DISMISS, hiddenVersion); } catch { /* dismissal still works in this page */ }
  set({ dismissed: true });
}
export function restoreUpdateResult() {
  try {
    const target = window.sessionStorage.getItem(ATTEMPT);
    if (!target) return;
    window.sessionStorage.removeItem(ATTEMPT);
    clearTimeout(reloadTimer);
    set({ phase: target === APP_VERSION ? "success" : "failed", latest: target, dismissed: false, blockers: [], message: target === APP_VERSION ? `Updated successfully to ${APP_VERSION}.` : `The requested update did not complete. Installed version: ${APP_VERSION}. Check for updates and try again.` });
  } catch { /* status storage is optional; no unverified success is reported */ }
}
export function setUpdateAvailable(latest: string) {
  if (!latest) return;
  const changed = state.latest !== latest;
  set({ latest, ...(changed && (state.phase !== "success" || latest !== APP_VERSION) ? { phase: "idle" as const, message: "", blockers: [] } : {}), dismissed: state.phase === "success" && latest === APP_VERSION ? state.dismissed : dismissed(latest) });
}
function deadline<T>(promise: Promise<T>, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Update request timed out")), timeout);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
export async function checkForUpdate(manual = false, timeout = 7000) {
  if (["preparing", "reloading"].includes(state.phase)) return;
  if (manual) set({ phase: "checking", message: "Checking for updates…" });
  try {
    const res = await deadline(fetch(`/app-version.json?ts=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } }), timeout);
    if (!res.ok) throw new Error("Version check failed");
    const json = await deadline(res.json(), timeout), version = typeof json?.version === "string" ? json.version : "";
    if (!version) throw new Error("No version returned");
    setUpdateAvailable(version);
    if (manual) {
      const blockers = updateBlockers();
      set({ phase: blockers.length ? "blocked" : "idle", blockers, message: blockers.length ? "Updates are paused. Review the items below; your scores have not been changed." : version === APP_VERSION ? `You're on the latest version (${APP_VERSION}).` : `Version ${version} is available.` });
    }
  } catch {
    if (manual) set({ phase: "failed", message: "Could not check for updates. Check your connection and choose Check again.", blockers: [] });
  }
}
export type ActivationResult = { accepted: boolean; confirmed?: boolean; blockers?: UpdateBlocker[]; message?: string };
export function requestActivation(worker: ServiceWorker, timeout = 7000): Promise<ActivationResult> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (result: ActivationResult) => { clearTimeout(timer); channel.port1.close(); resolve(result); };
    const timer = setTimeout(() => finish({ accepted: false, confirmed: false, blockers: [], message: "The update could not be confirmed. Another BNN tab may be asleep or running an older version. Finish and sync any rounds there, close those BNN tabs/windows, then try again. Do not clear browser data." }), timeout);
    channel.port1.onmessage = e => {
      if (e.data?.kind !== "bnn-update-result" || typeof e.data.accepted !== "boolean") return;
      finish({ accepted: e.data.accepted, blockers: Array.isArray(e.data.blockers) ? e.data.blockers : [], message: e.data.message });
    };
    try { worker.postMessage("SKIP_WAITING", [channel.port2]); }
    catch { finish({ accepted: false, message: "Could not contact the downloaded update. Check your connection and try again." }); }
  });
}
function forgetAttempt() { try { window.sessionStorage.removeItem(ATTEMPT); } catch {} }
export async function applyAppUpdate(timeout = 10000) {
  if (["preparing", "reloading"].includes(state.phase)) return;
  const local = updateBlockers();
  if (local.length) { set({ phase: "blocked", blockers: local, message: "Update paused. Resolve the items below; your scores have not been changed.", dismissed: false }); return; }
  if (!state.latest || state.latest === APP_VERSION) { await checkForUpdate(true); return; }
  set({ phase: "preparing", message: "Checking that every open BNN tab is safe to update…", blockers: [], dismissed: false });
  try {
    if ("serviceWorker" in navigator) {
      const reg = await deadline(navigator.serviceWorker.getRegistration(), timeout);
      if (reg) {
        await deadline(reg.update(), timeout);
        // Wait for installation, but never navigate around a slow/failed worker.
        const end = Date.now() + 5000;
        while (!reg.waiting && reg.installing && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 100));
        if (!reg.waiting) throw new Error("The new version is not ready yet. Check your connection and choose Check again before retrying.");
        if (updatesBlocked()) { set({ phase: "blocked", blockers: updateBlockers(), message: "Update paused because scoring started while the update was downloading." }); return; }
        try { window.sessionStorage.setItem(ATTEMPT, state.latest); } catch {}
        const result = await requestActivation(reg.waiting, Math.min(timeout, 7000));
        if (!result.accepted) {
          if (result.confirmed !== false) forgetAttempt();
          releaseUpdateInput();
          set({ phase: result.blockers?.length ? "blocked" : "failed", message: result.message || "Update paused by another BNN tab. Review the items below.", blockers: result.blockers || [] });
          return;
        }
        set({ phase: "reloading", message: "The update is ready. Waiting for the app to restart…", blockers: [] });
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => { releaseUpdateInput(); set({ phase: "failed", message: "The browser did not finish switching versions. Finish and sync any rounds, close all BNN tabs/windows, then reopen the app. Your saved scores have not been removed." }); }, 12000);
        return;
      }
    }
    if (updatesBlocked()) { set({ phase: "blocked", blockers: updateBlockers(), message: "Update paused while scores are being saved." }); return; }
    try { window.sessionStorage.setItem(ATTEMPT, state.latest); } catch {}
    holdUpdateInput();
    set({ phase: "reloading", message: "Loading the new version…", blockers: [] });
    reloadTimer = setTimeout(() => { releaseUpdateInput(); set({ phase: "failed", message: "The app did not restart. Check your connection, then try again." }); }, 12000);
    window.location.reload();
  } catch (error) {
    forgetAttempt(); releaseUpdateInput();
    set({ phase: "failed", message: error instanceof Error && error.message.startsWith("The new version") ? error.message : "Could not download or activate the update. Check your connection and try again. Your scores have not been changed.", blockers: [] });
  }
}
