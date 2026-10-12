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
  // EQUAL NUMBERS come first (203.4): every team gets the same count, or one apart when the field
  // does not divide. "Hand the next player to the lighter side" alone broke this on a skewed field
  // (a 30 against three 2s put one player on one side and three on the other). Capacities are set
  // up front, the snake deals into teams with room — preferring the lighter side among those — and a
  // swap pass then improves the handicap balance WITHOUT changing counts.
  const n = teams.length;
  const totalCount = active.length;
  const base = Math.floor(totalCount / n);
  const extra = totalCount - base * n;
  const capacity = new Map<string, number>(teams.map((t, i) => [t.key, base + (i < extra ? 1 : 0)]));
  const count = new Map<string, number>(teams.map((t) => [t.key, (members.get(t.key) || []).length]));
  const order: string[] = [];
  for (let round = 0; order.length < free.length + teams.length; round++) {
    const seq = round % 2 === 0 ? teams.map((t) => t.key) : teams.map((t) => t.key).reverse();
    for (const k of seq) order.push(k);
  }
  const assigned = new Map<string, BalancePlayer[]>(teams.map((t) => [t.key, []]));
  free.forEach((p, idx) => {
    const withRoom = teams.map((t) => t.key).filter((k) => (count.get(k) || 0) < (capacity.get(k) || 0));
    let target = withRoom.includes(order[idx]) ? order[idx] : withRoom[0];
    for (const k of withRoom) if ((totals.get(k) || 0) < (totals.get(target) || 0) - 1e-9) target = k;
    if (!target) target = teams[0].key; // more locked players than capacity: nothing better to do
    next.set(p.id, target); totals.set(target, (totals.get(target) || 0) + (ph.get(p.id) ?? 0)); count.set(target, (count.get(target) || 0) + 1);
    members.get(target)!.push(p.display_name); assigned.get(target)!.push(p);
  });
  // Swap pass (two teams): exchange one unlocked player from each side while it narrows the gap.
  if (n === 2) {
    const [a, b] = teams.map((t) => t.key);
    let improved = true, guard = 0;
    while (improved && guard++ < 200) {
      improved = false;
      const gap = Math.abs((totals.get(a) || 0) - (totals.get(b) || 0));
      let bestGain = 1e-9, bestPair: [BalancePlayer, BalancePlayer] | null = null;
      for (const pa of assigned.get(a)!) for (const pb of assigned.get(b)!) {
        const va = ph.get(pa.id) ?? 0, vb = ph.get(pb.id) ?? 0;
        const newGap = Math.abs(((totals.get(a) || 0) - va + vb) - ((totals.get(b) || 0) - vb + va));
        const gain = gap - newGap;
        if (gain > bestGain) { bestGain = gain; bestPair = [pa, pb]; }
      }
      if (bestPair) {
        const [pa, pb] = bestPair; const va = ph.get(pa.id) ?? 0, vb = ph.get(pb.id) ?? 0;
        totals.set(a, (totals.get(a) || 0) - va + vb); totals.set(b, (totals.get(b) || 0) - vb + va);
        assigned.set(a, assigned.get(a)!.filter((x) => x !== pa).concat(pb)); assigned.set(b, assigned.get(b)!.filter((x) => x !== pb).concat(pa));
        next.set(pa.id, b); next.set(pb.id, a); improved = true;
      }
    }
    for (const t of teams) members.set(t.key, [...active.filter((p) => lockedIds.has(p.id) && next.get(p.id) === t.key).map((p) => p.display_name), ...assigned.get(t.key)!.map((p) => p.display_name)]);
  }
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
