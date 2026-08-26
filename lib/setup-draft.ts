// Device-local draft of an in-progress game setup, so leaving the Create Game
// screen mid-setup doesn't lose your picks. Thin wrapper over the shared
// form-draft helper (keyed by group + originating tee time).
import { loadFormDraft, saveFormDraft, clearFormDraft, draftAgeLabel } from "./form-draft";
export { draftAgeLabel };

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
  /** 18 / front9 / back9. Optional: drafts written before this existed resume as 18. */
  matchLength?: "18" | "front9" | "back9";
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
  flightMode?: string;
  flightCount?: number;
  // Create Game tee inheritance (177.50+). Optional so all older saved drafts still load.
  flightTeeIdx?: Record<string, number>;
  playerTeeOverrides?: Record<string, number>;
  hcpOverrides?: Record<string, number>;
  createSection?: "game" | "players" | "format" | "structure" | "review";
  selectedPlayers: Record<string, boolean>;
  guestPlayers: { id: string; display_name: string; handicap_index: number | null; guest_of: string }[];
};
type SetupData = Omit<SetupDraft, "v" | "savedAt">;

const keyFor = (groupId: string, teeTimeId?: string | null) => `bnn_setup_draft:${groupId}:${teeTimeId || "none"}`;

export function loadSetupDraft(groupId: string, teeTimeId?: string | null): SetupDraft | null {
  const d = loadFormDraft<SetupData>(keyFor(groupId, teeTimeId));
  return d ? ({ v: 1, savedAt: d.savedAt, ...d.data } as SetupDraft) : null;
}
export function saveSetupDraft(groupId: string, teeTimeId: string | null | undefined, draft: SetupData) {
  saveFormDraft(keyFor(groupId, teeTimeId), draft);
}
export function clearSetupDraft(groupId: string, teeTimeId?: string | null) {
  clearFormDraft(keyFor(groupId, teeTimeId));
}

// Worth offering to resume only if the user actually got somewhere.
export function draftHasProgress(d: SetupDraft | Omit<SetupDraft, "v" | "savedAt">, selfId: string): boolean {
  const others = Object.entries(d.selectedPlayers || {}).filter(([id, on]) => on && id !== selfId).length;
  const formatChanged = d.gameType !== "stableford" || d.allowancePct !== 100 || d.teamMode || d.skinsMode !== "carryover" || d.flightMode === "oneoff";
  const structureChanged = d.team1 !== "Team 1" || d.team2 !== "Team 2";
  const teeOverrides = Object.keys(d.playerTeeOverrides || {}).length > 0 || Object.keys(d.flightTeeIdx || {}).length > 0;
  return !!d.favName
    || (d.guestPlayers?.length || 0) > 0
    || (d.name || "").trim().length > 0
    || others > 0
    || formatChanged
    || structureChanged
    || teeOverrides
    || (d.createSection != null && d.createSection !== "game");
}
