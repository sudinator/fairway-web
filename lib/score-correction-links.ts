export type ScoreCorrectionTarget = { kind: "game" | "round"; id: string };
export const SCORE_CORRECTION_EVENT = "bnn-open-score-correction";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function scoreCorrectionHref(target: ScoreCorrectionTarget) {
  return `/?${target.kind === "game" ? "scoreGame" : "scoreRound"}=${encodeURIComponent(target.id)}`;
}
export function parseScoreCorrection(search: string): ScoreCorrectionTarget | null {
  const q = new URLSearchParams(search), game = q.get("scoreGame"), round = q.get("scoreRound");
  if (game && UUID.test(game)) return { kind: "game", id: game };
  if (round && (UUID.test(round) || round === "draft")) return { kind: "round", id: round };
  return null;
}
export function scoreClubName(info?: { group_id?: string | null; group_name?: string | null } | null, personal = false) {
  if (info?.group_name) return `Club: ${info.group_name}`;
  if (personal && info && "group_id" in info && info.group_id === null) return "Personal round · no club";
  return "Club: not yet available — reconnect to check";
}
