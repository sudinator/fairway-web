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
  // 209.4 (owner): the automatic second-team colour is gold (was orange — too close to red and gold).
  return TEAM_COLOR_BY_NAME[k] || (index === 0 ? "#5AA9E6" : "#D8B24A");
};

/** The colours an organizer can choose for a team (209.4, owner): five that are clearly different on a phone
 *  — measured: every pair at least 41 apart in perceived colour. Pink, teal and orange were dropped (orange is
 *  only ~25 from red and gold). No white: it reads as plain text, and as "the white tees". */
export const TEAM_PALETTE: { key: string; label: string; hex: string }[] = [
  { key: "red", label: "Red", hex: TEAM_COLOR_BY_NAME.red },
  { key: "blue", label: "Blue", hex: TEAM_COLOR_BY_NAME.blue },
  { key: "gold", label: "Gold", hex: TEAM_COLOR_BY_NAME.gold },
  { key: "purple", label: "Purple", hex: TEAM_COLOR_BY_NAME.purple },
  { key: "green", label: "Green", hex: TEAM_COLOR_BY_NAME.green },
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


type TeamLike = { name?: string | null; color?: string | null };
/** Is this team's colour automatic (no name colour, nothing chosen)? */
export const isAutomaticColour = (team: TeamLike | null | undefined): boolean =>
  !nameColour(team?.name) && !TEAM_PALETTE.some((p) => p.key === (team?.color || "").toLowerCase());

/**
 * What picking a colour does (209.4, owner): the colour is applied; if it is the OTHER team's colour the two
 * SWAP (nothing is ever greyed out); a team named after a colour keeps it, so its colour can't be taken.
 * Returns the colour keys to store for both teams, or null when the pick isn't possible.
 */
export function pickTeamColour(teams: [TeamLike, TeamLike], i: 0 | 1, key: string): { colors: [string | null, string | null]; swapped: boolean } | null {
  const pick = TEAM_PALETTE.find((p) => p.key === key);
  if (!pick || nameColour(teams[i]?.name)) return null;
  const o = (1 - i) as 0 | 1;
  const otherHex = teamColour(teams[o], o);
  const colors: [string | null, string | null] = [teams[0]?.color ?? null, teams[1]?.color ?? null];
  colors[i] = pick.key;
  if (otherHex !== pick.hex) return { colors, swapped: false };
  if (nameColour(teams[o]?.name)) return null;   // the other team's NAME is this colour
  const mine = TEAM_PALETTE.find((p) => p.hex === teamColour(teams[i], i));
  colors[o] = mine ? mine.key : null;
  return { colors, swapped: true };
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** 212.44: the readable text colour ON a team colour — dark ink or light, whichever contrasts more. Dark text on red,
 * purple, navy or maroon fills was below the reading threshold (the contrast guard found it in the compact team card). */
export const TEAM_INK_DARK = "#0B1A14", TEAM_INK_LIGHT = "#FBF8F0";
export function readableInk(fill: string): string {
  return contrastRatio(TEAM_INK_DARK, fill) >= contrastRatio(TEAM_INK_LIGHT, fill) ? TEAM_INK_DARK : TEAM_INK_LIGHT;
}
