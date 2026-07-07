// Column-scoped sync helpers (pure, no imports). Group scoring keeps the gross score
// owned by the marker and the peripheral stats owned by each player, last-write-wins
// per column: a writer pushes ONLY the columns that differ from the confirmed-synced
// watermark, so the marker's background flush never clobbers a stat it didn't touch and
// a player never rewrites a score they don't own.
export type ScoreCol = "scores" | "putts" | "fairways" | "penalties" | "sand";
export const ALL_COLS: ScoreCol[] = ["scores", "putts", "fairways", "penalties", "sand"];
export const STAT_COLS: ScoreCol[] = ["putts", "fairways", "penalties", "sand"];

export function changedCols(
  body: { scores?: any[]; putts?: any[]; fairways?: any[]; penalties?: any[]; sand?: any[] },
  wm: { scores?: any[]; putts?: any[]; fairways?: any[]; penalties?: any[]; sand?: any[] } | null,
): ScoreCol[] {
  const w = wm || {};
  const same = (a?: any[], b?: any[]) => {
    const n = Math.max(a?.length || 0, b?.length || 0);
    for (let i = 0; i < n; i++) if ((a?.[i] ?? null) !== (b?.[i] ?? null)) return false;
    return true;
  };
  return ALL_COLS.filter((c) => !same((body as any)[c], (w as any)[c]));
}
export function pickCols(body: Record<string, any>, cols: ScoreCol[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const c of cols) out[c] = body[c] ?? [];
  return out;
}
