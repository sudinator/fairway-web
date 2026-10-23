// 212.21 — yardage per tee on the group scorecard; one entry limit (par + 8) everywhere.
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { GroupScorecard } from "@/components/game/scorecard-views";
import { maxHoleScore } from "@/lib/golf";
import type { Game, Player } from "@/lib/game-types";

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: i === 2 ? 3 : 4, si: i + 1, yards: 999 }));
const tees = [
  { name: "Blue", rating: 72.4, slope: 131, par: 72, yardages: holes.map((_, i) => 400 + i) },
  { name: "White", rating: 70.1, slope: 125, par: 72, yardages: holes.map((_, i) => 370 + i) },
];
const P = (id: string, tee: string) => ({ id, user_id: id, display_name: id, tee_name: tee, course_handicap: 10, course_handicap_source: "manual", scores: [], no_show: false, tee_group: 1 } as unknown as Player);
const game = { id: "g", game_type: "stroke", status: "active", holes_meta: holes, course_par: 72, created_by: "Amit" } as unknown as Game;
{
  const mixed = [P("Amit", "Blue"), P("Raj", "White")];
  const s = renderScreen(<GroupScorecard game={game} players={mixed} allPlayers={mixed} user={{ id: "Amit" } as never} isMarker markerName={null} onTakeOver={() => {}} onRelease={() => {}} onSetHole={() => {}} courseTees={tees} />);
  const first = s.el.querySelector("[data-tee-yardages]")?.textContent || "";
  ok(first.includes("Blue 400") && first.includes("White 370") && first.indexOf("Blue") < first.indexOf("White"), `mixed tees: each tee's yardage, longest first (got "${first}")`);
  ok(!(s.el.textContent || "").includes("999"), "the game's single stored yardage isn't shown for a mixed group");
  // tap Raj's (White) hole-1 cell: the score pop-up shows the White yardage
  const cell = Array.from(s.el.querySelectorAll("[data-cell]")).find((c) => c.getAttribute("data-cell") === "Raj:0") as HTMLElement | undefined
    || (s.el.querySelectorAll("#grphole-0 [style*='cursor: pointer']")[1] as HTMLElement | undefined);
  if (cell) act(() => { cell.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  const pop = document.body.textContent || "";
  ok(!!cell && pop.includes("370 yds") && !pop.includes("400 yds"), `the pop-up shows the tapped player's tee (White 370) (found cell: ${!!cell})`);
  s.unmount();
  const same = [P("Amit", "White"), P("Raj", "White")];
  const t = renderScreen(<GroupScorecard game={game} players={same} allPlayers={same} user={{ id: "Amit" } as never} isMarker markerName={null} onTakeOver={() => {}} onRelease={() => {}} onSetHole={() => {}} courseTees={tees} />);
  ok(!t.el.querySelector("[data-tee-yardages]") && (t.el.textContent || "").includes("370 yds"), "one tee: its yardage, as before");
  t.unmount();
}
ok(maxHoleScore(3) === 11 && maxHoleScore(4) === 12 && maxHoleScore(5) === 13, "entry limit: par + 8 (a quad bogey always fits)");
// 212.22 — stroke play's badge is the hole's NET score; Stableford keeps points
{
  const scored = [P("Amit", "Blue"), P("Raj", "White")].map((p, k) => ({ ...p, scores: [5, 4, ...Array(16).fill(null)] })) as Player[];
  const st = renderScreen(<GroupScorecard game={game} players={scored} allPlayers={scored} user={{ id: "Amit" } as never} isMarker markerName={null} onTakeOver={() => {}} onRelease={() => {}} onSetHole={() => {}} courseTees={tees} />);
  const badges = Array.from(st.el.querySelectorAll("[data-net-badge]")).map((b) => b.textContent);
  ok(badges.length === 4 && badges.every((b) => /^net \d+$/.test(b || "")) && (st.el.textContent || "").includes("box = net score"), `stroke play: net score badges and legend (got ${badges})`);
  st.unmount();
  const sf = renderScreen(<GroupScorecard game={{ ...game, game_type: "stableford" } as Game} players={scored} allPlayers={scored} user={{ id: "Amit" } as never} isMarker markerName={null} onTakeOver={() => {}} onRelease={() => {}} onSetHole={() => {}} courseTees={tees} />);
  ok(!sf.el.querySelector("[data-net-badge]") && (sf.el.textContent || "").includes("box = net Stableford"), "Stableford: points, as before");
  sf.unmount();
}
report("tee yardage");
