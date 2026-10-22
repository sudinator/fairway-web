// The scramble handicap methods (211.9, owner) — ONE wording, used by the create form, Setup → Format and Teams.
export type ScrambleMethod = "usga" | "agreed" | "gross";   // "gross": legacy games only — no longer offered

export const SCRAMBLE_METHOD_LABEL: Record<ScrambleMethod, string> = { usga: "USGA allowance", agreed: "Agreed handicaps", gross: "Gross" };
export const OFFERED_METHODS: ScrambleMethod[] = ["usga", "agreed"];
/** 212.0: a scramble no longer has one team size — teams are made in Setup → Teams (2 to 4 players each, sizes may
 *  differ). The only setting left is who plays on the app: every player, or captains only. */
export const isCaptainsOnly = (g: { scramble_team_size?: number | null }) => g.scramble_team_size === 1;

/** What the method does, in plain words, for this team size. */
export function scrambleMethodText(method: ScrambleMethod, size: number): string {
  if (size === 1) return "Captains only: each team is represented in the app by its captain, who enters the team's score — the teammates play outside the app. There's nothing to work a handicap out from, so you enter each team's handicap (agreed handicaps).";
  if (method === "gross") return "No handicaps — everyone plays scratch, and the lowest team score wins.";
  if (method === "agreed") return "You enter each team's handicap in Setup → Teams — whatever the players agree; a blank team plays scratch. Strokes are taken hole by hole, on the hardest holes first.";
  return "Each team's handicap is worked out from its players' course handicaps with the percentages for its size (the USGA's by default — change them for this game if your group plays different ones), added up and rounded. Teams may be of different sizes; each uses its own row. Strokes are taken hole by hole, on the hardest holes first.";
}
