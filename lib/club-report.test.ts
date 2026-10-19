function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
import { buildClubReport, reportPeriods } from "./club-report";
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
eq(r.mostImproved && [r.mostImproved.name, r.mostImproved.from, r.mostImproved.to], ["Ann", 12, 10.5], "most improved: Ann, index 12 → 10.5 over the period");
eq(r.closestRivalry && [r.closestRivalry.a, r.closestRivalry.b, r.closestRivalry.aWins, r.closestRivalry.bWins], ["Ann", "Bob", 1, 1], "closest rivalry: Ann v Bob, 1–1");
eq(r.longestStreak && [r.longestStreak.name, r.longestStreak.weeks], ["Ann", 3], "longest weekly streak: Ann, 3 weeks");
ok(!JSON.stringify([r.mostRounds, r.mostNetBirdies, r.mostImproved, r.longestStreak, r.closestRivalry]).includes("Gus"), "a guest never appears in a member list");
eq(buildClubReport("Empty", period, []).games, 0, "an empty period is an empty report, not an error");
console.log("club-report tests passed");
