"use client";

// A browser-wide interlock, independent of which screen is currently mounted.
// No expiry: a sleeping tab/offline round is not evidence that scoring finished.
import { scoringStorage, storageWriteFailed } from "./scoring-device";
import { loadActiveGame, loadDraft, personalDraftIsPending, rowPendingHoles } from "./draft";

export const UPDATE_SESSIONS = "bnn_update_sessions_v1";
export const UPDATE_EVENT = "bnn-update-safety";
type Session = { kind: "game" | "round"; id: string; revision?: string };
let storageFault = false;
let bootChecked = false;
let applying = false;
const mounted = new Set<string>();
const listeners = new Set<() => void>();
export function subscribeUpdateSafety(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function emit() { listeners.forEach(fn => fn()); if (typeof window !== "undefined") window.dispatchEvent(new Event(UPDATE_EVENT)); }
export function updateSessions(): Record<string, Session> {
  const data: Record<string, Session> = {};
  const storage = window.localStorage;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)!;
    if (!key.startsWith(UPDATE_SESSIONS + ":")) continue;
    const session = JSON.parse(storage.getItem(key) || "null");
    if (!session || !["game", "round"].includes(session.kind) || typeof session.id !== "string") throw new Error("Invalid update protection state");
    data[key] = session;
  }
  return data;
}
export function protectUpdateSession(kind: Session["kind"], id: string, blocked: boolean) {
  try {
    const key = `${UPDATE_SESSIONS}:${kind}:${id}`;
    if (blocked) {
      window.localStorage.setItem(key, JSON.stringify({ kind, id, revision: crypto.randomUUID() }));
      if (kind === "game") window.localStorage.removeItem(`bnn_update_closed_${id}`);
    } else {
      window.localStorage.removeItem(key);
      if (kind === "game") window.localStorage.setItem(`bnn_update_closed_${id}`, "1");
    }
  } catch { storageFault = true; }
  emit();
}
export function mountUpdateProtection(key: string) { mounted.add(key); emit(); return () => { mounted.delete(key); emit(); }; }
// Scan all device-token outboxes: a viewer tab cannot see another tab's scoped
// scoringStorage, but must still respect that tab's pending scores.
export function pendingUpdateScores(storage: Storage): boolean {
  for (let i = 0; i < storage.length; i++) {
    const fullKey = storage.key(i)!;
    const key = fullKey.replace(/^bnn_device_scores:[^:]+:[^:]+:/, "");
    if (key.startsWith("bnn_game_scores_")) {
      const backup = JSON.parse(storage.getItem(fullKey) || "null");
      const watermarkKey = fullKey.replace("bnn_game_scores_", "bnn_game_wm_");
      const watermark = JSON.parse(storage.getItem(watermarkKey) || "null");
      if (!backup || rowPendingHoles(backup, watermark) > 0) return true;
    }
    if (key.startsWith("bnn:altshot-side-drafts:")) {
      const drafts = JSON.parse(storage.getItem(fullKey) || "null");
      if (!Array.isArray(drafts) || drafts.length > 0) return true;
    }
    if (key === "bnn_round_draft_v1") {
      const draft = JSON.parse(storage.getItem(fullKey) || "null");
      // A synced in-progress round is still being played.
      if (draft?.round && (draft.round.status === "in_progress" || !draft.round.id)) return true;
    }
    if (key.startsWith("bnn_edit_round:")) return true;
  }
  return false;
}
export function updatesBlocked(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (!bootChecked || storageFault || storageWriteFailed() || mounted.size > 0) return true;
    if (Object.keys(updateSessions()).length > 0 || pendingUpdateScores(window.localStorage)) return true;
    const draft = loadDraft();
    if (draft && personalDraftIsPending(draft.round)) return true;
    // Bootstrap from pre-interlock releases before the game room has restored.
    const active = loadActiveGame();
    if (active) {
      const snap = JSON.parse(scoringStorage().getItem(`bnn_game_snap_${active.gameId}`) || "null");
      if ((!snap?.game || snap.game.status !== "ended") && window.localStorage.getItem(`bnn_update_closed_${active.gameId}`) !== "1") return true;
    }
    return false;
  } catch { return true; }
}
export function updateInProgress() { return applying; }
export function holdUpdateInput() { applying = true; emit(); }
export function releaseUpdateInput() { applying = false; emit(); }

// Reconcile tracked games even after leaving their screen. An error/offline
// response never means "ended"; pending outboxes are checked separately above.
export async function reconcileUpdateGames(read: (id: string) => Promise<{ status?: string; missing?: boolean } | null>) {
  try {
    const sessions = updateSessions();
    const active = loadActiveGame();
    if (active) sessions[`game:${active.gameId}`] = { kind: "game", id: active.gameId };
    let resolved = true;
    for (const session of Object.values(sessions)) {
      if (session.kind !== "game") continue;
      const key = `${UPDATE_SESSIONS}:game:${session.id}`;
      const before = window.localStorage.getItem(key);
      const result = await read(session.id);
      if (!result?.status) resolved = false;
      // A round may have reopened while this bounded read was in flight.
      if (result?.status === "ended" && window.localStorage.getItem(key) === before) {
        protectUpdateSession("game", session.id, false);
      }
    }
    if (resolved) { bootChecked = true; emit(); }
  } catch { /* fail closed until a later successful read */ }
}
