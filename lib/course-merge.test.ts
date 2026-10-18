function eq(a: unknown, b: unknown, m: string) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m}: expected ${y}, got ${x}`); }
function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
import { changeItems, mergeSelected, withoutDeclined, declinedFor } from "./course-merge";
import type { Course } from "./courses";
// 209.1: choose which provider changes to apply.
const holes = (si: number[], pars: number[] = Array(18).fill(4)) => si.map((s, i) => ({ n: i + 1, par: pars[i], si: s }));
const baseSi = Array.from({ length: 18 }, (_, i) => i + 1);
const yds = (v: number) => Array(18).fill(v);
// The provider's LAST version (from course history): hole 5 par 4. Someone later corrected hole 5 to par 5 by hand.
const lastProvider: Course = { id: "c", name: "Oak Hollow", location: "", tees: [
  { name: "Blue", rating: 71.2, slope: 125, par: 72, yardages: yds(400) }, { name: "White", rating: 70.1, slope: 120, par: 72, yardages: yds(370) }, { name: "Red", rating: 68, slope: 112, par: 72 }],
  holes: holes(baseSi) };
const stored: Course = { ...lastProvider, holes: holes(baseSi, baseSi.map((_, i) => (i === 4 ? 5 : 4))) };
// The provider now: Blue slope 128; White rating 70.4 and new yardages; Gold added; Red removed; stroke indexes of holes 3 and 7 swapped; hole 5 par 4.
const swapped = [...baseSi]; swapped[2] = 7; swapped[6] = 3;
const api: Course = { ...lastProvider, tees: [
  { name: "Blue", rating: 71.2, slope: 128, par: 72, yardages: yds(400) }, { name: "White", rating: 70.4, slope: 120, par: 72, yardages: yds(375) },
  { name: "Gold", rating: 66.8, slope: 117, par: 72, yardages: yds(300) }], holes: holes(swapped) };

const items = changeItems(stored, api, lastProvider);
const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
eq(items.map((i) => i.key).sort(), ["par:5", "rating:white", "si", "slope:blue", "tee_add:gold", "tee_remove:red", "yardages:white"], "every change, stroke indexes as ONE item");
eq(byKey["si"].detail, "3: 3 → 7 · 7: 7 → 3", "the swap shown as one item");
eq(byKey["par:5"].handCorrected && !byKey["par:5"].defaultOn, true, "a hand-corrected par starts unticked");
eq(byKey["tee_remove:red"].defaultOn, false, "a removed tee starts unticked");
eq(["slope:blue", "rating:white", "yardages:white", "tee_add:gold", "si"].every((k) => byKey[k].defaultOn), true, "everything else starts ticked");

// Apply only the defaults.
const picked = items.filter((i) => i.defaultOn).map((i) => i.key);
const m = mergeSelected(stored, api, picked, items);
eq(m.tees.find((t) => t.name === "Blue")!.slope, 128, "Blue slope taken");
eq(m.tees.find((t) => t.name === "White")!.rating, 70.4, "White rating taken");
eq(m.tees.find((t) => t.name === "White")!.yardages![0], 375, "White yardages taken");
ok(m.tees.some((t) => t.name === "Gold"), "Gold added");
ok(m.tees.some((t) => t.name === "Red"), "Red kept (removal not ticked)");
eq(m.holes[4].par, 5, "the hand correction is kept");
eq([...m.holes.map((h) => h.si)].sort((a, b) => a! - b!), baseSi, "stroke indexes still 1–18, each once");
eq([m.holes[2].si, m.holes[6].si], [7, 3], "the swap applied as a whole");
eq(stored.tees.find((t) => t.name === "Blue")!.slope, 125, "the stored course itself is untouched");
// Nothing outside the offer.
let threw = false; try { mergeSelected(stored, api, ["slope:green"], items); } catch { threw = true; }
ok(threw, "a change that wasn't offered is refused");
// Leaving SI unticked keeps today's indexes.
eq(mergeSelected(stored, api, ["slope:blue"], items).holes.map((h) => h.si), baseSi, "stroke indexes unchanged when not ticked");

// Declines are remembered and skipped — until the provider changes that value again.
const declined = declinedFor(items, picked);
eq(Object.keys(declined).sort(), ["par:5", "tee_remove:red"], "the unticked items are remembered");
eq(withoutDeclined(items, declined).map((i) => i.key).includes("par:5"), false, "a declined change isn't offered again");
const api2: Course = { ...api, holes: api.holes.map((h, i) => (i === 4 ? { ...h, par: 3 } : h)) };
const again = withoutDeclined(changeItems(stored, api2, lastProvider), declined);
ok(again.some((i) => i.key === "par:5" && i.apiValue === 3), "…but it is, once the provider's value changes");
console.log("course-merge tests passed");
