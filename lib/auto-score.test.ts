function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
function assert(v: unknown, m: string): asserts v { if (!v) throw new Error(m); }
import { autoScores, randomHoleScore } from "./auto-score";
const holes = Array.from({ length: 18 }, (_, i) => ({ par: [4,4,3,5,4,3,4,5,4,4,3,5,4,4,3,4,5,4][i] }));
let seed = 11; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
// fills 1..9, leaves 10..18 null, keeps an existing score
{
  const s = autoScores([null, 6, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null], holes, 9, rnd);
  eq(s.length, 18, "18 slots"); eq(s[1], 6, "existing score kept"); assert(s.slice(0, 9).every((x) => x != null && x > 0), "1..9 filled"); assert(s.slice(9).every((x) => x == null), "10..18 untouched");
}
// scores are within birdie..triple
for (let i = 0; i < 500; i++) { const v = randomHoleScore(4, rnd); assert(v >= 3 && v <= 7, `par-4 score ${v} out of range`); }
eq(randomHoleScore(3, () => 0.0), 2, "birdie at the low end"); eq(randomHoleScore(5, () => 0.99), 8, "triple at the high end");
console.log("auto-score tests passed");
