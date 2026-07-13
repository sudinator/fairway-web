// Lightweight, opt-in diagnostics for the round-save path. Everything here is a no-op
// unless the user explicitly enables logging in the admin Diagnostics panel, so there is
// zero overhead for normal players. The log lives in localStorage specifically so it
// SURVIVES the PWA reloading/cold-starting mid-round (which is part of the bug we're
// chasing) — an in-memory console log would be wiped on every reload.

const LOG_KEY = "bnn_rsdiag_log";
const DIAG_KEY = "bnn_rsdiag_on";        // "1" = record events
const REPRO_KEY = "bnn_rsdiag_repro";    // "1" = run the LEGACY insert path (reproduce the bug)
const MAX = 400;                          // ring buffer cap

export type DiagEvent = { t: number; sid: string; ev: string; d?: Record<string, any> };

export function diagEnabled(): boolean {
  try { return localStorage.getItem(DIAG_KEY) === "1"; } catch { return false; }
}
export function setDiagEnabled(on: boolean): void {
  try { localStorage.setItem(DIAG_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}
export function reproduceBug(): boolean {
  try { return localStorage.getItem(REPRO_KEY) === "1"; } catch { return false; }
}
export function setReproduceBug(on: boolean): void {
  try { localStorage.setItem(REPRO_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}

// Append an event. No-op unless diagnostics are enabled.
export function dbg(ev: string, sid: string, d?: Record<string, any>): void {
  if (!diagEnabled()) return;
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const arr: DiagEvent[] = raw ? JSON.parse(raw) : [];
    arr.push({ t: Date.now(), sid, ev, d });
    if (arr.length > MAX) arr.splice(0, arr.length - MAX);
    localStorage.setItem(LOG_KEY, JSON.stringify(arr));
  } catch { /* ignore */ }
}

export function getDiagLog(): DiagEvent[] {
  try { const raw = localStorage.getItem(LOG_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
export function clearDiagLog(): void {
  try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ }
}

// A short random id generated once per editor mount, so events from the same mount group
// together and you can see across reloads that one round produced several mounts/inserts.
export function newSid(): string {
  return Math.random().toString(36).slice(2, 7);
}
