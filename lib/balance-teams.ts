// Balanced teams by handicap (203.0). Pure; tested.
//
// Basis: each player's Playing Handicap for THIS game — the engine's own chBasis × allowance,
// rounded (lib/golf applyAllowance) — because that is the number the match is played off, not the
// index. A player with no course handicap yet is placed last and counts as 0 so the function never
// refuses to run; the UI tells the organizer who was unplaced.
//
// Method: snake draft on descending playing handicap — A, B, B, A, A, B, B, A… — which keeps both
// the sums and the top-to-bottom spread close (the strongest and weakest players are split, not
// stacked). Ties keep roster order so a re-run gives the same answer. With more than two teams the
// snake runs across all of them. Players already locked to a team (scored) stay where they are and
// are counted in their team's total before the rest are dealt.
import { applyAllowance } from "./golf";
import { chBasis, pkey } from "./game-shape";

export type BalancePlayer = {
  id: string; user_id?: string | null; display_name: string;
  course_handicap?: number | null; handicap_index?: number | null; slope?: number | null; rating?: number | null;
  course_handicap_source?: "derived" | "manual" | null; team?: string | null; no_show?: boolean | null;
};
export type BalanceGame = { allowance_pct?: number | null; course_par?: number | null; holes_meta?: { n: number }[] | null; teams?: { key: string; name: string }[] | null };

export type BalanceResult = {
  /** New team per player id — only players whose team CHANGES are listed. */
  assignments: { id: string; team: string }[];
  /** Per team: members (after), sum and mean of playing handicaps. */
  teams: { key: string; name: string; members: string[]; total: number; mean: number }[];
  /** Players with no usable handicap: placed, but counted as 0. */
  unrated: string[];
};

export function playingHandicapOf(game: BalanceGame, p: BalancePlayer): number | null {
  if (p.course_handicap == null) return null;
  const ch = chBasis({ ...p, course_handicap: p.course_handicap, handicap_index: p.handicap_index ?? undefined, slope: p.slope ?? undefined, rating: p.rating ?? undefined, course_handicap_source: p.course_handicap_source ?? undefined }, game.course_par, game.holes_meta?.length);
  return applyAllowance(ch, game.allowance_pct ?? 100);
}

export function balanceTeams(game: BalanceGame, players: BalancePlayer[], lockedIds: Set<string> = new Set()): BalanceResult {
  const teams = (game.teams || []).filter((t) => t && t.key);
  const result: BalanceResult = { assignments: [], teams: [], unrated: [] };
  if (teams.length < 2) return result;
  const active = players.filter((p) => !p.no_show);
  const ph = new Map<string, number | null>(active.map((p) => [p.id, playingHandicapOf(game, p)]));
  for (const p of active) if (ph.get(p.id) == null) result.unrated.push(p.display_name);

  const totals = new Map<string, number>(teams.map((t) => [t.key, 0]));
  const members = new Map<string, string[]>(teams.map((t) => [t.key, []]));
  const next = new Map<string, string>();
  // Locked players first: they stay and count.
  for (const p of active) {
    if (lockedIds.has(p.id) && p.team && totals.has(p.team)) {
      next.set(p.id, p.team); totals.set(p.team, (totals.get(p.team) || 0) + (ph.get(p.id) ?? 0)); members.get(p.team)!.push(p.display_name);
    }
  }
  // The rest: descending playing handicap, ties by roster order; unrated last.
  const free = active.filter((p) => !next.has(p.id)).map((p, i) => ({ p, i, v: ph.get(p.id) }))
    .sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || a.i - b.i).map((x) => x.p);
  // Snake across the teams, but always give the next player to the team with the LOWEST total so
  // locked players and odd counts do not skew it; the snake order breaks ties between equal totals.
  const order: string[] = []; const n = teams.length;
  for (let round = 0; order.length < free.length; round++) {
    const seq = round % 2 === 0 ? teams.map((t) => t.key) : teams.map((t) => t.key).reverse();
    for (const k of seq) order.push(k);
  }
  free.forEach((p, idx) => {
    const preferred = order[idx];
    let target = preferred;
    for (const t of teams) if ((totals.get(t.key) || 0) < (totals.get(target) || 0) - 1e-9) target = t.key;
    next.set(p.id, target); totals.set(target, (totals.get(target) || 0) + (ph.get(p.id) ?? 0)); members.get(target)!.push(p.display_name);
  });
  for (const p of active) { const t = next.get(p.id); if (t && t !== (p.team ?? null)) result.assignments.push({ id: p.id, team: t }); }
  result.teams = teams.map((t) => { const m = members.get(t.key) || []; const total = Math.round((totals.get(t.key) || 0) * 10) / 10; return { key: t.key, name: t.name || t.key, members: m, total, mean: m.length ? Math.round((total / m.length) * 10) / 10 : 0 }; });
  return result;
}

/** "Red 61 (avg 12.2) · Blue 60 (avg 12.0) — difference 1". */
export function balanceSummary(r: BalanceResult): string {
  if (!r.teams.length) return "";
  const parts = r.teams.map((t) => `${t.name} ${t.total} (avg ${t.mean})`);
  const totals = r.teams.map((t) => t.total);
  const diff = Math.round((Math.max(...totals) - Math.min(...totals)) * 10) / 10;
  return `${parts.join(" · ")} — difference ${diff}`;
}
void pkey;
