import { computeFinishGaps, finishListFmt } from "./finish-gaps";
import type { Player, Game } from "./game-types";

let pass = 0, fail = 0; const fails: string[] = [];
function eq<T>(name: string, got: T, want: T) { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) pass++; else { fail++; fails.push(`${name} (got ${g}, want ${w})`); } }

const meta = [{ n: 1, par: 4, si: 1 }, { n: 2, par: 3, si: 2 }, { n: 3, par: 5, si: 3 }] as Game["holes_meta"];
function P(o: Partial<Player>): Player {
  return { id: "p", game_id: "g", user_id: "u", display_name: "A", handicap_index: null, rating: null, slope: null, tee_name: "W", course_handicap: 0, scores: [], putts: [], fairways: [], ...o } as Player;
}

// finishListFmt — all branches
eq("fmt empty", finishListFmt([]), "");
eq("fmt one", finishListFmt([3]), "3");
eq("fmt few", finishListFmt([3, 5, 7]), "3, 5, 7");
eq("fmt eight joined", finishListFmt([1, 2, 3, 4, 5, 6, 7, 8]), "1, 2, 3, 4, 5, 6, 7, 8");
eq("fmt nine collapses", finishListFmt([1, 2, 3, 4, 5, 6, 7, 8, 9]), "9 holes");

// computeFinishGaps — every path
eq("no_show skipped", computeFinishGaps([P({ no_show: true, scores: [null, null, null] })], meta), []);
eq("no scores -> noScores", computeFinishGaps([P({ display_name: "B", scores: [null, null, null] })], meta),
  [{ name: "B", noScores: true, missScores: [], missPutts: [], missFw: [] }]);
eq("complete no tracking -> none", computeFinishGaps([P({ scores: [4, 3, 5] })], meta), []);
eq("missing score", computeFinishGaps([P({ display_name: "C", scores: [4, null, 5] })], meta),
  [{ name: "C", noScores: false, missScores: [2], missPutts: [], missFw: [] }]);
eq("missing putt (tracked)", computeFinishGaps([P({ display_name: "D", scores: [4, 3, 5], putts: [2, null, 2], fairways: ["hit", "hit", "hit"] })], meta),
  [{ name: "D", noScores: false, missScores: [], missPutts: [2], missFw: [] }]);
eq("missing fw par4+ only", computeFinishGaps([P({ display_name: "E", scores: [4, 3, 5], putts: [2, 2, 2], fairways: [null, null, "hit"] })], meta),
  [{ name: "E", noScores: false, missScores: [], missPutts: [], missFw: [1] }]);
eq("complete + tracked -> none", computeFinishGaps([P({ scores: [4, 3, 5], putts: [2, 2, 2], fairways: ["hit", "left", "hit"] })], meta), []);
eq("no tracking ignores missing stats", computeFinishGaps([P({ scores: [4, 3, 5], putts: [], fairways: [] })], meta), []);
eq("combined gaps", computeFinishGaps([P({ display_name: "F", scores: [4, null, 5], putts: [2, 2, null], fairways: [null, "left", "hit"] })], meta),
  [{ name: "F", noScores: false, missScores: [2], missPutts: [3], missFw: [1] }]);
{
  const r = computeFinishGaps([P({ display_name: "X", scores: [null, null, null] }), P({ display_name: "Y", scores: [4, 3, 5] }), P({ display_name: "Z", scores: [4, null, 5] })], meta);
  eq("multi: only X and Z", r.map((g) => g.name), ["X", "Z"]);
  eq("multi X noScores", r[0].noScores, true);
  eq("multi Z missScores", r[1].missScores, [2]);
}
eq("empty scope -> []", computeFinishGaps([], meta), []);

console.log(`finish-gaps: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
