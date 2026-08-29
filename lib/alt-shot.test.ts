/**
 * Alternate shot (foursomes) match play.
 *
 * The cases here are the ones that decide real matches: the half-stroke rounding on a team
 * handicap, a hole that is not yet played versus one genuinely halved, and a match closing early
 * so the remaining holes are never walked.
 */
import {
  altShotTeamHandicap,
  altShotEffectiveHandicap,
  altShotMatchStrokes,
  altShotTeeOrder,
  altShotDrivers,
  altShotNet,
  altShotHoleResult,
  altShotMatch,
  altShotPostsRounds,
} from "./alt-shot";

let pass = 0;
let fail = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean) => {
  if (cond) pass++;
  else {
    fail++;
    fails.push("FAIL " + name);
  }
};
const eq = <T,>(name: string, a: T, b: T) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else {
    fail++;
    fails.push(`FAIL ${name}\n     expected ${JSON.stringify(b)}\n     actual   ${JSON.stringify(a)}`);
  }
};

// ── team handicap: 50% of the combined Course Handicaps ────────────────────
const th = (a: number | null, b: number | null) => altShotTeamHandicap(a, b).value;
eq("14 + 10 -> 12", th(14, 10), 12);
eq("8 + 20 -> 14", th(8, 20), 14);
// The team handicap stays EXACT. 25/2 is 12.5, not 13 — rounding here and again at the
// difference loses a stroke, which is enough to decide a match.
eq("13 + 12 -> 12.5, unrounded", th(13, 12), 12.5);
eq("scratch pair -> 0", th(0, 0), 0);

// The worked example from the golf press: combined 28 vs combined 15.
{
  const A = altShotTeamHandicap(20, 8).value;   // 14
  const B = altShotTeamHandicap(10, 5).value;   // 7.5
  eq("team A off 14", A, 14);
  eq("team B off 7.5, NOT 8", B, 7.5);
  // 14 - 7.5 = 6.5, rounds up to 7. Pre-rounding B to 8 would give 6 — a stroke short.
  eq("A receives 7 strokes", altShotMatchStrokes(A, B), { receiving: "a", strokes: 7 });
}
ok("both known -> nothing missing", altShotTeamHandicap(14, 10).missing.length === 0);

// A missing handicap is REPORTED, never guessed. Counting a 20-handicapper as scratch would turn
// a team handicap of 17 into 7 and hand the other side ten strokes, with nothing on screen to say
// so. The organiser is told which partner, and chooses.
{
  const t = altShotTeamHandicap(14, null);
  eq("missing partner -> no value", t.value, null);
  eq("names WHICH partner is missing", t.missing, [1]);
  eq("offers the scratch figure", t.ifScratch, 7);
  // Unresolved means NO strokes, not the wrong strokes: an unhandicapped match is visible on the
  // card, a subtly skewed one is not.
  eq("unresolved -> no strokes", altShotEffectiveHandicap(t), null);
  // ...unless the organiser accepts it deliberately.
  eq("organiser accepts scratch -> 7", altShotEffectiveHandicap(t, true), 7);
}
{
  const t = altShotTeamHandicap(null, null);
  eq("both missing -> no value", t.value, null);
  eq("names both partners", t.missing, [0, 1]);
  eq("both missing at scratch -> 0", altShotEffectiveHandicap(t, true), 0);
}
{
  // A known handicap is never overridden by the scratch fallback.
  const t = altShotTeamHandicap(14, 10);
  eq("known value ignores the fallback flag", altShotEffectiveHandicap(t, true), 12);
}

// ── match strokes: only the DIFFERENCE matters ─────────────────────────────
eq("14 vs 7 -> A gets 7", altShotMatchStrokes(14, 7), { receiving: "a", strokes: 7 });
// A half-stroke difference rounds up; a quarter would round down. Only whole strokes are given.
eq("12.5 vs 12 -> A gets 1", altShotMatchStrokes(12.5, 12), { receiving: "a", strokes: 1 });
eq("12.5 vs 12.5 -> scratch", altShotMatchStrokes(12.5, 12.5), { receiving: null, strokes: 0 });
eq("7 vs 14 -> B gets 7", altShotMatchStrokes(7, 14), { receiving: "b", strokes: 7 });
eq("equal -> nobody receives", altShotMatchStrokes(12, 12), { receiving: null, strokes: 0 });
// High absolute handicaps with no difference still means scratch — the figures themselves are
// irrelevant in match play, only the gap between them.
eq("28 vs 28 -> scratch", altShotMatchStrokes(28, 28), { receiving: null, strokes: 0 });
eq("null side -> nobody receives", altShotMatchStrokes(null, 12), { receiving: null, strokes: 0 });

// ── tee order: odd/even, fixed for the round ───────────────────────────────
{
  const side = { playerIds: ["amit", "bryan"] as [string, string] };
  eq("hole 1 -> the odd-hole player", altShotTeeOrder(side, "amit", 1), "amit");
  eq("hole 2 -> the partner", altShotTeeOrder(side, "amit", 2), "bryan");
  eq("hole 17 -> still the odd-hole player", altShotTeeOrder(side, "amit", 17), "amit");
  eq("hole 18 -> still the partner", altShotTeeOrder(side, "amit", 18), "bryan");
  // Nominating the second partner simply swaps the pattern.
  eq("bryan on odds -> hole 1 is bryan", altShotTeeOrder(side, "bryan", 1), "bryan");
  eq("bryan on odds -> hole 2 is amit", altShotTeeOrder(side, "bryan", 2), "amit");
}


// ── who drives: the FIRST HOLE PLAYED, then alternating ──────────────────
// Keyed to POSITION in the round, not to the hole number. A back nine opens at hole 10, and parity
// on the number would make the second partner drive first there — which nobody expects and which
// an earlier version of this did. The nomination is "who tees off first", full stop.
{
  const side = ["amit", "bryan"];
  eq("first hole played: the first listed partner", altShotDrivers(side, 0)?.driver, "amit");
  eq("second hole played: the other", altShotDrivers(side, 1)?.driver, "bryan");
  eq("ninth hole played", altShotDrivers(side, 8)?.driver, "amit");
  eq("eighteenth hole played", altShotDrivers(side, 17)?.driver, "bryan");
  // The partner is reported too, so a reminder names both without a second lookup.
  eq("names the partner", altShotDrivers(side, 0)?.other, "bryan");
}
{
  // The point of the change: a BACK NINE must open with the same partner as a front nine.
  // Position 0 is hole 10 there, and hole 1 on the front. Both give the first listed partner.
  const side = ["amit", "bryan"];
  eq("a back nine opens with the SAME partner as a front nine", altShotDrivers(side, 0)?.driver, "amit");
  // And an 18-hole round agrees with both.
  eq("an eighteen opens the same way", altShotDrivers(side, 0)?.driver, "amit");
}
{
  // A side that is not exactly two is not a pair; naming a driver would invent information.
  eq("a side of one", altShotDrivers(["solo"], 0), null);
  eq("a side of three", altShotDrivers(["a", "b", "c"], 0), null);
  eq("no side at all", altShotDrivers(null, 0), null);
  eq("an empty side", altShotDrivers([], 0), null);
}

// ── net, and the hole result ───────────────────────────────────────────────
eq("gross 5 less 1 stroke -> 4", altShotNet(5, 1), 4);
eq("no gross -> no net", altShotNet(null, 1), null);

eq("lower net wins", altShotHoleResult(4, 0, 5, 0), "a");
eq("stroke received flips the hole", altShotHoleResult(5, 1, 4, 0), "halved");
eq("stroke received wins the hole", altShotHoleResult(5, 2, 4, 0), "a");
eq("equal net is halved", altShotHoleResult(4, 0, 4, 0), "halved");
// An unplayed hole is NOT a half. Conflating them shows a lead that has not been played.
eq("one side unplayed -> no result", altShotHoleResult(4, 0, null, 0), null);
eq("neither played -> no result", altShotHoleResult(null, 0, null, 0), null);

// ── the match ──────────────────────────────────────────────────────────────
{
  const fresh = altShotMatch([]);
  eq("no holes -> all square", fresh.label, "All square");
  eq("no holes -> 18 remaining", fresh.holesRemaining, 18);
  ok("no holes -> not decided", !fresh.decided);
}
{
  // A up on 1 and 3, halved 2 — two up after three.
  const m = altShotMatch(["a", "halved", "a"]);
  eq("2 up after three", m.label, "2 up");
  eq("three holes played", m.holesPlayed, 3);
  ok("not decided with 15 to play", !m.decided);
}
{
  // A wins the first four, then halves. The match closes at hole 15, not 16: 4 up with 3 to
  // play is already over, because B winning all three still leaves A one up.
  const results = ["a", "a", "a", "a", ...Array(12).fill("halved")] as never[];
  const m = altShotMatch(results);
  eq("closes 4 & 3", m.label, "4 & 3");
  ok("decided", m.decided);
}
{
  // Goes the distance: A wins 1, everything else halved. 1 up after 18.
  const results = ["a", ...Array(17).fill("halved")] as never[];
  const m = altShotMatch(results);
  eq("1 up after eighteen", m.label, "1 up");
  // `decided` means the match is OVER, which it is at the last hole — it does not mean
  // "closed out early". The label is what distinguishes the two: "1 up", never "1 & 0".
  ok("a match won on the last hole is still decided", m.decided);
  ok("and reads as 'N up', not 'N & 0'", !m.label.includes("&"));
  eq("nothing remaining", m.holesRemaining, 0);
}
{
  // All square after 18 is Halved, not "0 up".
  const m = altShotMatch(Array(18).fill("halved") as never[]);
  eq("all square after eighteen -> Halved", m.label, "Halved");
}
{
  // B leads: the lead is negative but the label never shows a minus.
  const m = altShotMatch(["b", "b", "halved"]);
  eq("B two up reads as 2 up", m.label, "2 up");
  eq("lead is negative for B", m.lead, -2);
}
{
  // Nine holes, A three up after five. NOT over: four remain, so B can still square it.
  // The shorter match makes the "lead must EXCEED holes remaining" rule easy to get wrong.
  const m = altShotMatch(["a", "a", "a", "halved", "halved"], 9);
  eq("3 up with four to play", m.label, "3 up");
  ok("not yet decided over nine", !m.decided);

  // One more hole to A and it closes: 4 up with 3 to play.
  const closed = altShotMatch(["a", "a", "a", "halved", "halved", "a"], 9);
  eq("closes 4 & 3 over nine", closed.label, "4 & 3");
  ok("decided once the lead exceeds what is left", closed.decided);
}
{
  // Holes still being played mid-round must not count toward holesPlayed.
  const m = altShotMatch(["a", null, "b", null]);
  eq("only completed holes count", m.holesPlayed, 2);
  eq("all square", m.label, "All square");
}

// ── the handicap exclusion, stated so it cannot be quietly dropped ─────────
ok("alternate shot does not post rounds for handicap", altShotPostsRounds() === false);


// Floating-point half boundary: 40.05 - 8.55 is mathematically 31.5 but JS can represent it just below.
{
  const r = altShotMatchStrokes(40.05, 8.55);
  eq("31.5 floating boundary rounds half-up to 32", r.strokes, 32);
  eq("higher side receives floating-boundary strokes", r.receiving, "a");
}
console.log(`alt shot: ${pass} passed, ${fail} failed`);
if (fail) {
  console.error(fails.join("\n"));
  process.exit(1);
}
