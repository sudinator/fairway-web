// In-progress round draft, stored in the browser's localStorage.
// localStorage writes are SYNCHRONOUS — they complete before the phone can lock
// or the tab can be evicted, so an in-progress round survives a lock or refresh
// even if the user locks the screen the instant after tapping a score.
//
// This is the durability mechanism for live score entry. The round is written to
// the database only when the user taps "Finish round" (the official record).

import type { Round } from "@/lib/golf";

const KEY = "bnn_round_draft_v1";

export function saveDraft(round: Round): void {
  try {
    if (typeof window === "undefined") return;
    // Safety: never overwrite an existing draft that HAS scores with one that has
    // NONE (e.g. a transient empty state after a remount). Losing entered scores is
    // far worse than keeping a slightly stale draft.
    const incomingScored = (round.holes || []).some((h) => h.strokes != null);
    if (!incomingScored) {
      const existing = loadDraft();
      const existingScored = (existing?.round?.holes || []).some((h: any) => h.strokes != null);
      if (existingScored && existing?.round?.course === round.course) return;
    }
    window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), round }));
  } catch {
    // Storage can be unavailable (private mode, quota). Fail silently — DB save on
    // Finish is still the backstop.
  }
}

export function loadDraft(): { savedAt: number; round: Round } | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.round) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(KEY);
  } catch {}
}

// True if the draft has at least one hole with a score entered.
export function draftHasScores(round: Round | null | undefined): boolean {
  if (!round?.holes?.length) return false;
  return round.holes.some((h) => h.strokes != null && (h.strokes as number) > 0);
}

// --- Active game resume (game room) ---
// Remembers which game room the user was in (and which sub-tab) so a lock or
// refresh returns them to the scorecard instead of the games list.
const GKEY = "bnn_active_game_v1";

export function saveActiveGame(gameId: string, tab: "play" | "setup"): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GKEY, JSON.stringify({ gameId, tab, at: Date.now() }));
  } catch {}
}

export function loadActiveGame(): { gameId: string; tab: "play" | "setup" } | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(GKEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.gameId) return null;
    return { gameId: p.gameId, tab: p.tab === "setup" ? "setup" : "play" };
  } catch { return null; }
}

export function clearActiveGame(): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(GKEY);
  } catch {}
}

// --- In-progress GAME score backup (per game, per device) ---
// Game scores normally write straight to the database on each tap, but an
// immediate screen lock can freeze that network write before it lands. This
// synchronous localStorage backup captures the latest scores instantly so a
// hole entered right before a lock isn't lost; on reopen we reconcile it to the DB.
function gameScoreKey(gameId: string, playerId: string) {
  return `bnn_game_scores_${gameId}_${playerId}`;
}

export function saveGameScores(
  gameId: string,
  playerId: string,
  data: { scores: any[]; putts: any[]; fairways: any[]; penalties?: any[]; sand?: any[] },
  force = false,
): void {
  try {
    if (typeof window === "undefined") return;
    if (!force) {
      // Passive saves (load/reconcile mirrors) must never overwrite a scored
      // backup with an empty one — a transient empty state during init could
      // otherwise wipe offline scores. Deliberate user edits pass force=true so
      // an intentional deletion (even down to empty) DOES update the backup and
      // can't be resurrected by the merge on reload.
      const scored = (data.scores || []).some((s) => s != null);
      if (!scored) {
        const existing = loadGameScores(gameId, playerId);
        if (existing && (existing.scores || []).some((s) => s != null)) return;
      }
    }
    window.localStorage.setItem(gameScoreKey(gameId, playerId), JSON.stringify({ at: Date.now(), ...data }));
  } catch {}
}

export function loadGameScores(
  gameId: string,
  playerId: string,
): { scores: any[]; putts: any[]; fairways: any[]; penalties: any[]; sand: any[]; at: number } | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(gameScoreKey(gameId, playerId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { scores: p.scores || [], putts: p.putts || [], fairways: p.fairways || [], penalties: p.penalties || [], sand: p.sand || [], at: typeof p.at === "number" ? p.at : 0 };
  } catch { return null; }
}

export function clearGameScores(gameId: string, playerId: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(gameScoreKey(gameId, playerId));
  } catch {}
}

// Remove EVERY local score backup for a game on this device (all player rows).
// Used by the master reset so a pre-game test wipe leaves no backup behind that
// could resurface — including the rows a marker backed up for other players.
export function clearAllGameScores(gameId: string): void {
  try {
    if (typeof window === "undefined") return;
    const prefix = `bnn_game_scores_${gameId}_`;
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
    // Drop watermarks for this game too, so a reset can't leave "already synced" markers.
    const wmPrefix = `bnn_game_wm_${gameId}_`;
    const wmKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(wmPrefix)) wmKeys.push(k);
    }
    wmKeys.forEach((k) => window.localStorage.removeItem(k));
    clearGameSnapshot(gameId);
  } catch {}
}

// --- Per-user daily AI analysis cap (client-side) ---
// Limits how many AI analyses a user can run per day, as the first line of cost
// defense. Stored per device; the server also enforces a global daily cap.
const AI_KEY = "bnn_ai_uses";
const AI_DAILY_LIMIT = 2;

export function aiUsesLeft(): number {
  try {
    if (typeof window === "undefined") return AI_DAILY_LIMIT;
    const today = new Date().toISOString().slice(0, 10);
    const raw = window.localStorage.getItem(AI_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (!p || p.day !== today) return AI_DAILY_LIMIT;
    return Math.max(0, AI_DAILY_LIMIT - (p.count || 0));
  } catch { return AI_DAILY_LIMIT; }
}

export function recordAiUse(): void {
  try {
    if (typeof window === "undefined") return;
    const today = new Date().toISOString().slice(0, 10);
    const raw = window.localStorage.getItem(AI_KEY);
    const p = raw ? JSON.parse(raw) : null;
    const count = p && p.day === today ? (p.count || 0) + 1 : 1;
    window.localStorage.setItem(AI_KEY, JSON.stringify({ day: today, count }));
  } catch {}
}

export const AI_DAILY_LIMIT_VALUE = AI_DAILY_LIMIT;

// --- Active game snapshot (full boot payload for offline cold-launch) ---
// Captured while ONLINE so the round stays fully usable with no signal: the game
// row, all player rows, and the course tee yardages. Merged on save so the game
// room can write {game,players} and the tees effect can add {courseTees} later.
function gameSnapKey(gameId: string) { return `bnn_game_snap_${gameId}`; }
export function saveGameSnapshot(gameId: string, partial: { game?: any; players?: any[]; courseTees?: any[] }): void {
  try {
    if (typeof window === "undefined") return;
    const existing = loadGameSnapshot(gameId) || {};
    window.localStorage.setItem(gameSnapKey(gameId), JSON.stringify({ ...existing, ...partial, at: Date.now() }));
  } catch {}
}
export function loadGameSnapshot(gameId: string): { game?: any; players?: any[]; courseTees?: any[]; at?: number } | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(gameSnapKey(gameId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function clearGameSnapshot(gameId: string): void {
  try { if (typeof window === "undefined") return; window.localStorage.removeItem(gameSnapKey(gameId)); } catch {}
}

// --- App boot cache (profile + groups + active group) for offline cold-launch ---
// Lets Home render the right group offline so the user can reach the game room.
const BOOT_KEY = "bnn_boot_cache_v1";
export function saveAppBootCache(data: { profile?: any; groups?: any[]; activeGroupId?: string | null }): void {
  try {
    if (typeof window === "undefined") return;
    const existing = loadAppBootCache() || {};
    window.localStorage.setItem(BOOT_KEY, JSON.stringify({ ...existing, ...data, at: Date.now() }));
  } catch {}
}
export function loadAppBootCache(): { profile?: any; groups?: any[]; activeGroupId?: string | null; at?: number } | null {
  try { if (typeof window === "undefined") return null; const raw = window.localStorage.getItem(BOOT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// --- Last session identity (so a cold offline launch renders without a live token) ---
const SESS_KEY = "bnn_last_session_v1";
export function saveLastSession(user: any): void {
  try {
    if (typeof window === "undefined" || !user) return;
    window.localStorage.setItem(SESS_KEY, JSON.stringify({ user: { id: user.id, email: user.email, user_metadata: user.user_metadata }, at: Date.now() }));
  } catch {}
}
export function loadLastSession(): { user: any } | null {
  try { if (typeof window === "undefined") return null; const raw = window.localStorage.getItem(SESS_KEY); const p = raw ? JSON.parse(raw) : null; return p?.user ? { user: p.user } : null; } catch { return null; }
}

// True when the browser reports no connectivity. Best-effort signal only.
export function isOffline(): boolean {
  try { return typeof navigator !== "undefined" && navigator.onLine === false; } catch { return false; }
}

// --- Sync watermark + pending detection (offline outbox, Phase 2) ---
// The watermark is the arrays we've CONFIRMED landed on the server for a row.
// A row is "pending" when its local backup differs from its watermark. This is
// derived state (no separate outbox list to drift): dirty = backup !== watermark.
function wmKey(gameId: string, rowId: string) { return `bnn_game_wm_${gameId}_${rowId}`; }
export function saveSyncedWatermark(
  gameId: string,
  rowId: string,
  data: { scores: any[]; putts: any[]; fairways: any[]; penalties?: any[]; sand?: any[] },
): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(wmKey(gameId, rowId), JSON.stringify({
      scores: data.scores || [], putts: data.putts || [], fairways: data.fairways || [],
      penalties: data.penalties || [], sand: data.sand || [],
    }));
  } catch {}
}
// Drop a single row's synced watermark — used when a reset invalidates a row so a
// stale "already synced" marker can't suppress re-pushing fresh post-reset scores.
export function clearSyncedWatermark(gameId: string, rowId: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(wmKey(gameId, rowId));
  } catch {}
}
export function loadSyncedWatermark(gameId: string, rowId: string): { scores: any[]; putts: any[]; fairways: any[]; penalties: any[]; sand: any[] } | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(wmKey(gameId, rowId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { scores: p.scores || [], putts: p.putts || [], fairways: p.fairways || [], penalties: p.penalties || [], sand: p.sand || [] };
  } catch { return null; }
}

// Count holes whose local backup differs from the watermark (any tracked field).
// With no watermark yet, every entered hole counts as pending.
export function rowPendingHoles(
  backup: { scores: any[]; putts: any[]; fairways: any[]; penalties: any[]; sand: any[] } | null,
  wm: { scores: any[]; putts: any[]; fairways: any[]; penalties: any[]; sand: any[] } | null,
): number {
  if (!backup) return 0;
  const w = wm || { scores: [], putts: [], fairways: [], penalties: [], sand: [] };
  const n = Math.max(
    backup.scores?.length || 0, backup.putts?.length || 0, backup.fairways?.length || 0,
    backup.penalties?.length || 0, backup.sand?.length || 0,
  );
  let c = 0;
  for (let i = 0; i < n; i++) {
    const diff =
      (backup.scores?.[i] ?? null) !== (w.scores?.[i] ?? null) ||
      (backup.putts?.[i] ?? null) !== (w.putts?.[i] ?? null) ||
      (backup.fairways?.[i] ?? null) !== (w.fairways?.[i] ?? null) ||
      (backup.penalties?.[i] ?? null) !== (w.penalties?.[i] ?? null) ||
      (backup.sand?.[i] ?? null) !== (w.sand?.[i] ?? null);
    // Only count a hole as pending if it actually has a score locally.
    if (diff && (backup.scores?.[i] ?? null) != null) c++;
  }
  return c;
}
