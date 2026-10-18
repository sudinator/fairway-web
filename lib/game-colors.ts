// Team accent colour, shared by the game components. If a team is *named* after a colour
// ("Red", "Blue", …) we honour that name so "Red" never shows up blue; otherwise fall back to
// a stable palette keyed off the team's position (0 / 1). Extracted from tournaments.tsx so the
// scoring/segment views can import it instead of depending on the mega-file.
export const TEAM_COLOR_BY_NAME: Record<string, string> = {
  red: "#E0695B", blue: "#5AA9E6", green: "#5BD08A", black: "#9AA0A6", white: "#D9D4C7",
  yellow: "#E8C84A", gold: "#D8B24A", orange: "#E0915B", purple: "#B084E0", pink: "#E08AB8",
  silver: "#C0C4C8", maroon: "#B05B5B", navy: "#5A7BC0", teal: "#4FB8A8",
};

export const teamAccent = (name: string | null | undefined, index: number): string => {
  const k = (name || "").trim().toLowerCase();
  return TEAM_COLOR_BY_NAME[k] || (index === 0 ? "#5AA9E6" : "#E0915B");
};

/** 209.1: the eight colours an organizer can choose for a team — the app's existing team accents, each
 *  readable on the app's green. No white: it reads as plain text, and as "the white tees". */
export const TEAM_PALETTE: { key: string; label: string; hex: string }[] = [
  { key: "red", label: "Red", hex: TEAM_COLOR_BY_NAME.red },
  { key: "blue", label: "Blue", hex: TEAM_COLOR_BY_NAME.blue },
  { key: "gold", label: "Gold", hex: TEAM_COLOR_BY_NAME.gold },
  { key: "purple", label: "Purple", hex: TEAM_COLOR_BY_NAME.purple },
  { key: "green", label: "Green", hex: TEAM_COLOR_BY_NAME.green },
  { key: "pink", label: "Pink", hex: TEAM_COLOR_BY_NAME.pink },
  { key: "orange", label: "Orange", hex: TEAM_COLOR_BY_NAME.orange },
  { key: "teal", label: "Teal", hex: TEAM_COLOR_BY_NAME.teal },
];

/** The colour a team's NAME gives it ("Red", "Blue", …), or null when the name isn't a colour. */
export const nameColour = (name: string | null | undefined): string | null => TEAM_COLOR_BY_NAME[(name || "").trim().toLowerCase()] ?? null;

/** A game team's colour, everywhere it appears (owner rule, Oct 2026):
 *   1. a team NAMED after a colour gets that colour — always ("Red" is red whatever was picked);
 *   2. otherwise the organizer's chosen colour, when it is one of the eight;
 *   3. otherwise blue / orange by position (as before). */
export const teamColour = (team: { name?: string | null; color?: string | null } | null | undefined, index: number): string => {
  const byName = nameColour(team?.name);
  if (byName) return byName;
  const chosen = TEAM_PALETTE.find((p) => p.key === (team?.color || "").toLowerCase());
  return chosen ? chosen.hex : teamAccent(team?.name, index);
};
