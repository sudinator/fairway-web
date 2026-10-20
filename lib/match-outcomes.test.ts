function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
import { matchOutcomes, memberRecord, formatsLabel, BEST_PARTNER_MIN } from "./match-outcomes";
import { buildRecap } from "./game-recap";
// 210.0: head-to-head & partners — the recap's own match results, by account.
const H18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const pl = (id: string, name: string, scores: number[], extra: any = {}) => ({ id, user_id: id, display_name: name, scores, course_handicap: 0, course_handicap_source: "manual", handicap_index: 0, rating: 72, slope: 113, no_show: false, ...extra });
const fill = (n: number, v: number) => Array(n).fill(v);
const teams = [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }];

// Singles with teams: Ann beats Bob, Cal halves with Dee, Eve loses to Fay.
const singles: any = { id: "s", played_at: "2026-09-01", game_type: "match", teams, holes_meta: H18, course_par: 72, allowance_pct: 100, status: "ended",
  pairings: [{ a: "ann", b: "bob" }, { a: "cal", b: "dee" }, { a: "eve", b: "fay" }], foursomes: [] };
const sp = [pl("ann", "Ann", fill(18, 4), { team: "A" }), pl("bob", "Bob", fill(18, 5), { team: "B" }), pl("cal", "Cal", fill(18, 4), { team: "A" }),
  pl("dee", "Dee", fill(18, 4), { team: "B" }), pl("eve", "Eve", fill(18, 5), { team: "A" }), pl("fay", "Fay", fill(18, 4), { team: "B" })];
// Four-ball with a guest: Ann & Cal beat Bob & a guest.
const fb: any = { id: "f", played_at: "2026-09-08", game_type: "fourball", teams, holes_meta: H18, course_par: 72, allowance_pct: 100, team_score_mode: "best_ball", status: "ended",
  foursomes: [{ id: "f1", a: ["ann", "cal"], b: ["bob", "gus"] }] };
const fp = [pl("ann", "Ann", fill(18, 4), { team: "A" }), pl("cal", "Cal", fill(18, 5), { team: "A" }), pl("bob", "Bob", fill(18, 5), { team: "B" }),
  { ...pl("gus", "Gus", fill(18, 5), { team: "B" }), user_id: null, is_guest: true }];

// 1. Agreement with the recap: same matches, same winners.
for (const [g, ps] of [[singles, sp], [fb, fp]] as const) {
  const outs = matchOutcomes(g, ps as any);
  const rows = buildRecap(g, ps as any).sections.matches?.rows || [];
  eq(outs.length, rows.length, `${g.game_type}: same number of matches as the recap`);
  for (const r of rows) {
    const o = outs.find((x) => { const names = (s: any[]) => s.map((p) => p.name).sort().join(","); const w = r.winners.slice().sort().join(","), l = r.losers.slice().sort().join(",");
      return (names(x.a) === w && names(x.b) === l) || (names(x.b) === w && names(x.a) === l); });
    ok(o, `${g.game_type}: the recap's ${r.winners.join(" & ")} v ${r.losers.join(" & ")} is an outcome`);
    const winnerNames = o!.winner === "halved" ? null : (o!.winner === "a" ? o!.a : o!.b).map((p) => p.name).sort().join(",");
    eq(r.halved ? null : winnerNames, r.halved ? null : r.winners.slice().sort().join(","), `${g.game_type}: same winner as the recap for ${r.winners.join(" & ")}`);
  }
}
// 2. A member's own record.
const all = [...matchOutcomes(singles, sp as any), ...matchOutcomes(fb, fp as any)];
const ann = memberRecord(all, "ann");
eq(ann.headToHead.map((r) => [r.name, r.won, r.lost, r.halved]), [["Bob", 1, 0, 0]], "Ann's head-to-head: beat Bob in singles (four-ball isn't head-to-head)");
eq(ann.partners.map((r) => [r.name, r.played, r.won, r.points, r.formats]), [["Cal", 1, 1, 1, ["fourball"]]], "Ann's partners: won with Cal (four-ball)");
eq([formatsLabel(["fourball"]), formatsLabel(["fourball", "trifecta"]), formatsLabel(["fourball", "alt_shot", "trifecta"])], ["four-ball", "four-ball and Trifecta", "four-ball, alternate shot and Trifecta"], "the formats a partner record came from, in words");
eq(BEST_PARTNER_MIN, 3, "best partner needs 3 matches together (owner, Oct 20)");
const cal = memberRecord(all, "cal");
eq(cal.headToHead.map((r) => [r.name, r.won, r.lost, r.halved]), [["Dee", 0, 0, 1]], "a halved match counts as halved");
const bob = memberRecord(all, "bob");
eq(bob.partners.length, 0, "a guest partner isn't listed (no account)");
eq(bob.headToHead.map((r) => [r.name, r.lost]), [["Ann", 1]], "Bob's record: lost to Ann");
eq(memberRecord(all, "nobody").headToHead.length, 0, "someone who didn't play has no record");
console.log("match-outcomes tests passed");
