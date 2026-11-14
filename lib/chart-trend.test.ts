import { recentForm, sampleAverage, trendSummary, RECENT_FORM_WEIGHT, type TrendSample } from "./chart-trend";
let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(name, { got, want }); }
}
function near(name: string, got: number | null, want: number) {
  eq(name, got != null && Math.abs(got - want) < 1e-9, true);
}
const scalar = (xs: number[]) => xs.map(value => ({ value }));
eq("approved weight", RECENT_FORM_WEIGHT, 0.2);
eq("empty", recentForm([]), []);
eq("no average", sampleAverage([]), null);
eq("single seed", recentForm(scalar([16])), [16]);
near("20 percent new round", recentForm(scalar([16, 12]))[1], 15.2);
eq("zero and plus-handicap values remain", recentForm(scalar([0, -5])), [0, -1]);
for (const v of recentForm(scalar([12, 12, 12]))) near("constant", v, 12);
const invalid = [{ value: NaN }, { value: 16 }, { value: Infinity }, { value: 12 }];
eq("invalid entries remain missing", recentForm(invalid).filter(x => x == null).length, 2);
near("invalid entries do not age the trend", recentForm(invalid)[3], 15.2);
const rate = [{ value: 100, hit: 1, total: 1 }, { value: 20, hit: 1, total: 5 }];
near("pool percentage opportunities", sampleAverage(rate, true), 100 / 3);
near("decay successes/opportunities separately", recentForm(rate, true)[1], 100 / 1.8);
eq("zero opportunities not a miss", recentForm([{ value: 0, hit: 0, total: 0 }], true), [null]);
eq("impossible rates excluded", recentForm([{ value: 50, hit: 2, total: 1 }, { value: 50, hit: -1, total: 2 }], true), [null, null]);
for (let n = 1; n <= 100; n++) {
  const xs = Array.from({ length: n }, (_, i) => Math.sin(i * 13) * 25);
  const input = scalar(xs), copy = JSON.stringify(input), result = recentForm(input);
  // Independent closed-form oracle: first seed retains 0.8^i, later values get 0.2*0.8^age.
  for (let i = 0; i < n; i++) {
    const expected = xs[0] * Math.pow(0.8, i) + xs.slice(1, i + 1).reduce((s, x, j) => s + 0.2 * Math.pow(0.8, i - j - 1) * x, 0);
    near("closed form " + n + "/" + i, result[i], expected);
  }
  eq("inputs unchanged " + n, JSON.stringify(input), copy);
  const summary = trendSummary(input, true);
  eq("eligible count " + n, summary.count, n);
  eq("comparison only with ten rounds " + n, summary.prior != null, n >= 10);
  near("simple last-five headline " + n, summary.latest, xs.slice(-5).reduce((s, x) => s + x, 0) / Math.min(n, 5));
}
const fixture = scalar([19, 16, 17, 16.5, 18, 14, 15, 16, 14.5, 18]);
const summary = trendSummary(fixture, true);
near("latest five", summary.latest, 15.5);
near("preceding five", summary.prior, 17.3);
near("lower better sign", summary.improvement, 1.8);
near("higher better sign", trendSummary(fixture, false).improvement, -1.8);
eq("five available does not compare with its own partial history", trendSummary(fixture.slice(0, 5), true).prior, null);
eq("unknown values excluded from window", trendSummary([...fixture, { value: NaN }], true).lastCount, 5);
const variable: TrendSample[] = Array.from({ length: 40 }, (_, i) => ({ value: 100 * (i % 4) / 4, hit: i % 4, total: 4 }));
for (let i = 0; i < variable.length; i++) near("equal denominators match scalar EMA " + i, recentForm(variable, true)[i], recentForm(variable)[i]!);
eq("retry produces identical series", recentForm(fixture), recentForm(fixture));
eq("switch A B A restores original results", recentForm(fixture), recentForm(fixture));
const older = scalar([10, 20, 10]), changed = scalar([10, 30, 10]);
near("edit an older round recomputes later values", recentForm(changed)[2]! - recentForm(older)[2]!, 1.6);
console.log(`chart-trend: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
