/** 212.137 — the head-to-head card and the leaderboard under the scorecard, rendered: from the Colosseum (leaderboard tap,
 *  match tap) and standalone (as the singles Details › opens it). */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { HeadToHeadCard } from "@/components/game/head-to-head-card";
import { IndividualLeaderboard } from "@/components/game/individual-leaderboard";
import { ColosseumView } from "@/components/game/colosseum-view";
import type { Game, Player } from "@/lib/game-types";

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const nil = Array(18).fill(null) as (number | null)[];
const par = Array(18).fill(4) as number[];
const mk = (id: string, name: string, ch: number, scores: (number | null)[], group: number) =>
  ({ id, user_id: `u-${id}`, display_name: name, course_handicap: ch, course_handicap_source: "manual", scores, tee_group: group, no_show: false, putts: [], fairways: [] } as unknown as Player);
const game = { id: "g", code: "100001", name: "Colosseum", course: "C", game_type: "colosseum", holes_meta: holes, course_par: 72, status: "active", allowance_pct: 100, pairings: [], teams: null, foursomes: null, created_by: "u-a" } as unknown as Game;
// Amit (9: strokes on SI 1–9) v Mike (18: a stroke on every hole), thru 11 — Amit 7 up, dormie
const amit = mk("a", "Amit", 9, [5, 3, 4, 4, 5, 4, 5, 4, 4, 4, 2, ...nil.slice(11)], 1);
const mike = mk("m", "Mike", 18, [6, 4, 6, 5, 5, 3, 7, 5, 5, 5, 4, ...nil.slice(11)], 1);
const raj = mk("r", "Raj", 12, [3, 3, 3, ...par.slice(3, 9), ...nil.slice(9)], 2);
const pete = mk("p", "Pete", 22, nil, 2);
const players = [amit, mike, raj, pete];
const tick = () => act(async () => { await new Promise((res) => setTimeout(res, 5)); });

async function main() {
  // 1. the card itself, standalone, from Amit's side
  const a = { name: "Amit", gross: amit.scores, strokes: holes.map((h) => (h.si <= 9 ? 1 : 0)) };
  const b = { name: "Mike", gross: mike.scores, strokes: holes.map(() => 1) };
  const c = renderScreen(<HeadToHeadCard holes={holes} a={a} b={b} basis="course" stakes="You give 9 · net v net" />);
  await tick();
  const t = c.el.textContent || "";
  ok(c.el.querySelector("[data-h2h-state]")?.textContent === "7 up", `the state reads 7 up (got ${c.el.querySelector("[data-h2h-state]")?.textContent})`);
  ok(t.includes("thru 11 · 7 to play"), "thru and holes to play");
  ok(t.includes("Dormie — a half of any hole wins it") && t.includes("Mike can't win"), `what is needed from here: dormie (${(c.el.querySelector("[data-h2h-needed]")?.textContent || "").slice(0, 80)})`);
  ok(c.el.querySelectorAll("[data-h2h-row]").length === 18 && !!c.el.querySelector("[data-h2h-out]"), "18 rows and the Out line");
  const row1 = c.el.querySelector("[data-h2h-row='1']")?.textContent || "";
  ok(row1.includes("W") && row1.includes("1 up"), `hole 1: won, 1 up (${row1})`);
  const row6 = c.el.querySelector("[data-h2h-row='6']")?.textContent || "";
  ok(row6.includes("L") && row6.includes("3 up"), `hole 6: lost, back to 3 up (${row6})`);
  ok(t.includes("Strokes to come") && t.includes("Amit: none") && t.includes("Mike: 12, 13, 14, 15, 16, 17, 18") && t.includes("The swing") && t.includes("Amit's best 7 up (after 11)"), "strokes to come and the swing");
  ok(t.includes("MATCH PROGRESSION"), "the progression eyebrow (the mobile contract's anchor)");

  // 2. the leaderboard under the card: everyone, net to par, v you; a tap opens the card and back returns
  const lb = renderScreen(<IndividualLeaderboard game={game} players={players} user={{ id: "u-a" }} />);
  await tick();
  ok(lb.el.querySelectorAll("[data-lb-row]").length === 4, "one row per player");
  const first = lb.el.querySelector("[data-lb-row]");
  ok(!!first && (first.textContent || "").includes("Raj"), `Raj (three birdies) leads on net (first: ${first?.textContent})`);
  ok((lb.el.querySelector("[data-lb-row='u-m']")?.textContent || "").includes("7 up"), "Mike's row shows 'v you' 7 up");
  const vsCell = lb.el.querySelector("[data-lb-row='u-m'] td:last-child") as HTMLElement | null;
  ok(vsCell?.style.whiteSpace === "nowrap", "the 'v you' cell never wraps (owner, Nov 27: 'Won 7 & 5' ran to three lines)");
  ok((lb.el.querySelector("[data-lb-row='u-p']")?.textContent || "").includes("—"), "Pete (no scores) sits below with no numbers");
  await act(async () => { lb.el.querySelector("[data-lb-sort='vs']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok((lb.el.querySelector("[data-lb-row]")?.textContent || "").includes("Mike"), "sorted by 'v you', Mike (7 up) is first");
  await act(async () => { lb.el.querySelector("[data-lb-row='u-m']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(!!lb.el.querySelector("[data-h2h-card]") && (lb.el.textContent || "").includes("Amit v Mike") && (lb.el.textContent || "").includes("You give 9"), "tapping Mike opens the head-to-head card from Amit's side");
  await act(async () => { lb.el.querySelector("[data-h2h-back]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(!!lb.el.querySelector("[data-individual-leaderboard]"), "back to the leaderboard");

  // 2b. finished matches print compactly on one line: "Won 7&5" / "Lost 1 up" (owner's screenshot: three lines)
  {
    const done = [mk("a", "Amit", 0, par, 1), mk("w", "Walt", 0, Array(18).fill(5), 1), mk("l", "Lou", 0, [3, ...par.slice(1)], 1)];
    const t2 = renderScreen(<IndividualLeaderboard game={game} players={done} user={{ id: "u-a" }} />);
    await tick();
    const cell = (k: string) => (t2.el.querySelector(`[data-lb-row='${k}'] td:last-child`)?.textContent || "");
    ok(cell("u-w") === "Won 10&8", `a decided win reads "Won 10&8" (got "${cell("u-w")}")`);
    ok(cell("u-l") === "Lost 1 up", `a decided loss at 18 reads "Lost 1 up" (got "${cell("u-l")}")`);
  }

  // 3. from the Colosseum standings: a player's match row opens the same card
  const v = renderScreen(<ColosseumView game={game} players={players} user={{ id: "u-a" }} />);
  await tick();
  await act(async () => { v.el.querySelector("[data-colosseum-mine]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => { v.el.querySelector("[data-colosseum-match='u-m']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(!!v.el.querySelector("[data-h2h-card]") && v.el.querySelector("[data-h2h-state]")?.textContent === "7 up", "the match row opens the card at 7 up");
  await act(async () => { v.el.querySelector("[data-h2h-back]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(!!v.el.querySelector("[data-colosseum-player='u-a']"), "back returns to Amit's matches");
  report("head-to-head card render");
}
main().catch((e) => { console.error(e); process.exit(1); });
