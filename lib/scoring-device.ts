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
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };
export async function checkScoringDevice(client: Client, uid: string, takeover = false): Promise<void> {
  if (!uid || typeof window === "undefined") return;
  if (request) { await request; if (!takeover) return; }
  if (userId !== uid) {
    userId = uid; initialized = false; publish("checking");
    try { previous = window.sessionStorage.getItem(`bnn_primary_tab_${uid}`); } catch { previous = null; }
    // A fully closed mobile app may lose sessionStorage. Its known primary can
    // still reopen offline; server fencing applies on reconnection.
    if (!previous && navigator.onLine === false && owner()?.user === uid) previous = owner()!.token;
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
      if (!wasInitialized && !takeover) resumeBackups(previous);
      // A successful takeover starts from the current server scores. Old pending work
      // remains downloadable, but can never become an automatic stale outbox.
      if (takeover || (!previous && !wasInitialized) || (oldOwner?.user === uid && oldOwner.token !== token && oldOwner.token !== previous)) archiveScoringBackups(true);
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
