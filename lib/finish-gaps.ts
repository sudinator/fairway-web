import type { Player, Game } from "./game-types";

export type FinishGap = { name: string; noScores: boolean; missScores: number[]; missPutts: number[]; missFw: number[] };

// Format a list of hole numbers for the "you're still missing X" prompt; collapse past 8.
export function finishListFmt(a: number[]): string {
  return a.length > 8 ? `${a.length} holes` : a.join(", ");
}

// For each player in scope, what's still MISSING before finishing: no scores at all, holes without a
// score, and — only if the group tracks putts/fairways — putts on played holes and fairways on played
// par-4+ holes. No-shows are skipped. Pure given the players + the course's holes_meta.
export function computeFinishGaps(scope: Player[], holesMeta: Game["holes_meta"]): FinishGap[] {
  const meta = holesMeta || [];
  const out: FinishGap[] = [];
  for (const pl of scope) {
    if (pl.no_show) continue;
    const sc = pl.scores || []; const pu = pl.putts || []; const fw = pl.fairways || [];
    const cells = meta.map((m, i) => ({ i, par: m.par, n: m.n, s: sc[i] }));
    const entered = cells.filter((c) => c.s != null && (c.s as number) > 0);
    if (entered.length === 0) { out.push({ name: pl.display_name, noScores: true, missScores: [], missPutts: [], missFw: [] }); continue; }
    const missScores = cells.filter((c) => c.s == null || (c.s as number) <= 0).map((c) => c.n);
    const tracks = pu.some((v) => v != null) || fw.some((v) => v != null);
    const missPutts = tracks ? entered.filter((c) => pu[c.i] == null).map((c) => c.n) : [];
    const missFw = tracks ? entered.filter((c) => c.par >= 4 && fw[c.i] == null).map((c) => c.n) : [];
    if (missScores.length || missPutts.length || missFw.length) out.push({ name: pl.display_name, noScores: false, missScores, missPutts, missFw });
  }
  return out;
}
