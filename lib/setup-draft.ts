// Device-local draft of an in-progress game setup, so leaving the Create Game
// screen mid-setup doesn't lose your picks. Mirrors the round-draft pattern
// (local only, no DB row until the game is actually created). Keyed by group +
// originating tee time, so a draft from one tee time never bleeds into another.

export type SetupDraft = {
  v: 1;
  savedAt: number;
  name: string;
  matchDate: string;
  favName: string | null; // course kept by name — favorites reload and are matched by name
  teeIdx: number;
  idxStr: string;
  gameType: string;
  allowancePct: number;
  teamScoreMode: string;
  trifectaScoring: string;
  strokeBasis: string;
  fmtFamily: string;
  matchKind: string;
  teamMode: boolean;
  skinsTeamStyle: string;
  skinsMode: string;
  team1: string;
  team2: string;
  selectedPlayers: Record<string, boolean>;
  guestPlayers: { id: string; display_name: string; handicap_index: number | null; guest_of: string }[];
};

const PREFIX = "bnn_setup_draft:";
const keyFor = (groupId: string, teeTimeId?: string | null) => `${PREFIX}${groupId}:${teeTimeId || "none"}`;

export function loadSetupDraft(groupId: string, teeTimeId?: string | null): SetupDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(groupId, teeTimeId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.v === 1 ? (d as SetupDraft) : null;
  } catch { return null; }
}

export function saveSetupDraft(groupId: string, teeTimeId: string | null | undefined, draft: Omit<SetupDraft, "v" | "savedAt">) {
  try { localStorage.setItem(keyFor(groupId, teeTimeId), JSON.stringify({ v: 1, savedAt: Date.now(), ...draft })); } catch { /* storage full/unavailable — non-fatal */ }
}

export function clearSetupDraft(groupId: string, teeTimeId?: string | null) {
  try { localStorage.removeItem(keyFor(groupId, teeTimeId)); } catch { /* non-fatal */ }
}

// Worth offering to resume only if the user actually got somewhere: a course chosen,
// guests added, a name typed, or players picked beyond just themselves.
export function draftHasProgress(d: Pick<SetupDraft, "favName" | "guestPlayers" | "name" | "selectedPlayers">, selfId: string): boolean {
  const others = Object.entries(d.selectedPlayers || {}).filter(([id, on]) => on && id !== selfId).length;
  return !!d.favName || (d.guestPlayers?.length || 0) > 0 || (d.name || "").trim().length > 0 || others > 0;
}

// "3 minutes ago" style label for the resume banner.
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
