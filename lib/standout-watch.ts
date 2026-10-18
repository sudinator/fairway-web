// Standout watch (209.1, admin only): who beats the field most often this season — the same measure as the
// recap's standout rounds (lib/game-highlights), across every finished game of 8+ scored players.
// Owner rule: "worth a look" = 3+ standouts AND 1.5+ better than the field on average over 5+ rounds — a
// pattern, not one great day; a prompt to check whether an index is out of date, never an accusation.
export type WatchRound = { gameId: string; date: string; course: string; better: number };
export type WatchRow = { userId: string; name: string; rounds: number; standouts: number; avgBetter: number; worthALook: boolean; detail: WatchRound[] };

export const WATCH_RULE = { minStandouts: 3, minAvgBetter: 1.5, minRounds: 5, standoutBetter: 2 } as const;

export function summarizeWatch(games: { gameId: string; date: string; course: string; fieldRows: { name: string; userId: string | null; better: number }[] }[]): WatchRow[] {
  const by = new Map<string, WatchRow>();
  for (const g of games) for (const r of g.fieldRows) {
    if (!r.userId) continue;   // members only — guests have no account to look at
    const row = by.get(r.userId) || { userId: r.userId, name: r.name, rounds: 0, standouts: 0, avgBetter: 0, worthALook: false, detail: [] };
    row.detail.push({ gameId: g.gameId, date: g.date, course: g.course, better: r.better });
    by.set(r.userId, row);
  }
  return [...by.values()].map((row) => {
    const rounds = row.detail.length, standouts = row.detail.filter((d) => d.better >= WATCH_RULE.standoutBetter).length;
    const avgBetter = Math.round((row.detail.reduce((s, d) => s + d.better, 0) / rounds) * 10) / 10;
    return { ...row, rounds, standouts, avgBetter, detail: row.detail.sort((a, b) => b.date.localeCompare(a.date)),
      worthALook: rounds >= WATCH_RULE.minRounds && standouts >= WATCH_RULE.minStandouts && avgBetter >= WATCH_RULE.minAvgBetter };
  }).sort((a, b) => Number(b.worthALook) - Number(a.worthALook) || b.avgBetter - a.avgBetter || a.name.localeCompare(b.name));
}
