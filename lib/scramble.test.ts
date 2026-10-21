function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
import { scrambleTeamHandicap, scrambleCard, scrambleLeaderboard, scrambleMatch, driveTally } from "./scramble";

// ── Team handicap: the USGA's own examples (Rules of Handicapping, Appendix C / committee guidance) ──
const usga = scrambleTeamHandicap([10.335, 15.353, 28.255, 37.574])!;
eq(usga.total, 14, "USGA 4-player example: 13.65 → 14");
ok(Math.abs(usga.raw - 13.65) < 0.01, `…raw 13.65 (got ${usga.raw})`);
eq(scrambleTeamHandicap([24, 4, 16, 10])!.total, 8, "4 / 10 / 16 / 24 (any order) → 7.8 → 8");
eq(scrambleTeamHandicap([24, 4, 16, 10])!.parts.map((p) => [p.ch, p.pct]), [[4, 0.25], [10, 0.2], [16, 0.15], [24, 0.1]], "lowest course handicap gets 25%, highest 10%");
eq(scrambleTeamHandicap([10, 20, 30])!.total, 10, "3 players, 30/20/10: 3 + 4 + 3 = 10");
eq(scrambleTeamHandicap([8, 20])!.total, 6, "2 players, 35/15: 2.8 + 3.0 = 5.8 → 6");
eq(scrambleTeamHandicap([-2, 4])!.total, 0, "a plus handicap counts as negative: -0.7 + 0.6 = -0.1 → 0");
eq(scrambleTeamHandicap([-6, -2])!.total, -2, "a plus team: -2.1 - 0.3 = -2.4 → -2 (gives strokes back)");
eq(scrambleTeamHandicap([10, 20, 30, 40], true)!.total, 0, "gross only: 0");
eq(scrambleTeamHandicap([10]), null, "1 player: not a scramble team");
eq(scrambleTeamHandicap([1, 2, 3, 4, 5]), null, "5 players: not in the USGA table");
eq(scrambleTeamHandicap([null, 10])!.total, 2, "a missing course handicap counts as 0: 0×35% + 10×15% = 1.5 → 2");

// ── One team's card: strokes allotted hole by hole by stroke index ──
const H = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));   // hole n has SI n
const card = scrambleCard(H, [3, 4, 4, ...Array(15).fill(null)], 2);
eq(card.holes.slice(0, 3).map((h) => [h.n, h.gross, h.strokes, h.net]), [[1, 3, 1, 2], [2, 4, 1, 3], [3, 4, 0, 4]], "2 strokes on SI 1 and 2; net per hole");
eq([card.thru, card.gross, card.net, card.grossToPar, card.netToPar], [3, 11, 9, -1, -3], "thru 3: gross 11 (−1), net 9 (−3)");
eq(scrambleCard(H, Array(18).fill(4), 20).net, 72 - 20, "20 strokes over 18 holes: every hole once, SI 1–2 twice");

// ── Leaderboard: ranked to par (fair mid-round), ties shared, not started last ──
const lb = scrambleLeaderboard(H, [
  { key: "red", name: "Red", scores: [3, 3, 4, ...Array(15).fill(null)], handicap: 0 },     // −2 thru 3
  { key: "blue", name: "Blue", scores: [4, 4, 4, 4, 2, ...Array(13).fill(null)], handicap: 2 }, // gross −2, 2 strokes → −4 thru 5
  { key: "gold", name: "Gold", scores: [3, 3, ...Array(16).fill(null)], handicap: 0 },      // −2 thru 2
  { key: "teal", name: "Teal", scores: [], handicap: 5 },                                   // not started
]);
eq(lb.map((r) => [r.name, r.pos, r.netToPar, r.thru]), [["Blue", "1", -4, 5], ["Red", "T2", -2, 3], ["Gold", "T2", -2, 2], ["Teal", "—", 0, 0]], "net to par; ties shared; not started last");
eq(scrambleLeaderboard(H, [{ key: "a", name: "A", scores: [4], handicap: 9 }, { key: "b", name: "B", scores: [3], handicap: 0 }], "gross").map((r) => r.name), ["B", "A"], "gross-only ranks by gross");

// ── Team v team: hole by hole on net ──
const m = scrambleMatch(H, { scores: Array(18).fill(4), handicap: 2 }, { scores: Array(18).fill(4), handicap: 0 });
eq([m.lead, m.thru, m.decided, m.result], [2, 17, true, "2&1"], "level gross, A gets 2 strokes (holes 1–2): 2 up with 1 to play after 17 — won 2&1");
eq(scrambleMatch(H, { scores: [...Array(17).fill(4), 4], handicap: 1 }, { scores: Array(18).fill(4), handicap: 0 }).result, "1 up", "a 1-hole lead decided on the last hole: 1 up");
const early = scrambleMatch(H, { scores: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, ...Array(7).fill(null)], handicap: 0 }, { scores: Array(11).fill(4), handicap: 0 });
eq([early.lead, early.thru, early.result], [10, 10, "10&8"], "winning every hole: 10 up with 8 to play after 10 — the match ends there, 10&8 (hole 11 isn't played)");
eq(scrambleMatch(H, { scores: Array(18).fill(4), handicap: 0 }, { scores: Array(18).fill(4), handicap: 0 }).result, "Halved", "all square: halved");
eq(scrambleMatch(H, { scores: [4, 4], handicap: 0 }, { scores: [4], handicap: 0 }).thru, 1, "only holes both teams have scored count");

// ── Drives ──
const d = driveTally(["raj", "nihar", "raj", "nihar", "karan", ...Array(13).fill(null)], ["raj", "nihar", "karan", "sam"], 3, 18);
eq(d.counts, { raj: 2, nihar: 2, karan: 1, sam: 0 }, "drives counted per player");
eq(d.needs.map((x) => [x.player, x.more, x.holesLeft, x.short]), [["raj", 1, 13, false], ["nihar", 1, 13, false], ["karan", 2, 13, false], ["sam", 3, 13, false]], "who still needs how many, 13 holes left");
eq(driveTally(Array(16).fill("raj"), ["raj", "sam"], 3, 18).needs.map((x) => [x.player, x.short]), [["sam", true]], "Sam needs 3 with 2 holes left: can't make it");
eq(driveTally([], ["raj"], null, 18).met, true, "no requirement: always met");
console.log("scramble tests passed");
