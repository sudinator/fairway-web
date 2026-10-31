import assert from "node:assert/strict";
import { loadReportNames, reportPlayerNames } from "./report-names";
import { seasonMatches } from "./season-matches";
import { buildSeasonSummary } from "./season-summary";
import { buildClubReport, reportPeriods } from "./club-report";
import { loadClubGames } from "./club-report-load";
import { liveCh, liveLegs, liveStrokeSets } from "./live-scoring";
import { chBasis, strokeSets } from "./game-shape";
import { liveSkins } from "./live-skins";
import { skinsTotals } from "./game-results";
import { manualHandicapPatch } from "./manual-handicap";

async function main() {
 const profileNames = { jj: "James Watt", duplicate: "James Watt", me: "Me" };
 const make = (n: number) => ({ id: `g${n}`, game_type: "match", status: "ended", course: "Oak", course_par: 36, played_at: "2026-07-01", allowance_pct: 100,
  holes_meta: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })), pairings: [{ a: "me", b: "jj" }],
  players: [{ id: `me${n}`, user_id: "me", display_name: "Me", scores: Array(9).fill(4), course_handicap: 0, course_handicap_source: "manual" },
   { id: `jj${n}`, user_id: "jj", display_name: n < 6 ? "JJ Watt" : "James Watt", scores: Array(9).fill(5), course_handicap: 0, course_handicap_source: "manual" }] });
 const saved = Array.from({ length: 10 }, (_, n) => make(n));
 const copies = saved.map((g) => ({ ...g, players: reportPlayerNames(g.players, profileNames) }));
 const sm = seasonMatches(copies, "me");
 assert.deepEqual(sm.playedWith, [{ name: "James Watt", games: 10 }]);
 assert.equal(saved[0].players[1].display_name, "JJ Watt");
 const summary = buildSeasonSummary({ year: 2026, name: "Me", rounds: Array.from({length:5},(_,i) => ({ id: `r${i}`, status:"final", course:"Oak", played_at:`2026-07-${10+i}`, rating:72, slope:113, course_par:72, course_handicap:0, holes:Array.from({length:18},(_,n)=>({hole_number:n+1,par:4,stroke_index:n+1,strokes:5,putts:2})) })) as never, matches: sm.matches });
 const h = summary.cards.find((c) => c.kind === "headToHead");
 assert.ok(h?.kind === "headToHead" && h.rival?.name === "James Watt" && h.rival.won === 10);
 const extra = make(12); extra.players[1] = { ...extra.players[1], user_id: "duplicate", display_name: "James Watt" }; extra.pairings = [{ a: "me", b: "duplicate" }];
 assert.equal(seasonMatches([...copies, extra], "me").playedWith.length, 2, "same name, different users remain separate");
 const guest = { ...extra, id: "guest-game", players: [extra.players[0], { ...extra.players[1], user_id: null, id: "guest" }] };
 const guests = reportPlayerNames(guest.players, profileNames);
 assert.equal(guests[1].display_name, "James Watt");
 assert.equal(seasonMatches([...copies, guest as never, { ...guest, id: "different-guest-game" } as never], "me").playedWith.length, 3, "guests in distinct games do not merge by name");
 const report = buildClubReport("Club", reportPeriods(2026)[1], copies.map(({ players, ...game }) => ({ game, players } as never)));
 assert.equal(report.members, 2); assert.equal(report.mostRounds?.count, 10);
 // Exercise the ACTUAL club loader: paged game/player reads, profile names, no database writes.
 const db = { from(table: string) { const q: any = { select() { return q; }, eq() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; }, in() { return q; },
   range() { return Promise.resolve({ error: null, data: table === "games" ? saved.map(({ players, ...g }) => g) : table === "game_players" ? saved.flatMap((g) => g.players.map((p) => ({ ...p, game_id: g.id }))) : table === "profiles" ? Object.entries(profileNames).map(([id, display_name]) => ({ id, display_name })) : [] }); } }; return q; } };
 const loaded = await loadClubGames(db as never, "club", reportPeriods(2026)[1]);
 assert.equal(loaded[0].players[1].display_name, "James Watt"); assert.equal(saved[0].players[1].display_name, "JJ Watt");
 assert.deepEqual(await loadReportNames(db, []), {});
 await assert.rejects(loadReportNames({ from() { const q: any = { select() { return q; }, in() { return q; }, order() { return q; }, range() { return Promise.resolve({ data: null, error: { message: "profile read failed" } }); } }; return q; } }, ["jj"]), /profile read failed/);
 assert.equal(reportPlayerNames(saved[0].players, {})[1].display_name, "JJ Watt", "unavailable profile falls back without dropping data");
 for (const holes of [9,18]) for (const source of ["manual","derived"] as const) for (const allowance of [100,85,50]) {
  const g = { ...make(1), holes_meta: Array.from({ length: holes }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })), course_par: holes * 4, allowance_pct: allowance };
  const ps = [0,12,4,9].map((ch,i) => ({ id: `p${i}`, user_id: `p${i}`, display_name: `P${i}`, scores: Array(holes).fill(5), course_handicap: ch, course_handicap_source: source, team: i%2 ? "B" : "A", no_show: false }));
  const live = ps.map((p) => ({ ...p, ch: p.course_handicap })); const byId = Object.fromEntries(live.map((p) => [p.id,p]));
  const pairs = [{ a: "p0", b: "p1" }]; const four = [{ id: "f", name: "F", swap: false, a: ["p0","p2"], b: ["p1","p3"] }];
  assert.equal(liveCh(12, holes, source), chBasis(ps[1], holes*4, holes));
  for (const mode of ["match","fourball","trifecta","alt_shot"]) {
   const game = { ...g, game_type: mode, team_score_mode: "best_ball", pairings: pairs, foursomes: four, teams: [{key:"A"},{key:"B"}] };
   for (const si of [1,5,9]) assert.deepEqual(liveStrokeSets(game as never, byId, pairs, four, g.holes_meta, "p1", si), strokeSets(game as never, ps[1] as never, si, ps as never), `${mode} ${holes} ${source} ${allowance} stroke parity`);
   assert.ok(Array.isArray(liveLegs(game as never, byId, pairs, four, g.holes_meta, allowance)));
  }
  for (const style of ["individual","team_11","team_2v2"]) {
   const game = { ...g, game_type: "skins", skins_mode: "carryover", team_score_mode: "best_ball", teams: style==="individual" ? null : [{key:"A"},{key:"B"}], pairings: style==="team_11" ? pairs : [], foursomes: style==="team_2v2" ? four : null };
   const a = skinsTotals(game as never, ps as never), l = liveSkins(game as never, live, game.pairings, game.foursomes ?? []);
   assert.deepEqual(l.byTeam, style==="individual" ? null : a.byTeam);
   if(style!=="team_2v2") assert.deepEqual(l.byPlayer, a.byPlayer);
  }
 }
 const base = { handicap_index: 12, slope: 113, rating: 36 };
 const manual = manualHandicapPatch(base,36,12,"me");
 assert.equal(chBasis({ ...base,...manual },36,9),12);
 assert.equal(chBasis(JSON.parse(JSON.stringify({ ...base,...manual })),36,9),12, "saved and reloaded manual basis");
 assert.equal(chBasis({ ...base,...manual },36,18),12, "hole count change preserves manual authority");
 assert.notEqual(chBasis({ ...base,...manualHandicapPatch(base,36,null,"me") },36,9),12, "clearing returns to derived");
 console.log("PASS agreed fixes: report identity and actual loaders; failure handling; handicap parity across 9/18 holes, manual/derived, allowances and formats");
}
main().catch((e) => { console.error(e); process.exitCode=1; });
