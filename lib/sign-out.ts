"use client";
/**
 * Sign-out that cannot lose scores (212.130). Before this, both Sign out buttons removed EVERY bnn_* key — the other
 * identities' score outboxes and the recovery archive included — and did so before the sign-out call was awaited, so a
 * sign-out that failed (offline: the global scope returns an error and keeps the session) had already deleted the
 * phone's unsynced scores. Now:
 *   1. the phone is scanned for unsynced work (any identity, any runtime token) — if any, the member is told what it
 *      is and must choose Sign out anyway;
 *   2. the sign-out is awaited; an error leaves the phone exactly as it was;
 *   3. only then: the signed-out member's pending work is archived (bnn_scoring_recovery_v1, which sign-out never
 *      removes) and local state is cleared, scoped to that identity — another identity's outbox and the archive stay
 *      (ci: lib/sign-out.test.ts; ci/check_sign_out_contract.py keeps both buttons on this path).
 */
import { rowPendingHoles, draftHasScores, personalRoundFingerprint } from "./draft";
import { archiveScoringBackups, SCORING_ARCHIVE_KEY, SCORING_OWNER_KEY } from "./scoring-device";
import { resetPhoneDiagnostics } from "./phone-diagnostics";

export type UnsyncedItem = { key: string; label: string };
const OUTBOX = /^bnn_device_scores:([^:]*):([^:]*):/;
function parse(storage: Storage, key: string): any { try { return JSON.parse(storage.getItem(key) || "null"); } catch { return null; } }
function gameLabel(storage: Storage, gameId: string): string {
  const info = parse(storage, `bnn_game_snap_${gameId}`)?.game || parse(storage, `bnn_update_game_info_${gameId}`);
  return info?.name ? `${info.name}${info.code ? ` · #${info.code}` : ""}` : info?.code ? `Game #${info.code}` : "a club game";
}
/** Work that exists only on this phone: scores entered but not confirmed by the server, under any identity. */
export function unsyncedWork(storage: Storage = window.localStorage): UnsyncedItem[] {
  const items: UnsyncedItem[] = [];
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!);
  for (const full of keys) {
    const key = full.replace(OUTBOX, ""), prefix = full.slice(0, full.length - key.length);
    try {
      if (key.startsWith("bnn_game_scores_")) {
        const backup = parse(storage, full), wm = parse(storage, `${prefix}${key.replace("bnn_game_scores_", "bnn_game_wm_")}`);
        const n = backup ? rowPendingHoles(backup, wm) : 0;
        if (n > 0) {
          const rest = key.slice("bnn_game_scores_".length), id = rest.slice(0, rest.lastIndexOf("_"));
          const player = parse(storage, `bnn_game_snap_${id}`)?.players?.find((p: any) => p.id === rest.slice(rest.lastIndexOf("_") + 1));
          items.push({ key: full, label: `${gameLabel(storage, id)}${player?.display_name ? ` · ${player.display_name}` : ""}: ${n} hole${n === 1 ? "" : "s"} not yet synced` });
        }
      } else if (key.startsWith("bnn:altshot-side-drafts:")) {
        const rows = parse(storage, full);
        if (Array.isArray(rows) && rows.length) items.push({ key: full, label: `${gameLabel(storage, key.slice("bnn:altshot-side-drafts:".length))}: ${rows.length} team score edit${rows.length === 1 ? "" : "s"} not yet synced` });
      } else if (key === "bnn_round_draft_v1") {
        const round = parse(storage, full)?.round;
        if (round && draftHasScores(round)) {
          const ack = parse(storage, `${prefix}bnn_round_sync_v1`);
          if (!ack || ack.id !== (round.id || round.draft_session_id) || ack.signature !== personalRoundFingerprint(round))
            items.push({ key: full, label: `Round at ${round.course || "a course"}${round.played_at ? ` · ${String(round.played_at).slice(0, 10)}` : ""}: scores not yet saved` });
        }
      } else if (key.startsWith("bnn_edit_round:")) {
        const round = parse(storage, full)?.data?.round;
        items.push({ key: full, label: `Round at ${round?.course || "a course"}${round?.played_at ? ` · ${String(round.played_at).slice(0, 10)}` : ""}: unsaved edits` });
      }
    } catch { items.push({ key: full, label: "Saved scores that could not be read" }); }
  }
  return items;
}

/**
 * Remove the signed-out identity's local state. Kept: the recovery archive, and the score outboxes of OTHER identities
 * (a shared phone, or a member who signed in with a second Google account before the accounts were merged).
 */
export function clearLocalStateForSignOut(userId: string, storage: Storage = window.localStorage): string[] {
  const removed: string[] = [];
  try {
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!);
    for (const key of keys) {
      if (!(key.startsWith("bnn_") || key.startsWith("bnn-") || key.startsWith("bnn:"))) continue;
      if (key === SCORING_ARCHIVE_KEY) continue;
      const m = OUTBOX.exec(key);
      if (m && m[1] && m[1] !== userId) continue;
      if (key === SCORING_OWNER_KEY) { const owner = parse(storage, key); if (owner?.user && owner.user !== userId) continue; }
      storage.removeItem(key); removed.push(key);
    }
    const session = window.sessionStorage;
    const sessionKeys = Array.from({ length: session.length }, (_, i) => session.key(i)!);
    for (const key of sessionKeys) if (key.startsWith("bnn_primary_")) session.removeItem(key);
  } catch { /* storage unavailable: nothing to clear */ }
  return removed;
}

type Deps = {
  signOut: () => Promise<{ error: { message?: string } | null }>;
  confirm: (q: { title: string; message: string; confirmLabel: string; danger: boolean }) => Promise<boolean>;
  notify: (message: string) => void;
  storage?: Storage;
};
/** The one sign-out flow (Profile and the paused-account screen). Returns true once signed out and cleared. */
export async function signOutSafely(userId: string, deps: Deps): Promise<boolean> {
  const storage = deps.storage ?? window.localStorage;
  const pending = unsyncedWork(storage);
  if (pending.length) {
    const list = pending.slice(0, 4).map((p) => `• ${p.label}`).join("\n") + (pending.length > 4 ? `\n• and ${pending.length - 4} more` : "");
    const go = await deps.confirm({
      title: "Scores on this phone haven’t synced",
      message: `${list}\n\nReconnect and open that scorecard to sync first. If you sign out now the app will not resume them; a recovery copy stays on this phone.`,
      confirmLabel: "Sign out anyway", danger: true,
    });
    if (!go) return false;
  }
  let error: { message?: string } | null = null;
  try { error = (await deps.signOut()).error; } catch (e) { error = e instanceof Error ? e : { message: String(e) }; }
  if (error) { deps.notify(`Couldn’t sign out${error.message ? ` (${error.message})` : ""}. Nothing on this phone was removed; check the connection and try again.`); return false; }
  // Signed out. Archive the pending work BEFORE anything is removed (the archive key itself is never removed).
  if (pending.length) { try { archiveScoringBackups(false, userId); } catch { /* best-effort: the member chose to sign out anyway */ } }
  resetPhoneDiagnostics();
  clearLocalStateForSignOut(userId, storage);
  return true;
}
