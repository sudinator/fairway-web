"use client";
/**
 * Sign-out that cannot lose scores (212.130). Before this, both Sign out buttons removed EVERY bnn_* key — the other
 * identities' score outboxes and the recovery archive included — and did so before the sign-out call was awaited, so a
 * sign-out that failed (offline: the global scope returns an error and keeps the session) had already deleted the
 * phone's unsynced scores. Now:
 *   1. the phone is scanned for unsynced work (any identity, any runtime token) — if any, the member is told what it
 *      is and must choose Sign out anyway;
 *   2. the member's pending work is archived (bnn_scoring_recovery_v1, which sign-out never removes) BEFORE the sign-out
 *      call, while the app's own sheet is still on screen to say so if it cannot be: on a full phone a second question
 *      explains that the scores stay on the phone instead;
 *   3. the sign-out is awaited; an error leaves the phone exactly as it was (the archive written in step 2 is put back
 *      as it was, so repeated failed attempts never push earlier recovery entries out of the capped archive);
 *   4. only then is local state cleared, scoped to that identity — another identity's outbox, an outbox saved before
 *      the identity was known, the scoring archive and the "Recovery copies" of the saved-score verification
 *      (bnn_verified_score_recovery:*) all stay; when the archive could not be written the member's own outbox and
 *      device-owner marker stay too, so the next online sign-in on this phone can resume them
 *      (ci: lib/sign-out.test.ts; ci/check_sign_out_contract.py keeps both buttons on this path).
 * 212.132: the four corrections above came from the independent review of 212.130 (docs/REVIEW_BRIEF.md).
 */
import { rowPendingHoles, pendingHoleNumbers, draftHasScores, personalRoundFingerprint } from "./draft";
import { archiveScoringBackups, isScoreKey, SCORING_ARCHIVE_KEY, SCORING_OWNER_KEY } from "./scoring-device";
import { resetPhoneDiagnostics } from "./phone-diagnostics";
import { RECOVERY_PREFIX } from "./saved-score-verification";
import { DEVICE_ID_KEY } from "./device-identity";

export type UnsyncedItem = { key: string; label: string; /** the outbox identity the item belongs to ("" = saved before the identity was known) */ owner: string; /** the game to open, when the item belongs to one (212.134: the Profile notice is tappable) */ gameId?: string; /** the holes that differ from the server's copy (1-based), for a game score */ holes?: number[] };
const OUTBOX = /^bnn_device_scores:([^:]*):([^:]*):/;
function parse(storage: Storage, key: string): any { try { return JSON.parse(storage.getItem(key) || "null"); } catch { return null; } }
function gameLabel(storage: Storage, gameId: string): string {
  const info = parse(storage, `bnn_game_snap_${gameId}`)?.game || parse(storage, `bnn_update_game_info_${gameId}`);
  return info?.name ? `${info.name}${info.code ? ` · #${info.code}` : ""}` : info?.code ? `Game #${info.code}` : "a club game";
}
/** Work that exists only on this phone: scores entered but not confirmed by the server, under any identity. An unprefixed
 *  (pre-outbox) score key belongs to `currentUser`, the member signed in on this phone. */
export function unsyncedWork(storage: Storage = window.localStorage, currentUser = ""): UnsyncedItem[] {
  const items: UnsyncedItem[] = [];
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!);
  for (const full of keys) {
    const key = full.replace(OUTBOX, ""), prefix = full.slice(0, full.length - key.length);
    const m = OUTBOX.exec(full);
    const owner = m ? m[1] : currentUser;   // an unprefixed score key predates the outboxes: it is this phone's current member's
    try {
      if (key.startsWith("bnn_game_scores_")) {
        const backup = parse(storage, full), wm = parse(storage, `${prefix}${key.replace("bnn_game_scores_", "bnn_game_wm_")}`);
        const n = backup ? rowPendingHoles(backup, wm) : 0;
        if (n > 0) {
          const rest = key.slice("bnn_game_scores_".length), id = rest.slice(0, rest.lastIndexOf("_"));
          const player = parse(storage, `bnn_game_snap_${id}`)?.players?.find((p: any) => p.id === rest.slice(rest.lastIndexOf("_") + 1));
          items.push({ key: full, owner, gameId: id, holes: pendingHoleNumbers(backup, wm), label: `${gameLabel(storage, id)}${player?.display_name ? ` · ${player.display_name}` : ""}: ${n} hole${n === 1 ? "" : "s"} not yet synced` });
        }
      } else if (key.startsWith("bnn:altshot-side-drafts:")) {
        const rows = parse(storage, full);
        if (Array.isArray(rows) && rows.length) items.push({ key: full, owner, gameId: key.slice("bnn:altshot-side-drafts:".length), label: `${gameLabel(storage, key.slice("bnn:altshot-side-drafts:".length))}: ${rows.length} team score edit${rows.length === 1 ? "" : "s"} not yet synced` });
      } else if (key === "bnn_round_draft_v1") {
        const round = parse(storage, full)?.round;
        if (round && draftHasScores(round)) {
          const ack = parse(storage, `${prefix}bnn_round_sync_v1`);
          if (!ack || ack.id !== (round.id || round.draft_session_id) || ack.signature !== personalRoundFingerprint(round))
            items.push({ key: full, owner, label: `Round at ${round.course || "a course"}${round.played_at ? ` · ${String(round.played_at).slice(0, 10)}` : ""}: scores not yet saved` });
        }
      } else if (key.startsWith("bnn_edit_round:")) {
        const round = parse(storage, full)?.data?.round;
        items.push({ key: full, owner, label: `Round at ${round?.course || "a course"}${round?.played_at ? ` · ${String(round.played_at).slice(0, 10)}` : ""}: unsaved edits` });
      }
    } catch { items.push({ key: full, owner, label: "Saved scores that could not be read" }); }
  }
  return items;
}

export type GameState = { id: string; status: string | null };
export type RetiredItem = { item: UnsyncedItem; reason: "deleted" | "ended" };
/**
 * 212.135 (owner decision: automatic). An entry for a game the server no longer has, or has ENDED, can never sync:
 * the room refuses scores for an ended game and a deleted one has nowhere to go. Such entries sat in the Profile notice
 * for weeks (staging games 341750, ended Oct 28; 610175, deleted Nov 27) and held up sign-out. `states` is the server's
 * answer for the items' games (rpc games_states — only games the member plays in are returned, so a game that is
 * missing from the answer is one the server has no row for). Items without a game (round drafts) are always live.
 */
export function splitRetired(items: UnsyncedItem[], states: GameState[]): { live: UnsyncedItem[]; retired: RetiredItem[] } {
  const byId = new Map(states.map((s) => [s.id, s.status]));
  const live: UnsyncedItem[] = [], retired: RetiredItem[] = [];
  for (const item of items) {
    if (!item.gameId) { live.push(item); continue; }
    if (!byId.has(item.gameId)) retired.push({ item, reason: "deleted" });   // 'not_member' (exists, member removed) stays live
    else if (byId.get(item.gameId) === "ended") retired.push({ item, reason: "ended" });
    else live.push(item);
  }
  return { live, retired };
}
/**
 * Archive once (a recovery copy stays on the phone), then remove the retired entries and their sync watermarks; a
 * deleted game's snapshot goes too, so it can no longer be opened from this phone. Returns the keys removed.
 */
export function retireItems(retired: RetiredItem[], userId: string, storage: Storage = window.localStorage): { removed: string[]; archived: boolean } {
  if (!retired.length) return { removed: [], archived: true };
  let archived = true;
  try { archiveScoringBackups(false, userId); } catch { archived = false; }   // a full phone: the entries are unsyncable either way
  const removed: string[] = [];
  const drop = (key: string) => { if (storage.getItem(key) != null) { storage.removeItem(key); removed.push(key); } };
  for (const { item, reason } of retired) {
    drop(item.key);
    const m = OUTBOX.exec(item.key), prefix = m ? m[0] : "", key = item.key.slice(prefix.length);
    if (key.startsWith("bnn_game_scores_")) drop(`${prefix}${key.replace("bnn_game_scores_", "bnn_game_wm_")}`);
    if (reason === "deleted" && item.gameId) drop(`bnn_game_snap_${item.gameId}`);
  }
  return { removed, archived };
}
/** A one-line account of what was cleared, for the Profile notice. */
export function retiredSummary(retired: RetiredItem[], archived = true): string {
  const games = new Map<string, "deleted" | "ended">();
  for (const r of retired) if (r.item.gameId && !games.has(r.item.gameId)) games.set(r.item.gameId, r.reason);
  const deleted = Array.from(games.values()).filter((v) => v === "deleted").length, ended = games.size - deleted;
  const part = (n: number, what: string) => `${n} ${what} game${n === 1 ? "" : "s"}`;
  const parts = [deleted ? part(deleted, "deleted") : "", ended ? part(ended, "ended") : ""].filter(Boolean);
  return `Unsynced entries for ${parts.join(" and ")} were cleared — they could no longer be sent. ${archived ? "A recovery copy stays on this phone." : "This phone is nearly out of storage, so no recovery copy could be kept."}`;
}

/**
 * Remove the signed-out identity's local state. Kept: the recovery archive, and the score outboxes of OTHER identities
 * (a shared phone, or a member who signed in with a second Google account before the accounts were merged).
 */
export function clearLocalStateForSignOut(userId: string, storage: Storage = window.localStorage, opts: { keepOwnOutbox?: boolean } = {}): string[] {
  const removed: string[] = [];
  try {
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!);
    for (const key of keys) {
      if (!(key.startsWith("bnn_") || key.startsWith("bnn-") || key.startsWith("bnn:"))) continue;
      if (key === SCORING_ARCHIVE_KEY || key.startsWith(RECOVERY_PREFIX)) continue;   // recovery data is never removed by sign-out
      if (key === DEVICE_ID_KEY) continue;   // 212.135: the phone's id outlives the account signed in on it
      const m = OUTBOX.exec(key);
      if (m && (m[1] !== userId || opts.keepOwnOutbox)) continue;   // another identity's, or saved before the identity was known, or ours when it could not be archived
      if (key === SCORING_OWNER_KEY) { const owner = parse(storage, key); if ((owner?.user && owner.user !== userId) || opts.keepOwnOutbox) continue; }   // kept with the outbox: it is the token the next sign-in resumes
      if (opts.keepOwnOutbox && !m && isScoreKey(key)) continue;   // a legacy unprefixed score key, kept for the same reason
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
  /** 212.135: the server's status for the pending items' games (rpc games_states); null when it cannot be asked */
  gameStates?: (gameIds: string[]) => Promise<GameState[] | null>;
};
/** Ask the server which of the items' games are gone or ended, and clear those entries. Returns the retired entries. */
export async function retireUnsyncable(items: UnsyncedItem[], userId: string, gameStates: Deps["gameStates"], storage: Storage): Promise<{ retired: RetiredItem[]; archived: boolean }> {
  const mine = items.filter((i) => i.owner === userId);   // only this member's own entries: another identity's outbox is never judged by this member's game list (the review)
  const ids = Array.from(new Set(mine.map((i) => i.gameId).filter((g): g is string => !!g)));
  if (!ids.length || !gameStates) return { retired: [], archived: true };
  let states: GameState[] | null = null;
  try { states = await gameStates(ids); } catch { states = null; }
  if (!states) return { retired: [], archived: true };   // offline or refused: nothing is cleared on a guess
  const { retired } = splitRetired(mine, states);
  const { archived } = retireItems(retired, userId, storage);
  return { retired, archived };
}
/** The one sign-out flow (Profile and the paused-account screen). Returns true once signed out and cleared. */
export async function signOutSafely(userId: string, deps: Deps): Promise<boolean> {
  const storage = deps.storage ?? window.localStorage;
  let pending = unsyncedWork(storage, userId);
  if ((await retireUnsyncable(pending, userId, deps.gameStates, storage)).retired.length) pending = unsyncedWork(storage, userId);
  // only the signed-out member's own items are at stake: another identity's outbox (or one saved before the identity was
  // known) is kept and resumes when that account is next used
  const mine = pending.filter((p) => p.owner === userId), others = pending.length - mine.length;
  let archived = true;
  const archiveBefore = storage.getItem(SCORING_ARCHIVE_KEY);   // put back if the sign-out then fails (the archive is capped at 3 entries)
  if (mine.length) {
    const list = mine.slice(0, 4).map((p) => `• ${p.label}`).join("\n") + (mine.length > 4 ? `\n• and ${mine.length - 4} more` : "");
    const go = await deps.confirm({
      title: "Scores on this phone haven’t synced",
      message: `${list}\n\nReconnect and open that scorecard to sync first. If you sign out now the app will not resume them; a recovery copy stays on this phone.${others ? `\n\n(${others} saved item${others === 1 ? "" : "s"} from another account on this phone will be kept.)` : ""}`,
      confirmLabel: "Sign out anyway", danger: true,
    });
    if (!go) return false;
    // The recovery copy is written NOW, while the app is still on screen to say so if it cannot be (212.132: after the
    // sign-out the Home screen — and its sheet and toasts — is gone). The archive is non-destructive; nothing is removed yet.
    try { archiveScoringBackups(false, userId); } catch { archived = false; }
    if (!archived) {
      const go2 = await deps.confirm({
        title: "Couldn’t save a recovery copy",
        message: "This phone is nearly out of storage, so the recovery copy could not be written. If you sign out anyway, your unsynced scores stay on this phone: they come back when you next sign in here online, provided no other device has scored for you since — otherwise they remain available from Profile → Download saved scores.",
        confirmLabel: "Sign out anyway", danger: true,
      });
      if (!go2) return false;
    }
  }
  let error: { message?: string } | null = null;
  try { error = (await deps.signOut()).error; } catch (e) { error = e instanceof Error ? e : { message: String(e) }; }
  if (error) {
    try { if (archiveBefore == null) storage.removeItem(SCORING_ARCHIVE_KEY); else storage.setItem(SCORING_ARCHIVE_KEY, archiveBefore); } catch { /* the extra entry is harmless */ }
    deps.notify(`Couldn’t sign out${error.message ? ` (${error.message})` : ""}. Nothing on this phone was removed; check the connection and try again.`); return false;
  }
  // Signed out: clear, scoped to this identity. When the archive could not be written the member's own outbox AND the
  // device-owner marker stay, so the next online sign-in on this phone presents the old token and resumes the outbox
  // (lib/scoring-device resumeBackups) — the scores reappear in their scorecards rather than sitting unreachable.
  resetPhoneDiagnostics();
  clearLocalStateForSignOut(userId, storage, { keepOwnOutbox: !archived });
  return true;
}
