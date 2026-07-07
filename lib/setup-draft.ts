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
export function draftHasProgress(d: Pick<SetupDraft, "favName" | "guestPlayers" | "name" | "selectedPlayers">, selfId: string): boolean {
  const others = Object.entries(d.selectedPlayers || {}).filter(([id, on]) => on && id !== selfId).length;
  return !!d.favName || (d.guestPlayers?.length || 0) > 0 || (d.name || "").trim().length > 0 || others > 0;
}
