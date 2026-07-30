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
