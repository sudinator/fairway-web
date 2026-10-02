"use client";

// One runtime token per tab. Resume rotates the previous token, fencing duplicate tabs.
// A known primary can work offline; the server always decides whether its writes land.
export type DeviceState = "checking" | "primary" | "viewer";
let deviceError = "";
export const scoringDeviceError = () => deviceError;
function setDeviceError(message: string) { deviceError = message; listeners.forEach(f => f()); }
let state: DeviceState = "checking";
let token = "";
let userId = "";
let previous: string | null = null;
let initialized = false;
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();
const OWNER_KEY = "bnn_primary_scoring_owner_v1";
const ARCHIVE_KEY = "bnn_scoring_recovery_v1";
export const subscribeScoringDevice = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const scoringDeviceState = () => state;
export const scoringDeviceToken = () => token;
export const isPrimaryScoringDevice = () => state === "primary";
function publish(next: DeviceState) { state = next; listeners.forEach(f => f()); }
function owner(): { user: string; token: string } | null {
  try { return JSON.parse(window.localStorage.getItem(OWNER_KEY) || "null"); } catch { return null; }
}
export function markScoringDeviceRevoked() { publish("viewer"); }
export function isDeviceRejection(error: { message?: string } | null | undefined) {
  return !!error?.message?.includes("Scoring is active on another device");
}
function scoreKey(key: string) {
  return key === "bnn_round_draft_v1" || key === "bnn_round_sync_v1" || key === "bnn_draft_hole_v1" ||
    key.startsWith("bnn_edit_round:") || key.startsWith("bnn_game_scores_") || key.startsWith("bnn_game_wm_") ||
    key.startsWith("bnn:altshot-side-drafts:");
}
const PREFIX = "bnn_device_scores:";
function pendingKey(key: string) { return scoreKey(key) ? `${PREFIX}${userId}:${token}:${key}` : key; }
// Pending work is isolated by runtime token. An old tab cannot contaminate the new
// primary tab's outbox through shared localStorage. Snapshots/preferences remain shared.
export function scoringStorage(): Storage {
  const storage = window.localStorage;
  const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter(k =>
    !k.startsWith(PREFIX) || k.startsWith(`${PREFIX}${userId}:${token}:`)).map(k => k.startsWith(PREFIX) ? k.slice(`${PREFIX}${userId}:${token}:`.length) : k);
  return {
    get length() { return keys().length; },
    key: i => keys()[i] ?? null,
    getItem: key => storage.getItem(pendingKey(key)),
    setItem: (key, value) => storage.setItem(pendingKey(key), value),
    removeItem: key => storage.removeItem(pendingKey(key)),
    clear: () => keys().forEach(key => storage.removeItem(pendingKey(key))),
  };
}
function resumeBackups(oldToken: string | null) {
  if (!oldToken || oldToken === token) return;
  const storage = window.localStorage, oldPrefix = `${PREFIX}${userId}:${oldToken}:`;
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter(k => k.startsWith(oldPrefix));
  for (const key of keys) storage.setItem(`${PREFIX}${userId}:${token}:${key.slice(oldPrefix.length)}`, storage.getItem(key)!);
}
export function archiveScoringBackups(clear = false) {
  // Saving the archive must succeed before removing any working backup.
  const storage = window.localStorage, data: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)!;
    if (scoreKey(key) || key.startsWith(`${PREFIX}${userId}:`)) data[key] = storage.getItem(key)!;
  }
  if (Object.keys(data).length) {
    const archives = JSON.parse(storage.getItem(ARCHIVE_KEY) || "[]");
    archives.push({ user: userId, at: new Date().toISOString(), data });
    storage.setItem(ARCHIVE_KEY, JSON.stringify(archives));
    if (clear) Object.keys(data).filter(k => !k.startsWith(PREFIX) || k.startsWith(`${PREFIX}${userId}:${token}:`)).forEach(k => storage.removeItem(k));
  }
}
export function downloadScoringRecovery() {
  archiveScoringBackups();
  const blob = new Blob([window.localStorage.getItem(ARCHIVE_KEY) || "[]"], { type: "application/json" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = "BNN-saved-scores.json"; a.click(); URL.revokeObjectURL(url);
}
// Same-browser liveness. Two tabs of one browser share localStorage, so the owner token alone
// cannot tell "the app was relaunched" from "a second tab was opened". A primary tab answers pings
// on a per-user channel; a tab that gets an answer carrying the owner's token is a duplicate.
const CHANNEL = (uid: string) => `bnn_scoring_device_${uid}`;
let siblings: BroadcastChannel | null = null;
function listenForSiblings(uid: string) {
  if (typeof BroadcastChannel === "undefined") return;
  siblings?.close();
  siblings = new BroadcastChannel(CHANNEL(uid));
  (siblings as unknown as { unref?: () => void }).unref?.();
  siblings.onmessage = (e: MessageEvent) => {
    if (e.data?.type === "ping" && state === "primary") siblings?.postMessage({ type: "alive", token });
  };
}
function liveSiblingTab(uid: string, ownerToken: string): Promise<boolean> {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const ch = new BroadcastChannel(CHANNEL(uid));
    (ch as unknown as { unref?: () => void }).unref?.();
    const done = (alive: boolean) => { clearTimeout(timer); ch.close(); resolve(alive); };
    const timer = setTimeout(() => done(false), 250);
    ch.onmessage = (e: MessageEvent) => { if (e.data?.type === "alive" && e.data.token === ownerToken) done(true); };
    ch.postMessage({ type: "ping" });
  });
}
// Test and teardown hook: a runtime that will no longer answer pings (the tab is closing).
export function releaseScoringDeviceRuntime() { siblings?.close(); siblings = null; }
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };
export async function checkScoringDevice(client: Client, uid: string, takeover = false): Promise<void> {
  if (!uid || typeof window === "undefined") return;
  if (request) { await request; if (!takeover) return; }
  if (userId !== uid) {
    userId = uid; initialized = false; publish("checking");
    try { previous = window.sessionStorage.getItem(`bnn_primary_tab_${uid}`); } catch { previous = null; }
    // A fully closed mobile app loses sessionStorage (iOS discards it for a standalone PWA on
    // every cold launch). The installation's identity survives in localStorage: the token of its
    // last successful claim. Present that as the previous token ONLINE as well as offline, so the
    // same phone reopening resumes silently instead of asking "make this device primary?" on
    // every launch. The server still decides: it resumes only if that token is the one it holds,
    // so a different device - whose localStorage holds a different or no token - still sees the
    // prompt. Before 193.3 this was offline-only and every relaunch presented as a second device.
    // ...unless the previous runtime is still ALIVE in another tab of this same browser. Then this
    // is a duplicate tab, not a relaunch: it stays a viewer and the open tab keeps scoring. A live
    // tab answers a BroadcastChannel ping within 250ms; a killed app cannot.
    if (!previous && owner()?.user === uid && !(await liveSiblingTab(uid, owner()!.token))) previous = owner()!.token;
    listenForSiblings(uid);
    token = navigator.onLine === false && previous ? previous : crypto.randomUUID();
  }
  if (navigator.onLine === false) {
    if (!initialized && previous && owner()?.user === uid && owner()?.token === token) publish("primary");
    return;
  }
  if (!initialized && token === previous) token = crypto.randomUUID();
  request = (async () => {
    try {
      const resumeToken = takeover && owner()?.user === uid ? owner()!.token : previous;
      const { data, error } = await client.rpc("claim_scoring_device", {
        p_token: token, p_previous: takeover ? resumeToken : initialized ? null : previous, p_takeover: takeover,
      });
      if (error || !data) { setDeviceError("Could not confirm your primary device. Your saved scores are still available; reconnect and try again."); return; } // Never interpret a failed read as a transfer.
      setDeviceError("");
      const wasInitialized = initialized;
      initialized = true;
      if (!data.active) { publish("viewer"); return; }
      const oldOwner = owner();
      // The server superseded a holder that had been silent for its idle window (0166). This device
      // did not resume anything; it starts from the server's scores like a takeover, so any outbox
      // it kept from an earlier session is archived, never replayed.
      const superseded = data.superseded === true;
      if (!wasInitialized && !takeover && !superseded) resumeBackups(previous);
      // A successful takeover starts from the current server scores. Old pending work
      // remains downloadable, but can never become an automatic stale outbox.
      if (takeover || superseded || (!previous && !wasInitialized) || (oldOwner?.user === uid && oldOwner.token !== token && oldOwner.token !== previous)) archiveScoringBackups(true);
      // Explicitly resuming this same installation's still-current server token
      // recovers its own pending mobile work. A transfer from a different device
      // never replays the old local outbox.
      if (takeover && data.resumed === true) resumeBackups(resumeToken);
      window.sessionStorage.setItem(`bnn_primary_tab_${uid}`, token);
      window.localStorage.setItem(OWNER_KEY, JSON.stringify({ user: uid, token }));
      publish("primary");
      if (takeover) window.location.reload();
    } catch { setDeviceError("Could not change or restore this scoring device. Saved scores were retained; reconnect and try again."); }
  })();
  try { await request; } finally { request = null; }
}
