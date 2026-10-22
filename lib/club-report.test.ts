function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
import { buildClubReport, reportPeriods, basis, rivalryWaiting, waitingNote } from "./club-report";
// 210.0: the club report — a small club season.
const H18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const fill = (n: number, v: number) => Array(n).fill(v);
const pl = (id: string | null, name: string, scores: number[], hi: number, extra: any = {}) => ({ id: name, user_id: id, display_name: name, scores, course_handicap: 0, course_handicap_source: "manual", handicap_index: hi, rating: 72, slope: 113, no_show: false, ...extra });
const g = (id: string, date: string, gameType: string, players: any[], extra: any = {}) => ({ game: { id, played_at: date, course: "Oak", course_par: 72, holes_meta: H18, game_type: gameType, allowance_pct: 100, status: "ended", teams: null, pairings: [], foursomes: [], ...extra } as any, players: players as any });
const period = reportPeriods(2026)[1];   // July–September 2026
eq([period.key, period.label, period.from, period.to], ["2026-Q3", "July–September 2026", "2026-07-01", "2026-09-30"], "the July–September period");

const input = [
  // Week 1: Ann v Bob singles — Ann wins; a guest plays too
  g("g1", "2026-07-04", "match", [pl("ann", "Ann", fill(18, 4), 12), pl("bob", "Bob", fill(18, 5), 14), pl(null, "Gus", fill(18, 3), 0, { is_guest: true })], { pairings: [{ a: "ann", b: "bob" }] }),
  // Week 2: Bob wins the rematch; Ann's index has come down
  g("g2", "2026-07-11", "match", [pl("ann", "Ann", fill(18, 5), 11.2), pl("bob", "Bob", fill(18, 4), 14)], { pairings: [{ a: "ann", b: "bob" }] }),
  // Week 3: stroke play; Ann's index down again; Cal's best net
  g("g3", "2026-07-18", "stroke", [pl("ann", "Ann", [3, ...fill(17, 4)], 10.5), pl("cal", "Cal", fill(18, 4), 20)]),
  // Outside the period: ignored
  g("g4", "2026-10-03", "stroke", [pl("ann", "Ann", fill(18, 3), 9)]),
];
const r = buildClubReport("Test Club", period, input);
eq([r.games, r.rounds, r.members], [3, 7, 3], "3 games, 7 rounds (the guest's counts), 3 members");
eq(r.bestGross && [r.bestGross.name, r.bestGross.score], ["Gus", 54], "best gross — a guest can hold it (it's a round, not a member list)");
eq(r.bestNet && [r.bestNet.name, r.bestNet.score], ["Gus", 54], "best net");
eq(r.mostRounds && [r.mostRounds.name, r.mostRounds.count], ["Ann", 3], "most rounds");
ok(r.mostNetBirdies && r.mostNetBirdies.name === "Ann" || r.mostNetBirdies?.name === "Cal", "most net birdies is a member");
eq(r.mostImproved && [r.mostImproved.name, r.mostImproved.from, r.mostImproved.to, basis.improved(r)], ["Ann", 12, 10.5, "over 3 rounds"], "most improved: Ann, index 12 → 10.5, over 3 rounds (3 readings — the minimum)");
{
  const two = buildClubReport("Test Club", period, input.slice(0, 2));   // only 2 readings for Ann
  eq(two.mostImproved, null, "two handicap readings aren't enough for most improved");
  eq(waitingNote(two), "Most improved needs 3 handicap readings in the period.", "…and the report says what it's waiting for");
}
// 210.7 (owner): a rivalry needs 3 matches — Ann v Bob's 2 don't qualify; the report says it's waiting.
eq(r.closestRivalry, null, "two matches aren't a rivalry yet");
eq(rivalryWaiting(r), "Not enough matches yet for a rivalry — it needs 3 between the same two players.", "…and the report says what it's waiting for");
{
  const third = buildClubReport("Test Club", period, [...input, g("g5", "2026-07-25", "match", [pl("ann", "Ann", fill(18, 4), 10.4), pl("bob", "Bob", fill(18, 4), 14)], { pairings: [{ a: "ann", b: "bob" }] })]);
  eq(third.closestRivalry && [third.closestRivalry.a, third.closestRivalry.b, third.closestRivalry.aWins, third.closestRivalry.bWins, third.closestRivalry.halved, basis.rivalry(third)],
    ["Ann", "Bob", 1, 1, 1, "3 matches"], "a third match: Ann v Bob, 1–1, 1 halved · 3 matches");
  eq(rivalryWaiting(third), null, "nothing waiting once it qualifies");
}
eq(r.longestStreak && [r.longestStreak.name, r.longestStreak.weeks], ["Ann", 3], "longest weekly streak: Ann, 3 weeks");
ok(!JSON.stringify([r.mostRounds, r.mostNetBirdies, r.mostImproved, r.longestStreak, r.closestRivalry]).includes("Gus"), "a guest never appears in a member list");
eq(buildClubReport("Empty", period, []).games, 0, "an empty period is an empty report, not an error");
// A derived (fractional) course handicap still gives a whole-number net — the recap's rounding (210.1).
{
  const frac = buildClubReport("T", period, [g("gf", "2026-08-01", "stroke", [{ ...pl("zed", "Zed", fill(18, 5), 13.4), course_handicap: null, course_handicap_source: "derived", slope: 127, rating: 71.3 }])]);
  ok(frac.bestNet && Number.isInteger(frac.bestNet.score), `best net is a whole number (got ${frac.bestNet?.score})`);
}
// 210.2 — the review's cases, and the owner's round rules.
{
  const nul = (n: number, v: number) => [...fill(n, v), ...fill(18 - n, null as any)];
  const rep = buildClubReport("T", period, [
    g("e1", "2026-08-01", "stroke", [pl("emp", "Empty", [], 10), pl("one", "One Score", [4], 10)]),
    g("e2", "2026-08-08", "stroke", [pl("par", "Partial", nul(14, 3), 10), pl("full", "Full", fill(18, 5), 10)]),
    g("e3", "2026-08-15", "stroke", [pl("idx", "Index", fill(18, 5), 20)]),
    g("e4", "2026-08-22", "stroke", [{ ...pl("idx", "Index", fill(18, 5), 0), handicap_index: null }]),
    g("e5", "2026-08-29", "alt_shot", [pl("alt", "Alt Pair", fill(18, 2), 10)]),
  ]);
  ok(!JSON.stringify(rep).includes("Empty") && !JSON.stringify(rep).includes("One Score"), "an empty or one-score card counts nowhere");
  eq(rep.rounds, 5, "rounds: the 14-hole round, the full round, Index twice, the alt-shot player (not the empty / one-score cards)");
  ok(rep.mostRounds && rep.mostRounds.name === "Index", "a 14-hole round marked complete still counts towards rounds played");
  eq(rep.bestGross && [rep.bestGross.name, rep.bestGross.score], ["Full", 90], "best gross: complete 18-hole rounds only — not the 14-hole 42, not the alt-shot pair's 36");
  eq(rep.mostImproved, null, "a missing index is skipped — no fake '20 → 0'");
  ok(!JSON.stringify(rep.mostNetBirdies || {}).includes("Alt Pair"), "alternate-shot pair scores never become individual awards");
}
// 212.2 — one-ball formats count for games, rounds and attendance (each player carries the side's / team's card),
// and feed no individual statistic. Before, their players' empty cards meant they counted nowhere.
{
  const H = Array.from({ length: 18 }, (_, k) => ({ n: k + 1, par: 4, si: k + 1 }));
  const mkP = (id: string, name: string) => ({ id, game_id: "sg", user_id: id, display_name: name, scores: Array(18).fill(null), course_handicap: 10, course_handicap_source: "manual", no_show: false });
  const rows = (fid: string, side: "a" | "b", gid: string) => Array.from({ length: 18 }, (_, i) => ({ game_id: gid, foursome_id: fid, side, hole_index: i, strokes: 4 }));
  const sg = { id: "sg", game_type: "scramble", played_at: period.from, course: "Oak", course_par: 72, holes_meta: H, scramble_handicap: "usga", foursomes: [{ id: "t1", name: "Team 1", a: ["s1", "s2"], b: [] }] };
  const ag = { id: "ag", game_type: "alt_shot", played_at: period.from, course: "Oak", course_par: 72, holes_meta: H, foursomes: [{ id: "m1", name: "Match 1", a: ["a1", "a2"], b: ["a3", "a4"] }] };
  const rep = buildClubReport("Test Club", period, [
    { game: sg as never, players: [mkP("s1", "S One"), mkP("s2", "S Two")] as never, altScores: rows("t1", "a", "sg") as never },
    { game: ag as never, players: [mkP("a1", "A1"), mkP("a2", "A2"), mkP("a3", "A3"), mkP("a4", "A4")] as never, altScores: [...rows("m1", "a", "ag"), ...rows("m1", "b", "ag")] as never },
  ]) as any;
  const rounds = rep.rounds ?? rep.totals?.rounds;
  if (rounds !== 6) throw new Error(`a scramble (2 players) and an alternate-shot game (4) count 6 rounds (got ${rounds}; report keys: ${Object.keys(rep).join(",")})`);
  if (rep.bestGross || rep.bestNet) throw new Error("one-ball formats must not produce a best gross / best net");
}
console.log("club-report tests passed");
