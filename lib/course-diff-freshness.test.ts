function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
import { buildFreshnessDiff, validateProviderCourse } from "./course-diff";
import type { Course } from "./courses";
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const base: Course = { id: "c", name: "X", location: "", tees: [{ name: "Blue", rating: 70, slope: 125, par: 72, yardages: [] }], holes };
const clone = (c: Course): Course => JSON.parse(JSON.stringify(c));
eq(buildFreshnessDiff(base, clone(base)).hasChanges, false, "identical: unchanged");
// Review finding 3: each of these read "unchanged" before.
{ const a = clone(base); a.tees.push({ name: "Gold", rating: 72, slope: 130, par: 72, yardages: [] });
  const d = buildFreshnessDiff(base, a); eq(d.hasChanges, true, "tee added is a change"); eq(d.teesAdded?.[0], "Gold", "names the added tee"); }
{ const a = clone(base); a.tees = [{ name: "White", rating: 68, slope: 118, par: 72, yardages: [] }];
  const d = buildFreshnessDiff(base, a); eq(d.teesRemoved?.[0], "Blue", "tee removed is a change"); }
{ const a = clone(base); a.holes[6].par = 5; const d = buildFreshnessDiff(base, a); eq(d.hasChanges, true, "par change is a change"); eq(d.holeChanges?.[0].hole, 7, "names the hole"); }
{ const a = clone(base); a.holes[0].si = 2; a.holes[1].si = 1; eq(buildFreshnessDiff(base, a).holeChanges?.length, 2, "stroke-index swap is a change"); }
// Completeness
eq(validateProviderCourse(clone(base)).length, 0, "complete course validates");
{ const a = clone(base); a.holes = a.holes.slice(0, 12); eq(validateProviderCourse(a).length > 0, true, "12 holes is incomplete"); }
{ const a = clone(base); a.holes[3].si = null; eq(validateProviderCourse(a).some((p) => p.includes("hole 4")), true, "missing SI named"); }
{ const a = clone(base); (a.tees[0] as any).slope = null; eq(validateProviderCourse(a).some((p) => p.includes("slope")), true, "missing slope named"); }
eq(validateProviderCourse(null)[0], "no course in the provider's response", "no course");
console.log("course freshness diff tests passed");
