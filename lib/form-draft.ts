// Generic device-local draft for any multi-field form, so leaving a half-finished
// form doesn't lose your work. Shared by game setup, course creation, and tee-time
// creation. No DB — localStorage only, keyed by a caller-provided string.

type Stored<T> = { v: 1; savedAt: number; data: T };

export function loadFormDraft<T>(key: string): { savedAt: number; data: T } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Stored<T>;
    return d && d.v === 1 ? { savedAt: d.savedAt, data: d.data } : null;
  } catch { return null; }
}

export function saveFormDraft<T>(key: string, data: T): void {
  try { localStorage.setItem(key, JSON.stringify({ v: 1, savedAt: Date.now(), data })); } catch { /* storage full/unavailable — non-fatal */ }
}

export function clearFormDraft(key: string): void {
  try { localStorage.removeItem(key); } catch { /* non-fatal */ }
}

// "3 minutes ago" style label for resume banners.
export function draftAgeLabel(savedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - savedAt) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
