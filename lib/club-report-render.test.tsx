/** RENDERED CHECK (210.0): the club report view and the head-to-head section. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { ClubReportView } from "@/components/club-report-view";
import type { ClubReport } from "@/lib/club-report";

const r: ClubReport = {
  club: "Livingston Early Morning Golfers", period: { key: "2026-Q3", label: "July–September 2026", from: "2026-07-01", to: "2026-09-30" },
  games: 38, rounds: 274, members: 31,
  bestGross: { name: "Probir Rao", userId: "p", score: 79, course: "Oak Hollow", date: "2026-08-02" },
  bestNet: { name: "Amit Bhutani", userId: "a", score: 68, course: "Bowling Green", date: "2026-09-10" },
  standouts: { count: 19, best: { name: "Amit Bhutani", userId: null, better: 3.9, date: "2026-09-10" } },
  mostNetBirdies: { name: "Ashutosh R.", userId: "s", count: 41, rounds: 9 }, mostImproved: { name: "H Parikh", userId: "h", from: 22, to: 20.4, readings: 6 },
  mostRounds: { name: "Karan S.", userId: "k", count: 24 },
  toughestCourse: { course: "Bowling Green", fieldGap: 5.1, games: 4 }, nemesisHole: { course: "Oak Hollow", hole: 11, par: 4, vsPar: 1.4, rounds: 46 },
  mostBirdiedHole: { course: "Francis Byrne", hole: 7, birdies: 9 },
  closestRivalry: { a: "Raj", b: "Sam", aWins: 2, bWins: 2, halved: 0, matches: 4 }, longestStreak: { name: "Karan S.", userId: "k", weeks: 8 },
  shortenedRounds: 3,
};
const t = renderScreen(<ClubReportView r={r} />);
const txt = t.el.textContent || "";
ok(txt.includes("JULY–SEPTEMBER 2026") && txt.includes("38 games · 274 rounds · 31 members played"), "the period and its numbers");
ok(t.el.querySelectorAll("[data-report-tiles] > div").length === 6, "six highlight tiles");
ok(txt.includes("index 22.0 → 20.4") && txt.includes("best: Amit Bhutani, 3.9 better than the field"), "most improved and the best standout");
ok(txt.includes("Toughest for the club: Bowling Green (field +5.1 over handicaps)") && txt.includes("Oak Hollow 11 (par 4) — +1.4 a round"), "the courses");
ok(txt.includes("Best scores and standout rounds count completed 18-hole rounds only — 3 shortened rounds this period weren't counted."), "the rule, stated, with the count (210.6)");
ok(txt.includes("Closest rivalry: Raj v Sam — 2–2") && txt.includes("Longest streak: Karan S. — 8 weeks in a row"), "rivalries and attendance");
// 210.7: each award shows its basis (owner-approved mock).
ok(txt.includes("over 6 rounds") && txt.includes("in 9 rounds"), "most improved and net birdies show their basis");
ok(txt.includes("(field +5.1 over handicaps) · over 4 games") && txt.includes("+1.4 a round · 46 rounds played") && txt.includes("2–2 · 4 matches"), "courses and rivalry show their basis");
t.unmount();
const w = renderScreen(<ClubReportView r={{ ...r, closestRivalry: null, mostImproved: null, longestStreak: null, waiting: { rivalry: true, improved: true, toughest: false } }} />);
ok((w.el.textContent || "").includes("Not enough matches yet for a rivalry — it needs 3 between the same two players."), "a rivalry that isn't there yet says why");
ok((w.el.textContent || "").includes("Most improved needs 3 handicap readings in the period."), "…and so does most improved");
w.unmount();
const e = renderScreen(<ClubReportView r={{ ...r, games: 0, rounds: 0, members: 0, bestGross: null, bestNet: null, standouts: { count: 0, best: null }, mostNetBirdies: null, mostImproved: null, mostRounds: null, toughestCourse: null, nemesisHole: null, mostBirdiedHole: null, closestRivalry: null, longestStreak: null }} />);
ok((e.el.textContent || "").includes("No finished games in this period."), "an empty period says so");
e.unmount();
report("club report view");
