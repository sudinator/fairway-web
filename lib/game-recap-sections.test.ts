function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
import { buildRecapSections, orderTeamRows, orderByMargin, andList } from "./game-recap-sections";
import { buildHighlights } from "./game-highlights";
const H18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const pl = (id: string, name: string, scores: (number | null)[], extra: any = {}) => ({ id, user_id: id, display_name: name, scores, course_handicap: 0, course_handicap_source: "manual", handicap_index: 0, no_show: false, ...extra });
const fill = (n: number, v: number) => Array(n).fill(v);
const teams = [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }];
const row = (team: string | null, lead: number, thru: number, halved = false) => ({ winners: [String(lead)], losers: [], result: "", team, halved, lead, thru });
// Ordering (owner's rules): team formats by winning team (day winner first), then margin; halves last.
eq(orderTeamRows([row("B", 2, 18), row("A", 1, 18), row(null, 0, 18, true), row("A", 4, 15)], "A").map((r) => `${r.team}${r.lead}`), ["A4", "A1", "B2", "null0"], "team grouping, day winner first");
// Margin: bigger lead first; equal leads — closed out earlier (fewer holes played) first: 2 & 1 before 2 UP.
eq(orderByMargin([row(null, 1, 18), row(null, 2, 18), row(null, 0, 18, true), row(null, 2, 17), row(null, 4, 15)]).map((r) => `${r.lead}/${r.thru}`), ["4/15", "2/17", "2/18", "1/18", "0/18"], "largest margin; 2 & 1 before 2 UP; halves last");
// Singles with teams: sub-line counts finishes on 18; "<other team>'s only win" tile.
{
  const P = [pl("a1", "Al", fill(18, 4), { team: "A" }), pl("b1", "Bo", fill(18, 5), { team: "B" }), pl("a2", "Ann", fill(18, 5), { team: "A" }), pl("b2", "Bea", fill(18, 4), { team: "B" }), pl("a3", "Ari", fill(18, 4), { team: "A" }), pl("b3", "Ben", [...fill(17, 4), 5], { team: "B" })];
  const g: any = { id: "g", game_type: "match", teams, holes_meta: H18, course_par: 72, allowance_pct: 100, pairings: [{ a: "a1", b: "b1" }, { a: "a2", b: "b2" }, { a: "a3", b: "b3" }], foursomes: [] };
  const s = buildRecapSections(g, P as any, [], buildHighlights(g, P as any), { winner: "A" });
  eq(s.matches?.rows.map((r) => r.winners[0]), ["Al", "Ari", "Bea"], "Red's wins (biggest first), then Blue's");
  ok(s.tiles.some((t) => t.label === "Blue's only win" && t.who === "Bea"), "Blue's only win named");
  ok(s.sub === "1 of 3 singles went to the 18th", `sub-line (${s.sub})`);
}
// Comeback: a halve from 2 down says "halved", a win says "won"; under 2 down nothing.
{
  const a = [...fill(2, 5), ...fill(16, 4)], b = [...fill(2, 4), ...fill(14, 4), 5, 5];       // A 2 down after 2, back to all square
  const g: any = { id: "g", game_type: "match", teams: null, holes_meta: H18, course_par: 72, allowance_pct: 100, pairings: [{ a: "x", b: "y" }], foursomes: [] };
  const P = [pl("x", "Xavi", a), pl("y", "Yves", b)];
  const s = buildRecapSections(g, P as any, [], buildHighlights(g, P as any), null);
  ok(s.tiles.some((t) => t.label === "Comeback" && t.who === "Xavi" && t.what === "halved from 2 down"), `halve from 2 down: ${JSON.stringify(s.tiles)}`);
  const P1 = [pl("x", "Xavi", [5, ...fill(17, 4)]), pl("y", "Yves", [4, ...fill(16, 4), 5, 5].slice(0, 18))];
  ok(!buildRecapSections(g, P1 as any, [], buildHighlights(g, P1 as any), null).tiles.some((t) => t.label === "Comeback"), "1 down is not a comeback");
}
// Individual skins: table by skins won with pot sizes; the pot sub-line only for 3+.
{
  const P = [pl("a", "Ann", [3, 4, 4, 4, ...fill(14, 4)]), pl("b", "Bob", [4, 4, 4, 3, ...fill(14, 4)]), pl("c", "Cy", fill(18, 4))];
  const g: any = { id: "g", game_type: "skins", teams: null, holes_meta: H18, course_par: 72, allowance_pct: 100, skins_mode: "carryover" };
  const s = buildRecapSections(g, P as any, [], buildHighlights(g, P as any), null);
  eq(s.skins?.map((r) => [r.name, r.skins, r.holes.map((h) => `${h.n}x${h.value}`).join(",")]), [["Bob", 3, "4x3"], ["Ann", 1, "1x1"]], "skins table with pot size");
  eq(s.sub, "A 3-skin pot on 4 after 2 straight holes carried", "pot sub-line");
}
// Alternate shot: per-player stats switched off.
{
  const g: any = { id: "g", game_type: "alt_shot", teams, holes_meta: H18, course_par: 72, allowance_pct: 50, foursomes: [] };
  eq(buildRecapSections(g, [] as any, [], buildHighlights(g, [] as any), { winner: "A" }).individualStats, false, "alternate shot has no individual stats");
}
// Found by the staging seed (all formats at once): wording for none / a level team result / 3-way ties.
{
  const P = [pl("a", "Al", [...fill(16, 4), 4, 4]), pl("b", "Bo", [3, 3, 3, ...fill(15, 4)])];          // Bo wins 3 & 2 — nobody reaches 18
  const g: any = { id: "g", game_type: "match", teams: null, holes_meta: H18, course_par: 72, allowance_pct: 100, pairings: [{ a: "a", b: "b" }], foursomes: [] };
  eq(buildRecapSections(g, P as any, [], buildHighlights(g, P as any), null).sub, "None of the 1 singles went to the 18th", "none, not \"0 of\"");
}
{
  const P = ["a1", "a2", "b1", "b2", "c1", "c2", "d1", "d2"].map((k, i) => pl(k, k.toUpperCase(), fill(18, i < 2 ? 4 : i < 4 ? 5 : i < 6 ? 5 : 4), { team: i % 4 < 2 ? "A" : "B" }));
  const g: any = { id: "g", game_type: "fourball", teams, holes_meta: H18, course_par: 72, allowance_pct: 100, team_score_mode: "best_ball",
    foursomes: [{ id: "g1", a: ["a1", "a2"], b: ["b1", "b2"] }, { id: "g2", a: ["c1", "c2"], b: ["d1", "d2"] }] };
  const s = buildRecapSections(g, P as any, [], buildHighlights(g, P as any), { winner: null });
  eq(s.sub, "Red won 1, Blue won 1 — the four-ball matches were shared", "a level team four-ball says how it split");
}
eq(andList(["Eli", "Faisal", "Kunal"]), "Eli, Faisal and Kunal", "three-way tie reads naturally");
console.log("game-recap-sections tests passed");
