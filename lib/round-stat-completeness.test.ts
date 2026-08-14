import { roundStatCompleteness, statHoleList } from "./round-stats";
import type { Hole } from "./golf";

let pass = 0, fail = 0;
function ok(cond: boolean, name: string) { if (cond) pass++; else { fail++; console.error(`FAIL: ${name}`); } }
function holes(puttsMissing: number[] = [], fairwaysMissing: number[] = [], playedCount = 18): Hole[] {
  return Array.from({ length: 18 }, (_, i) => {
    const n = i + 1;
    const played = n <= playedCount;
    const par = n % 3 === 0 ? 3 : 4;
    return {
      hole_number: n, par, stroke_index: n, strokes: played ? 4 : null,
      putts: played && !puttsMissing.includes(n) ? 2 : null,
      fairway: played && par >= 4 && !fairwaysMissing.includes(n) ? "hit" : null, penalties: 0,
    } as Hole;
  });
}

let x = roundStatCompleteness(holes());
ok(x.puttsRoundEligible && !x.shouldNudgePutts, "18/18 putts qualifies with no nudge");

x = roundStatCompleteness(holes([17]));
ok(!x.puttsRoundEligible && x.shouldNudgePutts && x.missingPutts.join(",") === "17", "17/18 excluded and nudged with exact hole");

x = roundStatCompleteness(holes([15, 16, 17]));
ok(!x.puttsRoundEligible && x.shouldNudgePutts && statHoleList(x.missingPutts) === "15, 16, 17", "15/18 excluded and nudged");

x = roundStatCompleteness(holes([14, 15, 16, 17]));
ok(!x.puttsRoundEligible && !x.shouldNudgePutts, "14/18 excluded without prominent nudge");

x = roundStatCompleteness(holes([10,11,12,13,14,15,16,17,18]));
ok(!x.puttsRoundEligible && !x.shouldNudgePutts, "9/18 excluded without nudge");

x = roundStatCompleteness(holes(Array.from({length:18}, (_,i)=>i+1)));
ok(!x.puttsRoundEligible && !x.shouldNudgePutts, "0/18 excluded without nudge");

x = roundStatCompleteness(holes([], [], 15));
ok(!x.puttsRoundEligible && !x.shouldNudgePutts && x.puttHoles === 15, "15-hole partial round not eligible for total-round putting");

x = roundStatCompleteness(holes([], [1,2,4]));
ok(x.missingFairways.every((n) => n % 3 !== 0), "fairway completeness excludes par 3s");

console.log(`round stat completeness: ${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} round stat completeness checks failed`);
