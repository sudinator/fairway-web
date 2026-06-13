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
