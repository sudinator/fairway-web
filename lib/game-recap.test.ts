function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
import { buildRecap } from "./game-recap";
const H18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const H9 = H18.slice(0, 9);
const pl = (id: string, name: string, scores: (number | null)[], extra: any = {}) => ({ id, user_id: id, display_name: name, scores, course_handicap: 0, course_handicap_source: "manual", handicap_index: 0, no_show: false, ...extra });
const g = (o: any) => ({ id: "g", name: "Test", course_par: 72, allowance_pct: 100, holes_meta: H18, teams: null, pairings: [], foursomes: [], ...o });
const all = (n: number, v: number | null): (number | null)[] => Array(n).fill(v);
const teams = [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }];
// 1. Team singles: Red wins 2–1.
{
  const players = [pl("a1", "Al", all(18, 4), { team: "A" }), pl("b1", "Bo", all(18, 5), { team: "B" }),
                   pl("a2", "Ann", all(18, 4), { team: "A" }), pl("b2", "Bea", all(18, 5), { team: "B" }),
                   pl("a3", "Ari", all(18, 5), { team: "A" }), pl("b3", "Ben", all(18, 4), { team: "B" })];
  const r = buildRecap(g({ game_type: "match", teams, pairings: [{ a: "a1", b: "b1" }, { a: "a2", b: "b2" }, { a: "a3", b: "b3" }] }) as any, players as any);
  eq(r.headline, "Red beat Blue 2–1", "team singles headline"); eq(r.endedEarly, false, "finished");
  eq(r.personal.b1, "Blue lost", "personal line for a loser");
}
// 2. A tie.
{
  const players = [pl("a1", "Al", all(18, 4), { team: "A" }), pl("b1", "Bo", all(18, 4), { team: "B" })];
  eq(buildRecap(g({ game_type: "match", teams, pairings: [{ a: "a1", b: "b1" }] }) as any, players as any).headline, "Red and Blue tied ½–½", "halved match → tie");
}
// 3. Ended early: one match unfinished is NOT counted as settled.
{
  const players = [pl("a1", "Al", all(18, 4), { team: "A" }), pl("b1", "Bo", all(18, 5), { team: "B" }),
                   pl("a2", "Ann", [...all(9, 5), ...all(9, null)], { team: "A" }), pl("b2", "Bea", [...all(9, 4), ...all(9, null)], { team: "B" })];
  const r = buildRecap(g({ game_type: "match", teams, pairings: [{ a: "a1", b: "b1" }, { a: "a2", b: "b2" }] }) as any, players as any);
  eq(r.headline, "Red beat Blue 1–0", "only the finished match counts (Blue's 9-hole lead is not a win)");
  ok(r.endedEarly && r.notes[0].includes("1 match unfinished"), "says it ended early");
}
// 4. Stableford ranks by POINTS (the 0165 notification ranked by net strokes).
{
  const steady = all(18, 4); steady[0] = 5; steady[1] = 5; steady[2] = 5;      // 75 strokes, 33 points
  const blowup = all(18, 4); blowup[0] = 10;                                 // 78 strokes, 34 points
  const r = buildRecap(g({ game_type: "stableford" }) as any, [pl("s", "Steady Sam", steady), pl("b", "Blow-up Bill", blowup)] as any);
  eq(r.headline, "Blow-up Bill won with 34 points", "the winner by points, not by net strokes");
  eq(r.personal.s, "you finished 2nd of 2 with 33 points", "second place by points");
}
// 5. Nine-hole Stableford; an unfinished card is not ranked.
{
  const r = buildRecap(g({ game_type: "stableford", holes_meta: H9, course_par: 36 }) as any, [pl("x", "Xena", all(9, 4)), pl("y", "Yuri", [4, 4, null, null, null, null, null, null, null])] as any);
  eq(r.headline, "Xena won with 18 points", "nine holes"); ok(r.endedEarly && r.personal.y.includes("unfinished"), "unfinished card not ranked");
}
// 6. Individual singles with a GUEST (keyed by row id) — no invented overall winner.
{
  const guest = { ...pl("row-g", "Guest Gary", all(18, 5)), user_id: null };
  const r = buildRecap(g({ game_type: "match", pairings: [{ a: "u1", b: "row-g" }] }) as any, [pl("u1", "Uma", all(18, 4)), guest] as any);
  eq(r.headline, "1 singles match played", "no overall winner"); eq(r.personal["row-g"], "Uma beat you 10 & 8", "the guest's own line (closed out)");
  ok(r.personal.u1.startsWith("you beat Guest Gary"), "the member's line names the guest");
}
// 7. Skins (individual).
{
  const a = all(18, 4); a[0] = 3; const b = all(18, 4); b[1] = 3;  const c = all(18, 4); c[2] = 3; c[3] = 3;
  const r = buildRecap(g({ game_type: "skins" }) as any, [pl("a", "Ann", a), pl("b", "Bob", b), pl("c", "Cy", c)] as any);
  ok(r.headline.startsWith("Skins: Cy won"), `skins winner (${r.headline})`);
}
// 8. Corrections: a changed result changes the signature; an unchanged one does not.
{
  const mk = (bo: number) => [pl("a1", "Al", all(18, 4), { team: "A" }), pl("b1", "Bo", all(18, bo), { team: "B" })];
  const game = g({ game_type: "match", teams, pairings: [{ a: "a1", b: "b1" }] }) as any;
  const r1 = buildRecap(game, mk(5) as any), same = buildRecap(game, mk(5) as any), changed = buildRecap(game, mk(3) as any);
  eq(r1.signature, same.signature, "same outcome, same signature"); ok(r1.signature !== changed.signature && changed.headline === "Blue beat Red 1–0", "a corrected result changes it");
}
console.log("game-recap tests passed");
