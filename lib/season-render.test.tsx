/**
 * RENDERED CHECK (205.0): the Season Wrapped story and share card, built by lib/season-summary from
 * a season shaped like the owner's dashboard (26 rounds, index 8.8 → ~12, Francis Byrne on Aug 2).
 * Writes the render to .testout-screens/season-wrapped.html for review.
 */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { SeasonStory } from "@/components/season-story";
import { SeasonShareCard } from "@/components/season-share-card";
import { buildSeasonSummary } from "@/lib/season-summary";
import type { Round } from "@/lib/golf";
import { writeFileSync, mkdirSync } from "node:fs";

let seed = 2026; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const pars = [4,4,3,5,4,3,4,5,4, 4,3,5,4,4,3,4,5,4];
const courses: [string, number, number][] = [["Francis Byrne Golf Course", 70.8, 129], ["Bowling Green Golf Club", 71.0, 131], ["Pinch Brook Golf Course", 68.0, 123], ["Essex County Country Club", 71.2, 134]];
function round(i: number, date: string, idx: number, diffTarget: number): Round {
  const c = courses[i % 4 === 0 ? 0 : i % 4 === 1 ? 0 : i % 4 === 2 ? 1 : i % 3];
  const [course, rating, slope] = c;
  const ch = Math.round(idx * slope / 113 + (rating - 72));
  // gross such that the differential is near diffTarget: diff = (adj - rating) * 113 / slope
  const gross = Math.round(rating + diffTarget * slope / 113);
  const holes = pars.map((par, h) => {
    const base = par + (h % 5 === 2 ? 0 : 1);
    return { hole_number: h + 1, par, stroke_index: ((h * 7) % 18) + 1, strokes: base, putts: 1 + Math.floor(rnd() * 2.3), fairway: par >= 4 ? (rnd() < 0.55 ? "hit" : "miss") as "hit" | "miss" : null, penalties: 0 };
  });
  // trim strokes to hit the target gross, birdies on a couple of holes
  let sum = holes.reduce((n, h) => n + h.strokes!, 0);
  let k = 0; while (sum > gross && k < 200) { const h = holes[k % 18]; if (h.strokes! > h.par - 1) { h.strokes!--; sum--; } k++; }
  k = 0; while (sum < gross && k < 200) { const h = holes[(k * 5) % 18]; h.strokes!++; sum++; k++; }
  return { id: `r${i}`, course, tee_name: "Blue", rating, slope, course_par: 72, handicap_index: idx, course_handicap: ch, played_at: date, holes, status: "final" };
}
// 26 rounds Apr–Oct 2026, differentials drifting from ~9 up to ~15 with a best of 8.9 on Aug 2
const dates = ["2026-04-11","2026-04-18","2026-04-25","2026-05-02","2026-05-09","2026-05-16","2026-05-23","2026-05-30","2026-06-06","2026-06-13","2026-06-20","2026-06-27","2026-07-04","2026-07-11","2026-07-18","2026-07-25","2026-08-02","2026-08-09","2026-08-16","2026-08-23","2026-08-30","2026-09-06","2026-09-13","2026-09-20","2026-09-27","2026-10-04"];
const diffs = [9.5,10.2,11.0,9.8,12.1,11.4,13.0,12.2,10.9,13.8,12.5,14.1,13.3,15.0,12.8,14.4,8.9,13.6,15.2,16.1,14.8,13.9,15.5,14.2,16.0,15.3];
const prior = Array.from({ length: 12 }, (_, i) => round(100 + i, `2025-${String(5 + Math.floor(i / 3)).padStart(2, "0")}-${String(3 + (i % 3) * 9).padStart(2, "0")}`, 8.8, 8 + (i % 4)));
const season = dates.map((d, i) => round(i, d, 10 + i * 0.1, diffs[i]));
const summary = buildSeasonSummary({
  year: 2026, name: "Amit Sud", rounds: [...prior, ...season],
  matches: [
    { opponent: "Ashutosh Rathore", result: "won", played_at: "2026-10-10" }, { opponent: "Ashutosh Rathore", result: "lost", played_at: "2026-08-15" }, { opponent: "Ashutosh Rathore", result: "won", played_at: "2026-06-20" },
    { opponent: "Bob Jones", result: "halved", played_at: "2026-07-04" }, { opponent: "Sudhir Sirohy", result: "won", played_at: "2026-09-12" }, { opponent: "Karan Sarin", result: "lost", played_at: "2026-05-30" },
  ],
  clubs: [
    { name: "Livingston Early Morning Golfers", totalRounds: 412, members: 23, myRounds: 26, myRank: 2 },
    { name: "The 19th Hole", totalRounds: 41, members: 11, myRounds: 6, myRank: 9 },
  ],
  playedWithMost: { name: "Ashutosh Rathore", rounds: 6 },
});

const kinds = summary.cards.map((c) => c.kind);
ok(summary.rounds === 26, `26 rounds in the season (got ${summary.rounds})`);
ok(kinds[0] === "headline" && kinds[kinds.length - 1] === "closing", `first and last cards (${kinds.join(",")})`);
ok(kinds.includes("index") && kinds.includes("best") && kinds.includes("headToHead") && kinds.includes("club"), "all expected cards present");
const best = summary.cards.find((c) => c.kind === "best") as any;
ok(best.course === "Francis Byrne Golf Course" && best.date === "2026-08-02" && best.differential === 8.9, `best day is Francis Byrne Aug 2 (${best.course} ${best.date} ${best.differential})`);
const club = summary.cards.find((c) => c.kind === "club") as any;
ok(club.clubs.length === 2, "every club the golfer played in is on the card");
ok(club.clubs[0].topThree === 2 && club.clubs[1].topThree === null, "rank only where top three (#9 hidden)");
ok(summary.share.badges === (summary.cards.find((c) => c.kind === "badges") as any)?.earned.length, "share card badge count matches");
ok(!kinds.includes("money" as never), "no money card anywhere");
const s = renderScreen(<div><SeasonStory summary={summary} autoplay={false} /><div style={{ height: 20 }} /><SeasonShareCard summary={summary} /></div>);
ok(s.el.querySelectorAll("[data-season-card]").length === summary.cards.length, "every card rendered");
ok(s.text.includes("26 rounds") && s.text.includes("Francis Byrne"), "headline and best day on screen");
ok(s.text.includes("The 19th Hole") && s.text.includes("YOUR CLUBS"), "both clubs listed");
ok(!(s.el.querySelector("[data-season-share]")?.textContent || "").includes("$"), "share card shows no money");
mkdirSync(".testout-screens", { recursive: true });
writeFileSync(".testout-screens/season-wrapped.html", `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Season Wrapped 2026 — real components (205.0 mock)</title><style>:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;background:#0A2A20;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;padding:24px;gap:12px}.note{color:#CFC9B4;font-size:13px;max-width:402px;line-height:1.5}</style><body><div class="note"><b style="color:#C9A227">Season Wrapped 2026 — the real story and share components</b>, built by lib/season-summary over the engine's own functions. Data: a season shaped like your dashboard (26 rounds, index 8.8 → ${summary.share.indexEnd}, Francis Byrne on Aug 2), not your live rows — I can't reach staging from here. In the app each card fills the screen for six seconds with a progress bar; here they are stacked. The share card is at the bottom; the money card is for you only and is never on it.</div><div style="width:402px;max-width:100%">${s.el.innerHTML}</div></body>`);
report("season wrapped");
