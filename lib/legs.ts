// lib/legs.ts — pure logic for the "Group results: legs & team points" layer.
// Added onto team formats (four-ball / trifecta / team match). No I/O, no React.
// Tie rules: best score in a leg wins it; award the leg's points to each WINNING TEAM.
// Ties across teams => every tied team scores; ties within one team => that team scores once.

export interface Leg { k: string; from: number; to: number; tot?: boolean }

/** Build the legs for a segmentation scheme over n holes, de-duping identical ranges. */
export function buildLegs(scheme: string, n: number): Leg[] {
  const legs: Leg[] = [];
  if (scheme === "nines") {
    legs.push({ k: "Front 9", from: 0, to: Math.min(9, n) });
    if (n > 9) legs.push({ k: "Back 9", from: 9, to: n });
    legs.push({ k: "Total", from: 0, to: n, tot: true });
  } else if (scheme === "total") {
    legs.push({ k: "Total", from: 0, to: n, tot: true });
  } else { // "sixes" | "sixesNoTot"
    for (let s = 0; s < n; s += 6) legs.push({ k: (s + 1) + "\u2013" + Math.min(s + 6, n), from: s, to: Math.min(s + 6, n) });
    if (scheme !== "sixesNoTot") legs.push({ k: "Total", from: 0, to: n, tot: true });
  }
  const seen = new Map<string, Leg>();
  for (const l of legs) seen.set(l.from + "-" + l.to, l); // later entry (labelled total) wins
  return Array.from(seen.values());
}

export interface LegScore { pid: string; team: string; val: number | null }
export interface LegResult { winnerPids: string[]; winnerTeams: string[]; best: number | null }

/** Winner(s) of one leg. metric "pts" => highest wins; "net" => lowest wins. */
export function legResult(scores: LegScore[], metric: "pts" | "net"): LegResult {
  const vals = scores.map((s) => s.val).filter((v): v is number => v != null);
  if (!vals.length) return { winnerPids: [], winnerTeams: [], best: null };
  const best = metric === "net" ? Math.min(...vals) : Math.max(...vals);
  const wins = scores.filter((s) => s.val === best);
  return { winnerPids: wins.map((s) => s.pid), winnerTeams: Array.from(new Set(wins.map((s) => s.team))), best };
}

/** Sum leg points per team. Each winning team gets the leg's points once (same-team tie => once). */
export function teamTally(legs: { teams: string[]; points: number }[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const l of legs) for (const tm of l.teams) t[tm] = (t[tm] || 0) + l.points;
  return t;
}

/** "0" | "½" | "1" | "1½" — half-point friendly. */
export function fmtPt(v: number): string {
  if (v === 0) return "0";
  const w = Math.floor(v); const h = (v - w) >= 0.5;
  return (w ? String(w) : "") + (h ? "\u00bd" : "");
}

export interface LegConfig { scheme: string; metric: "pts" | "net"; points: Record<string, number> }
export const DEFAULT_LEG_CONFIG: LegConfig = { scheme: "sixes", metric: "pts", points: {} };

/** Default points for a leg when the organizer hasn't set one: total = 1, segment = 0 (view-only). */
export function legPoints(cfg: LegConfig, leg: Leg): number {
  const v = cfg.points?.[leg.k];
  return v != null ? v : 0;
}
