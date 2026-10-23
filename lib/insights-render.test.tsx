// 212.18 — the Insights card / screen and Your courses, rendered.
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { InsightsCard } from "@/components/insights";
import { YourCourses, CourseDetail } from "@/components/your-courses";
import { yourCourses } from "@/lib/your-courses";
import { round, PARS, SIS } from "@/lib/test-fixtures/messy-rounds";

const season = Array.from({ length: 8 }, (_, k) => round(`s${k}`, `2026-08-${String(10 + k).padStart(2, "0")}`, PARS.map((p, i) => (SIS[i] <= 6 ? p + 2 : p)), { course: k < 5 ? "Oak Hollow" : "Elm Ridge" }));
{
  const c = renderScreen(<InsightsCard rounds={season} />);
  ok(c.el.querySelectorAll("[data-insight-finding]").length === 2 && (c.el.textContent || "").includes("The six hardest holes cost you most"), "the card: the two strongest findings, the leak first");
  const see = Array.from(c.el.querySelectorAll("button")).find((b) => (b.textContent || "").includes("See all insights")) as HTMLButtonElement;
  act(() => { see.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(!!document.querySelector("[data-insights-screen]") && document.querySelectorAll("[data-insight-bucket]").length === 9, "See all insights opens the full screen: 9 breakdown rows");
  c.unmount();
  const n = renderScreen(<InsightsCard rounds={season.slice(0, 3)} />);
  ok((n.el.textContent || "").includes("Insights appear after 5 rounds with hole-by-hole scores — you have 3."), "fewer than 5 rounds: says when insights appear");
  n.unmount();
}
{
  const y = renderScreen(<YourCourses rounds={season} loadField={async () => null} />);
  const rows = y.el.querySelectorAll("[data-your-course]");
  ok(rows.length === 2 && rows[0].getAttribute("data-your-course") === "Oak Hollow" && (rows[0].textContent || "").includes("5 rounds"), "most-played course first, with its record");
  act(() => { (rows[0].firstElementChild as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(!!y.el.querySelector("[data-course-detail]") && (y.el.textContent || "").includes("NEMESIS HOLE"), "tapping a course opens your record there");
  y.unmount();
  const oak = yourCourses(season).find((c) => c.key === "oak hollow")!;
  const d = renderScreen(<CourseDetail c={oak} loadField={async () => null} initialField={{ enough: true, rounds: 30, holes: oak.holes.map((h) => ({ hole: h.hole, par: h.par, avg_to_par: h.hole === 4 ? 0.5 : h.avgToPar })) }} />);
  ok(d.el.querySelectorAll('[data-vs-club="worse"]').length === 1, "half a shot or more worse than the club: marked (hole 4: +2 v +0.5)");
  d.unmount();
  const few = renderScreen(<CourseDetail c={oak} loadField={async () => null} initialField={{ enough: false, rounds: 2, holes: [] }} />);
  ok((few.el.textContent || "").includes("the club's averages appear once 3 or more members have played it 5 or more times"), "not enough club play: says so, shows no club figures");
  few.unmount();
}
report("insights screens");
