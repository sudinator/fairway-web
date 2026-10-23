// 212.31 — REAL production data, game 494730 (stroke play, net, 100%), as Amit pulled it on Oct 23 2026, mid-round.
// The wrong answer the app gave: Nihar Vasavada (one hole played) "leading" Amit Sud (three holes) on raw net totals.
import type { Game, Player } from "./game-types";
export const HOLES_494730 = [
  { n: 1, si: 5, par: 4 }, { n: 2, si: 11, par: 3 }, { n: 3, si: 7, par: 4 }, { n: 4, si: 13, par: 4 }, { n: 5, si: 17, par: 3 },
  { n: 6, si: 1, par: 4 }, { n: 7, si: 15, par: 4 }, { n: 8, si: 9, par: 4 }, { n: 9, si: 3, par: 4 }, { n: 10, si: 10, par: 4 },
  { n: 11, si: 8, par: 4 }, { n: 12, si: 2, par: 4 }, { n: 13, si: 6, par: 4 }, { n: 14, si: 18, par: 3 }, { n: 15, si: 16, par: 5 },
  { n: 16, si: 4, par: 4 }, { n: 17, si: 14, par: 3 }, { n: 18, si: 12, par: 5 },
];
export const GAME_494730 = {
  id: "g494730", code: "494730", name: "494730", course: "C", game_type: "stroke", stroke_basis: "net", allowance_pct: 100,
  holes_meta: HOLES_494730, course_par: HOLES_494730.reduce((s, h) => s + h.par, 0), pairings: [], created_by: "u", created_at: "2026-10-23T00:00:00Z",
} as unknown as Game;
const N = null;
const row = (id: string, name: string, ch: number, hi: number, rating: number, slope: number, tee: string, played: (number | null)[]) =>
  ({ id, game_id: "g494730", user_id: id, display_name: name, course_handicap: ch, handicap_index: hi, rating, slope, tee_name: tee,
     scores: played.length ? [...played, ...Array(18 - played.length).fill(N)] : [], putts: [], fairways: [], no_show: false }) as unknown as Player;
export const PLAYERS_494730: Player[] = [
  row("amit", "Amit Sud", 20, 14.7, 72.3, 133, "Blue", [3, 2, 4]),
  row("ashutosh", "Ashutosh Rathore", 14, 9.7, 72.3, 133, "Blue", []),
  row("bk", "BK Jain", 22, 18, 70.7, 132, "White", []),
  row("karan", "Karan Sarin", 10, 6.4, 72.3, 133, "Blue", [5, N, N, 5]),
  row("nihar", "Nihar Vasavada", 23, 19.4, 70.7, 132, "White", [N, 4]),
  row("probir", "Probir Rao", 8, 5.1, 72.3, 133, "Blue", []),
  row("rahul", "Rahul Shah", 24, 19.6, 70.7, 132, "White", []),
  row("sanjay", "Sanjay Rijhwani", 20, 16.8, 70.7, 132, "White", [4, 5]),
];
