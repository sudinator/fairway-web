// The scramble handicap methods (211.9, owner) — ONE wording, used by the create form, Setup → Format and Teams.
export type ScrambleMethod = "usga" | "agreed" | "gross";   // "gross": legacy games only — no longer offered

export const SCRAMBLE_METHOD_LABEL: Record<ScrambleMethod, string> = { usga: "USGA allowance", agreed: "Agreed handicaps", gross: "Gross" };
export const OFFERED_METHODS: ScrambleMethod[] = ["usga", "agreed"];
export const teamSizeLabel = (n: number) => (n === 1 ? "Captains only" : `${n} players`);

/** What the method does, in plain words, for this team size. */
export function scrambleMethodText(method: ScrambleMethod, size: number): string {
  if (size === 1) return "Captains only: each team is represented in the app by its captain, who enters the team's score — the teammates play outside the app. There's nothing to work a handicap out from, so you enter each team's handicap (agreed handicaps).";
  if (method === "gross") return "No handicaps — everyone plays scratch, and the lowest team score wins.";
  if (method === "agreed") return "You enter each team's handicap in Setup → Teams — whatever the players agree; a blank team plays scratch. Strokes are taken hole by hole, on the hardest holes first.";
  return "Each team's handicap is worked out from its players' course handicaps with the percentages below (the USGA's by default — change them for this game if your group plays different ones), added up and rounded. Strokes are taken hole by hole, on the hardest holes first.";
}
