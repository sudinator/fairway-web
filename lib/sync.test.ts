import { changedCols, pickCols } from "./sync-cols";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.log("FAIL " + n); } };
const eqSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

const wm = { scores: [4, 5], putts: [2, 2], fairways: ["hit", null], penalties: [0, 0], sand: [false, false] };

// No change → nothing to write.
ok("identical body → no changed cols", changedCols({ ...wm }, wm).length === 0);
// Player edits only a putt → only 'putts' changes; score never appears.
ok("putt edit → only putts", eqSet(changedCols({ ...wm, putts: [1, 2] }, wm), ["putts"]));
// Marker enters a score → only 'scores' changes; stats untouched so they aren't rewritten.
ok("score edit → only scores", eqSet(changedCols({ ...wm, scores: [4, 6] }, wm), ["scores"]));
// Fresh row (no watermark): every non-empty col counts.
ok("no watermark → all present cols", eqSet(changedCols({ scores: [4], putts: [2] }, null), ["scores", "putts"]));
// Two cols change at once.
ok("putt + fairway", eqSet(changedCols({ ...wm, putts: [1, 2], fairways: ["miss", null] }, wm), ["putts", "fairways"]));
// pickCols returns only the requested columns.
const picked = pickCols({ scores: [4, 6], putts: [1, 2], fairways: [], penalties: [], sand: [] }, ["putts"]);
ok("pickCols keeps only putts", Object.keys(picked).length === 1 && (picked.putts as any[])[0] === 1);

console.log(`sync/column tests: PASS ${pass}  FAIL ${fail}`);
