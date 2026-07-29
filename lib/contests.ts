// Side contests (closest-to-pin / longest drive / straightest) for large events.
// The whole model is ONE generic "measured contest": each entry is a single number at a hole,
// and the winner is that hole's min (better="low", e.g. CTP / straightest) or max (better="high",
// e.g. longest drive) over all non-voided entries. Entries are an APPEND-ONLY log, so this
// reduction must stay order-independent (commutative) — that is what makes offline / out-of-order
// sync at 80+ players conflict-free. Nothing here mutates; the leaderboard is always computed.

export type ContestKind = "ctp" | "long_drive" | "straightest" | "custom";
export type ContestDir = "low" | "high";           // low = min wins, high = max wins
export type ContestUnit = "ft_in" | "yards" | "ft_center";

export type Contest = {
  id: string;
  game_id: string;
  kind: ContestKind;
  label: string;
  holes: number[];        // hole numbers this contest applies to (CTP-all = every par-3)
  unit: ContestUnit;
  better: ContestDir;
  created_by?: string;
  created_at?: string;
};

export type ContestEntry = {
  id: string;
  contest_id: string;
  hole: number;
  player_id: string | null;   // game_players.user_id (null for a guest)
  guest_id: string | null;    // group_guests.id (null for a member)
  player_name: string;        // denormalized display name for the board
  value: number;              // canonical numeric: ft_in -> inches, yards -> yards, ft_center -> feet
  recorded_by: string;
  created_at: string;         // ISO; used ONLY as a deterministic tiebreaker (earliest wins)
  voided?: boolean;
};

export type HoleWinner = {
  hole: number;
  best: ContestEntry | null;  // null = no entries yet on this hole
  attempts: ContestEntry[];   // all non-voided entries on the hole, best-first
};

// Default config per kind — the USGA-adjacent conventions from the spec.
export function contestDefaults(kind: ContestKind): { label: string; unit: ContestUnit; better: ContestDir } {
  switch (kind) {
    case "ctp": return { label: "Closest to the pin", unit: "ft_in", better: "low" };
    case "long_drive": return { label: "Longest drive", unit: "yards", better: "high" };
    case "straightest": return { label: "Straightest drive", unit: "ft_center", better: "low" };
    default: return { label: "Contest", unit: "yards", better: "high" };
  }
}

// Par-3 hole numbers from the game's holes_meta ([{hole_number|hole, par}, ...] or par[]).
export function parThrees(holesMeta: any): number[] {
  if (!Array.isArray(holesMeta)) return [];
  const out: number[] = [];
  holesMeta.forEach((h: any, i: number) => {
    const par = typeof h === "number" ? h : (h?.par ?? null);
    const num = typeof h === "number" ? i + 1 : (h?.hole_number ?? h?.hole ?? i + 1);
    if (par === 3) out.push(num);
  });
  return out;
}

// Is one entry strictly better than another for this direction? (used with an earliest-wins tiebreaker)
function beats(a: ContestEntry, b: ContestEntry, dir: ContestDir): boolean {
  if (a.value !== b.value) return dir === "low" ? a.value < b.value : a.value > b.value;
  // tie on value -> the earlier-recorded attempt holds the position (deterministic, order-independent)
  return a.created_at < b.created_at;
}

// THE reduction. Order-independent: grouping + min/max + a total-order tiebreaker means any permutation
// or partial (offline) subset of the same entries yields the same winners.
export function contestLeaderboard(contest: Contest, entries: ContestEntry[]): HoleWinner[] {
  const holeSet = new Set(contest.holes);
  const byHole = new Map<number, ContestEntry[]>();
  for (const e of entries) {
    if (e.voided) continue;
    if (e.contest_id !== contest.id) continue;
    if (!holeSet.has(e.hole)) continue;
    if (typeof e.value !== "number" || Number.isNaN(e.value)) continue;
    (byHole.get(e.hole) ?? byHole.set(e.hole, []).get(e.hole)!).push(e);
  }
  return [...contest.holes].sort((a, b) => a - b).map((hole) => {
    const list = (byHole.get(hole) ?? []).slice().sort((a, b) => (beats(a, b, contest.better) ? -1 : 1));
    return { hole, best: list[0] ?? null, attempts: list };
  });
}

// For CTP-across-all-par-3s: who has won the most holes (optional overall view). Deterministic.
export function overallLeaders(board: HoleWinner[]): { key: string; name: string; holesWon: number }[] {
  const tally = new Map<string, { name: string; holesWon: number }>();
  for (const w of board) {
    if (!w.best) continue;
    const key = w.best.player_id ?? `guest:${w.best.guest_id}`;
    const cur = tally.get(key) ?? { name: w.best.player_name, holesWon: 0 };
    cur.holesWon += 1;
    tally.set(key, cur);
  }
  return [...tally.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.holesWon - a.holesWon || a.name.localeCompare(b.name));
}

// ---- value formatting / parsing (canonical numeric per unit) ----
export function fmtContestValue(unit: ContestUnit, value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (unit === "ft_in") {
    const total = Math.max(0, Math.round(value));
    const ft = Math.floor(total / 12);
    const inch = total % 12;
    return `${ft}'${inch}"`;
  }
  if (unit === "yards") return `${Math.round(value)} yd`;
  return `${Math.round(value)} ft`; // ft_center: feet from the centerline
}

// Build the canonical numeric from UI inputs.
export function ftInToInches(feet: number, inches: number): number {
  return Math.max(0, Math.round((Number(feet) || 0) * 12 + (Number(inches) || 0)));
}
