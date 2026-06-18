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
): void {
  try {
    if (typeof window === "undefined") return;
    const scored = (data.scores || []).some((s) => s != null);
    if (!scored) {
      // Never overwrite a scored backup with an empty one.
      const existing = loadGameScores(gameId, playerId);
      if (existing && (existing.scores || []).some((s) => s != null)) return;
    }
    window.localStorage.setItem(gameScoreKey(gameId, playerId), JSON.stringify({ at: Date.now(), ...data }));
  } catch {}
}

export function loadGameScores(
  gameId: string,
  playerId: string,
): { scores: any[]; putts: any[]; fairways: any[]; penalties: any[]; sand: any[] } | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(gameScoreKey(gameId, playerId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { scores: p.scores || [], putts: p.putts || [], fairways: p.fairways || [], penalties: p.penalties || [], sand: p.sand || [] };
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
