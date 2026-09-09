/**
 * RENDERED CHECK — the in-game Trifecta Results row states WHO won.
 *
 * Before 183.1 the row read "Amit v Christopher   thru 15   4 & 3": the margin was there but the
 * winner had to be inferred, and the running label was always from side A so it could read as a
 * deficit next to the wrong name. The row now renders the two names as separate spans styled from
 * the shared trifectaRowState: settled → winner bold gold, loser muted; in progress → leader gold
 * at normal weight; level → both neutral, with the margin always read from the leading side.
 *
 * Data: staging game 641032 Group 1 (FB 6/21 production scores), the same rows the screenshot showed.
 */
import { renderScreen, eq, report } from "./screen-harness";
import * as React from "react";
import { TrifectaContestRow } from "@/components/game/scoring-views";
import { GroupScorecard } from "@/components/game/scorecard-views";
import { computeTrifecta, C } from "@/lib/golf";
import { chBasis } from "@/lib/game-shape";

const HOLES = [
  { n: 1, si: 5, par: 4 }, { n: 2, si: 11, par: 3 }, { n: 3, si: 7, par: 4 }, { n: 4, si: 13, par: 4 },
  { n: 5, si: 17, par: 3 }, { n: 6, si: 1, par: 4 }, { n: 7, si: 15, par: 4 }, { n: 8, si: 9, par: 4 },
  { n: 9, si: 3, par: 4 }, { n: 10, si: 10, par: 4 }, { n: 11, si: 8, par: 4 }, { n: 12, si: 2, par: 4 },
  { n: 13, si: 6, par: 4 }, { n: 14, si: 18, par: 3 }, { n: 15, si: 16, par: 5 }, { n: 16, si: 4, par: 4 },
  { n: 17, si: 12, par: 3 }, { n: 18, si: 14, par: 5 },
];
const R = {
  Chris: { id: "Chris", handicap_index: 9, slope: 137, rating: 72.9, course_handicap: 14, scores: [4, 5, 5, 4, 4, 5, 5, 5, 4, 5, 5, 4, 6, 3, 6, 4, 4, 5] },
  Amit: { id: "Amit", handicap_index: 23, slope: 135, rating: 70.9, course_handicap: 28, scores: [6, 6, 5, 7, 4, 6, 5, 5, 6, 6, 6, 8, 6, 5, 7, 6, 5, 7] },
  Christopher: { id: "Christopher", handicap_index: 13, slope: 137, rating: 72.9, course_handicap: 19, scores: [4, 4, 6, 6, 4, 6, 5, 7, 4, 6, 6, 6, 4, 3, 6, 7, 4, 6] },
  Michael: { id: "Michael", handicap_index: 11, slope: 137, rating: 72.9, course_handicap: 16, scores: [5, 4, 5, 6, 5, 6, 5, 5, 5, 5, 5, 5, 5, 4, 6, 6, 4, 5] },
};
const A = ["Chris", "Amit"], B = ["Christopher", "Michael"];
const mem = (upto = 18) => Object.values(R).map((r) => ({ id: r.id, gross: r.scores.map((g, i) => (i < upto ? g : null)) as number[], ch: chBasis(r, 70, 18), noShow: false }));
const tri = computeTrifecta(HOLES, mem(), A, B, 85, "best_ball", true);
const mid = computeTrifecta(HOLES, mem(9), A, B, 85, "best_ball", true);

// Read the rendered row back: [name, weight, color] per side, plus the margin text.
function readRow(c: Parameters<typeof TrifectaContestRow>[0]["c"], aNames: string, bNames: string) {
  const s = renderScreen(<TrifectaContestRow c={c} aNames={aNames} bNames={bNames} open={false} onToggle={() => {}} />);
  const spans = Array.from(s.el.querySelectorAll("span")).filter((e) => e.children.length === 0);
  const find = (txt: string) => spans.find((e) => (e.textContent || "").trim() === txt)!;
  const styleOf = (txt: string) => { const e = find(txt); return `${e.style.fontWeight}/${e.style.color}`; };
  const margin = spans[spans.length - 1].textContent!.trim();
  s.unmount();
  return { styleOf, margin };
}
const GOLD = "rgb(201, 162, 39)", SAGE = "rgb(178, 203, 189)", CREAM = "rgb(247, 243, 232)";

const chrisC = tri.contests.filter((c) => c.kind === "single").find((c) => c.aIds[0] === "Chris")!;
const amitC = tri.contests.filter((c) => c.kind === "single").find((c) => c.aIds[0] === "Amit")!;

const r1 = readRow(chrisC, "Chris", "Michael");
eq(r1.styleOf("Chris"), `800/${GOLD}`, "settled winner (side A) is bold gold");
eq(r1.styleOf("Michael"), `500/${SAGE}`, "settled loser (side B) is muted");
eq(r1.margin, "4 & 2", "Chris row margin is the close-out, not a running count");

const r2 = readRow(amitC, "Amit", "Christopher");
eq(r2.styleOf("Christopher"), `800/${GOLD}`, "settled winner on side B is bold gold");
eq(r2.styleOf("Amit"), `500/${SAGE}`, "settled loser on side A is muted");
eq(r2.margin, "4 & 3", "Amit row margin is the close-out (screenshot showed 'lost 5 UP')");

const midChris = mid.contests.filter((c) => c.kind === "single").find((c) => c.aIds[0] === "Chris")!;
const r3 = readRow(midChris, "Chris", "Michael");
eq(r3.styleOf("Chris"), `700/${GOLD}`, "in-progress leader is gold at 700, NOT the 800 of a win");
eq(r3.styleOf("Michael"), `500/${CREAM}`, "in-progress trailer stays cream, not muted");
eq(r3.margin, "3 UP", "in-progress margin is read from the leader's side");

const teamC = tri.contests.find((c) => c.kind === "team")!;
const r4 = readRow(teamC, "Chris & Amit", "Christopher & Michael");
eq(r4.styleOf("Chris & Amit"), `800/${GOLD}`, "team leg highlights the winning pair");

// ── Card-wide legend must be GENERIC ─────────────────────────────────────────────────────────────
// The legend built its labels from strokeSets and took the FIRST player's, so a four-player card
// printed one player's opponent as everyone's key (641032 read "v Michael", true for one of four).
// The per-player header lines stay specific; this one must not name anybody.
{
  const HOLES2 = HOLES;
  const players = Object.values(R).map((r, i) => ({
    id: r.id, user_id: r.id, display_name: r.id, handicap_index: r.handicap_index, slope: r.slope,
    rating: r.rating, course_handicap: r.course_handicap, team: i < 2 ? "A" : "B", no_show: false,
    scores: r.scores, putts: [], fairways: [], penalties: [], sand: [], tee_name: "White", bets: true,
  })) as never[];
  const game = {
    id: "g", game_type: "trifecta", course_par: 70, allowance_pct: 85, team_score_mode: "best_ball",
    holes_meta: HOLES2, pairings: [], teams: [{ key: "A" }, { key: "B" }],
    foursomes: [{ id: "g1", name: "Group 1", swap: true, a: ["Chris", "Amit"], b: ["Christopher", "Michael"] }],
    status: "active",
  } as never;
  const s = renderScreen(<GroupScorecard game={game} players={players} allPlayers={players} user={{ id: "Amit" }} isMarker={false} markerName={null} onTakeOver={() => {}} onRelease={() => {}} onSetHole={() => {}} />);
  // Scope to the LEGEND element itself. A text slice also catches the per-player header lines, which
  // legitimately name each player's own opponent — those must stay specific.
  const legendTail = Array.from(s.el.querySelectorAll("span")).find((e) => (e.textContent || "").includes("dots = strokes"));
  const legend = legendTail?.parentElement;
  eq(!!legend, true, "legend element found");
  const legendZone = legend?.textContent || "";
  eq(legendZone.includes("v opponent"), true, "legend says 'v opponent', not a player's name");
  for (const name of ["v Michael", "v Christopher", "v Chris", "v Amit"]) {
    eq(legendZone.includes(name), false, `legend does not name a specific opponent (${name})`);
  }
  eq(legendZone.includes("off the low"), true, "legend names the four-ball basis generically");

  // Every stroke glyph must occupy an IDENTICAL box. The shapes have different natural heights
  // (7px triangle vs 6px circle/square), so without a fixed box the rows sit fractionally out of
  // line down the cell — visible on a real card, and not fixable by nudging one shape a pixel.
  const boxes = Array.from(s.el.querySelectorAll("span")).filter((e) => e.style.width === "8px" && e.style.height === "8px");
  eq(boxes.length > 0, true, "stroke glyphs render inside a fixed box");
  const sizes = new Set(boxes.map((e) => `${e.style.width}x${e.style.height}|${e.style.alignItems}|${e.style.justifyContent}`));
  eq(sizes.size, 1, "every glyph box is the same size and centres its shape identically");
  // And no glyph carries a per-shape offset — that was the old 1px nudge on the triangle.
  const nudged = Array.from(s.el.querySelectorAll("svg")).filter((e) => (e as unknown as HTMLElement).style.top);
  eq(nudged.length, 0, "no glyph is nudged individually; the box does the aligning");
  s.unmount();
}

report("trifecta results row");
