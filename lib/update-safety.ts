"use client";

// A browser-wide interlock, independent of which screen is currently mounted.
// No expiry: a sleeping tab/offline round is not evidence that scoring finished.
import { scoringStorage, storageWriteFailed } from "./scoring-device";
import { loadActiveGame, loadDraft, personalDraftIsPending, rowPendingHoles } from "./draft";

export const UPDATE_SESSIONS = "bnn_update_sessions_v1";
export const UPDATE_EVENT = "bnn-update-safety";
type Session = { kind: "game" | "round"; id: string; label?: string; code?: string; revision?: string };
let storageFault = false;
let bootChecked = false;
let applying = false;
const mounted = new Set<string>();
const listeners = new Set<() => void>();
export function scoringEditorOpen() { return mounted.size > 0; }
export function emitSavedScoreVerification() { emit(); }
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
export function protectUpdateSession(kind: Session["kind"], id: string, blocked: boolean, label?: string, code?: string) {
  try {
    const key = `${UPDATE_SESSIONS}:${kind}:${id}`;
    if (blocked) {
      window.localStorage.setItem(key, JSON.stringify({ kind, id, label, code, revision: crypto.randomUUID() }));
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
export type UpdateBlocker = { key: string; title: string; action: string };
function gameDescription(id: string): string {
  const snap = JSON.parse(window.localStorage.getItem(`bnn_game_snap_${id}`) || "null");
  const info = snap?.game || JSON.parse(window.localStorage.getItem(`bnn_update_game_info_${id}`) || "null");
  return info?.name ? `${info.name}${info.code ? ` · #${info.code}` : ""}` : info?.code ? `Game #${info.code}` : `Saved game (${id.slice(0, 8)})`;
}
function roundDescription(id: string): string {
  const info = JSON.parse(window.localStorage.getItem(`bnn_update_round_info_${id}`) || "null");
  return info?.course ? `${info.course}${info.played_at ? ` · ${info.played_at.slice(0, 10)}` : ""}` : `Saved round (${id.slice(0, 8)})`;
}
export function rememberUpdateRound(id: string, info: { course?: string; played_at?: string }) {
  try { window.localStorage.setItem(`bnn_update_round_info_${id}`, JSON.stringify(info)); } catch { /* display metadata only */ }
}
export function rememberUpdateGame(id: string, info: { name?: string | null; code?: string | null }) {
  try { window.localStorage.setItem(`bnn_update_game_info_${id}`, JSON.stringify(info)); } catch { /* display metadata only; protection is unchanged */ }
}
export function updateBlockers(): UpdateBlocker[] {
  const reasons = new Map<string, UpdateBlocker>();
  const add = (key: string, title: string, action: string) => reasons.set(key, { key, title, action });
  if (typeof window === "undefined") return [{ key: "checking", title: "Checking saved rounds", action: "Wait for the app to check your saved scores." }];
  try {
    if (!bootChecked) add("checking", "Checking saved rounds", "Connect to the internet and choose Check again. No scores will be removed.");
    if (storageFault || storageWriteFailed()) add("storage", "A local score backup failed", "Keep the scorecard open, reconnect and retry saving. Verify your scores are synced before closing the app. Do not clear browser data to force an update.");
    const sessions = Object.values(updateSessions());
    for (const session of sessions) {
      const title = session.label ? `${session.label}${session.code ? ` · #${session.code}` : ""}` : (session.kind === "game" ? gameDescription(session.id) : roundDescription(session.id));
      add(`${session.kind}:${session.id}`, `${session.kind === "game" ? "Game not confirmed finished" : "Round or score edit still open"}: ${title}`, session.kind === "game" ? "Continue playing; the update can wait. After play, the organizer finishes the game. If it is already finished, reconnect and choose Check again." : "Open Rounds and resume this round or edit. Finish and save it, or discard it only if you no longer want those changes.");
    }
    if (mounted.size && !sessions.length) add("open-editor", "A scorecard or round editor is open", "Finish saving or cancel the edit, then return here.");
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i++) {
      const full = storage.key(i)!;
      const key = full.replace(/^bnn_device_scores:[^:]+:[^:]+:/, "");
      if (key.startsWith("bnn_game_scores_")) {
        const backup = JSON.parse(storage.getItem(full) || "null");
        const watermark = JSON.parse(storage.getItem(full.replace("bnn_game_scores_", "bnn_game_wm_")) || "null");
        if (!backup) throw new Error("Invalid score backup");
        const n = rowPendingHoles(backup, watermark);
        if (n > 0) {
          const rest = key.slice("bnn_game_scores_".length), id = rest.slice(0, rest.lastIndexOf("_"));
          const snap = JSON.parse(storage.getItem(`bnn_game_snap_${id}`) || "null");
          const player = snap?.players?.find((p: any) => p.id === rest.slice(rest.lastIndexOf("_") + 1));
          add(`pending:${full}`, `${gameDescription(id)}${player?.display_name ? ` · ${player.display_name}` : ""}: ${n} hole${n === 1 ? "" : "s"} with scores or stats not yet synced`, "Reconnect, open this game's scorecard and choose Sync now. If it is already ended, ask the organizer to reopen it for corrections first. If these scores belong to another BNN tab, sync from that tab; do not delete its saved data.");
        }
      } else if (key.startsWith("bnn:altshot-side-drafts:")) {
        const rows = JSON.parse(storage.getItem(full) || "null");
        if (!Array.isArray(rows)) throw new Error("Invalid team draft");
        if (rows.length) add(`pending:${full}`, `${gameDescription(key.slice("bnn:altshot-side-drafts:".length))}: ${rows.length} team score edit${rows.length === 1 ? "" : "s"} not yet synced`, "Reconnect and reopen this game's team scorecard. Wait until the saved scores sync; if the game is ended, ask the organizer to reopen it for correction.");
      } else if (key === "bnn_round_draft_v1") {
        const draft = JSON.parse(storage.getItem(full) || "null");
        if (draft?.round && (draft.round.status === "in_progress" || !draft.round.id)) {
          const round = draft.round, id = round.id || round.draft_session_id || full;
          add(`round:${id}`, `Unfinished round: ${round.course || "Personal round"}${round.played_at ? ` · ${round.played_at.slice(0, 10)}` : ""}`, "Open Rounds and resume this round. Finish and save it, or discard it only if it is unwanted. If it belongs to another open BNN tab, finish it there.");
        }
      } else if (key.startsWith("bnn_edit_round:")) {
        const edit = JSON.parse(storage.getItem(full) || "null"), round = edit?.data?.round;
        add(round?.id ? `round:${round.id}` : `edit:${full}`, `Unsaved round changes: ${round?.course || "Personal round"}${round?.played_at ? ` · ${round.played_at.slice(0, 10)}` : ""}`, "Return to this round's editor and save or cancel your changes.");
      }
    }
    const draft = loadDraft();
    if (draft && personalDraftIsPending(draft.round) && ![...reasons.keys()].some(key => key.startsWith("round:"))) add("round-pending", `Round not yet saved: ${draft.round.course || "Personal round"}`, "Open Rounds, resume this round and finish saving, or discard only if unwanted.");
    const active = loadActiveGame();
    if (active) {
      const snap = JSON.parse(scoringStorage().getItem(`bnn_game_snap_${active.gameId}`) || "null");
      if ((!snap?.game || snap.game.status !== "ended") && storage.getItem(`bnn_update_closed_${active.gameId}`) !== "1") add(`game:${active.gameId}`, `Game not confirmed finished: ${gameDescription(active.gameId)}`, "Continue playing. After the organizer finishes the game and scores sync, choose Check again. If game status cannot be checked, reconnect first.");
    }
  } catch { add("storage-read", "Saved-score data could not be checked", "Keep your saved data. Reconnect and reopen the relevant scorecard to recover it; do not clear browser storage to force an update."); }
  return [...reasons.values()];
}
export function updatesBlocked(): boolean { return updateBlockers().length > 0; }

export function updateInProgress() { return applying; }
export function holdUpdateInput() { applying = true; emit(); }
export function releaseUpdateInput() { applying = false; emit(); }

// Reconcile tracked games even after leaving their screen. An error/offline
// response never means "ended"; pending outboxes are checked separately above.
export async function reconcileUpdateGames(read: (id: string) => Promise<{ status?: string; missing?: boolean } | null>, readRound?: (id: string) => Promise<{ course?: string; played_at?: string } | null>) {
  try {
    const sessions = updateSessions();
    const active = loadActiveGame();
    if (active) sessions[`game:${active.gameId}`] = { kind: "game", id: active.gameId };
    let resolved = true;
    for (const session of Object.values(sessions)) {
      if (session.kind === "round") {
        const info = await readRound?.(session.id);
        if (info) rememberUpdateRound(session.id, info);
        continue;
      }
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
