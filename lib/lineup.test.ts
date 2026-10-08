function assert(v: unknown, msg: string): asserts v { if (!v) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg: string) { if (a !== b) throw new Error(`${msg}: expected ${String(b)}, got ${String(a)}`); }
import { buildLineup, buildLineupText, strokesPhrase } from "./lineup";
import { matchAllowance, applyAllowance } from "./golf";

const H = Array.from({ length: 18 }, (_, i) => ({ n: i + 1 }));
const tees = [{ name: "Blue", rating: 71.2, slope: 134, par: 72 }, { name: "White", rating: 69.0, slope: 130, par: 72 }];
const P = (id: string, name: string, ch: number, idx: number, team: string, tee = "Blue") =>
  ({ id, user_id: id, display_name: name, course_handicap: ch, handicap_index: idx, team, tee_name: tee });

// Amit's example: a 90% game, course handicap 15 → 13.5 → plays off 14 (Rule 6.2a, .5 up).
const amit = P("u1", "Amit", 15, 16.1, "A");
const bob = P("u2", "Bob", 6, 7.0, "B");
const carl = P("u3", "Carl", 10, 11.4, "A");
const dan = P("u4", "Dan", 12, 13.0, "B", "White");

{
  const game = { name: "Saturday Trifecta", game_type: "trifecta", allowance_pct: 90, course_par: 72, holes_meta: H,
    teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }],
    foursomes: [{ id: "f1", name: "Group 1", a: ["u1", "u3"], b: ["u2", "u4"], swap: false }] };
  const l = buildLineup(game, [amit, bob, carl, dan], tees);
  // Header tees carry rating and slope, once each.
  eq(l.tees.length, 2, "two tees in use");
  eq(l.tees.find((t) => t.name === "Blue")?.slope, 134, "Blue slope");
  eq(l.tees.find((t) => t.name === "White")?.rating, 69.0, "White rating");
  const a = l.rows.find((r) => r.name === "Amit")!;
  eq(a.courseHandicap, 15, "CH stays the course handicap");
  eq(a.playingExact, 13.5, "CH × 90% shown exactly");
  eq(a.playingHandicap, 14, "the figure played off is the engine's rounding (.5 up)");
  eq(a.playingHandicap, applyAllowance(15, 90), "playing handicap IS applyAllowance");
  eq(a.teamName, "Team Reds", "team named");
  eq(a.group, "Group 1", "foursome named");
  eq(a.rating, 71.2, "row carries its tee rating");
  // Trifecta: one single (vs the matching opponent) and the four-ball leg.
  eq(a.contests.length, 2, "single + team leg");
  const single = a.contests.find((c) => c.kind === "single")!;
  eq(single.opponents[0], "Bob", "default pairing: a[0] vs b[0]");
  const m = matchAllowance(15, 6, 90); // engine: 14 − 5 = 9
  eq(single.strokes, m.a - m.b, "single strokes equal the engine's matchAllowance difference");
  eq(single.strokes, 9, "Amit gets 9 from Bob at 90%");
  const team = a.contests.find((c) => c.kind === "team")!;
  eq(team.partner, "Carl", "partner named");
  eq(team.opponents.join("&"), "Bob&Dan", "opponents named");
  eq(team.strokes, 14 - 5, "four-ball strokes off the low man (Bob, PH 5)");
  assert(team.basis.includes("Bob"), "basis names the low man");
  const b = l.rows.find((r) => r.name === "Bob")!;
  eq(b.contests.find((c) => c.kind === "team")!.strokes, 0, "the low man gets nothing");
  eq(b.contests.find((c) => c.kind === "single")!.strokes, -9, "Bob GIVES 9 to Amit");
  // Text version carries the same facts.
  const txt = buildLineupText(game, l);
  assert(txt.includes("Blue tees · 71.2 / 134"), "text has rating/slope");
  assert(txt.includes("CH 15 × 90% = 13.5 → PH 14"), "text shows the allowance arithmetic");
  assert(txt.includes("Singles vs Bob: you get 9 strokes"), "text names the opponent and strokes");
}

// Swap flag changes which single you play.
{
  const game = { game_type: "trifecta", allowance_pct: 100, course_par: 72, holes_meta: H, foursomes: [{ id: "f1", name: "G", a: ["u1", "u3"], b: ["u2", "u4"], swap: true }] };
  const l = buildLineup(game, [amit, bob, carl, dan], tees);
  eq(l.rows.find((r) => r.name === "Amit")!.contests.find((c) => c.kind === "single")!.opponents[0], "Dan", "swap: a[0] vs b[1]");
}

// Singles match play: strokes from pairings; 100% allowance means CH shown without arithmetic.
{
  const game = { game_type: "match", allowance_pct: 100, course_par: 72, holes_meta: H, teams: [{ key: "A", name: "A" }, { key: "B", name: "B" }], pairings: [{ a: "u1", b: "u2" }] };
  const l = buildLineup(game, [amit, bob], tees);
  const a = l.rows.find((r) => r.name === "Amit")!;
  eq(a.playingHandicap, 15, "100%: playing = course handicap");
  eq(a.contests[0].kind, "single", "match play is a single");
  eq(a.contests[0].strokes, 9, "15 vs 6 at 100% = 9");
  assert(!buildLineupText(game, l).includes("× 100%"), "no allowance arithmetic at 100%");
}

// Individual formats have no contests; the handicap line still shows.
{
  const l = buildLineup({ game_type: "stableford", allowance_pct: 100, course_par: 72, holes_meta: H }, [amit, bob], tees);
  eq(l.rows[0].contests.length, 0, "stableford: no opponent");
}

// Missing data is visible, not invented.
{
  const noCh = { ...carl, course_handicap: null };
  const game = { game_type: "fourball", allowance_pct: 85, course_par: 72, holes_meta: H, foursomes: [{ id: "f1", name: "G", a: ["u1", "u3"], b: ["u2", "u4"] }] };
  const l = buildLineup(game, [amit, bob, noCh, dan], []);
  const a = l.rows.find((r) => r.name === "Amit")!;
  eq(a.contests[0].strokes, null, "a partner with no CH leaves strokes TBD rather than guessed");
  eq(a.rating, null, "no tee data → no rating, not a fake one");
  eq(strokesPhrase(null), "strokes TBD", "phrase for unknown");
  eq(strokesPhrase(1), "you get 1 stroke", "singular");
  eq(strokesPhrase(-2), "you give 2 strokes", "giving");
  eq(strokesPhrase(0), "level", "level");
}
console.log("lineup tests passed");
