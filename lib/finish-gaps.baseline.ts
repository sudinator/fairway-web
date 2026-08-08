// BASELINE — computeFinishGaps / finishListFmt exactly as they were inlined in GameRoom
// (tournaments.tsx) BEFORE the extraction. Transcribed from the ORIGINAL source (only change:
// `game?.holes_meta` closure -> `holesMeta` param), independently of the new module, so the
// differential test would catch any transcription error in the new lib/finish-gaps.ts.
import type { Player, Game } from "./game-types";

export type FinishGap = { name: string; noScores: boolean; missScores: number[]; missPutts: number[]; missFw: number[] };

export const finishListFmt = (a: number[]) => (a.length > 8 ? `${a.length} holes` : a.join(", "));

export const computeFinishGaps = (scope: Player[], holesMeta: Game["holes_meta"]): FinishGap[] => {
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
};
