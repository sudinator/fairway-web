/** RENDERED CHECK (209.5): a Cup session's recap shows the Cup's standing; other games don't. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { RecapBody } from "@/components/game/recap-body";
import { buildRecap } from "@/lib/game-recap";
import type { CupLine } from "@/lib/cup-standing";
import type { Game, Player } from "@/lib/game-types";

const holes = Array.from({ length: 3 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const game = { id: "g3", code: "123456", name: "Saturday Singles", course: "T", course_par: 12, holes_meta: holes, game_type: "match", allowance_pct: 100,
  pairings: [{ a: "a", b: "b" }], teams: [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }], foursomes: null, status: "ended",
  played_at: "2026-10-18", created_by: "x", created_at: "2026-10-18T00:00:00Z" } as unknown as Game;
const base = { game_id: "g3", avatar_url: null, handicap_index: 0, rating: 72, slope: 113, tee_name: "Blue", course_handicap: 0, putts: [], fairways: [] };
const players = [{ ...base, id: "pa", user_id: "a", display_name: "Al", team: "A", scores: [4, 4, 4] }, { ...base, id: "pb", user_id: "b", display_name: "Bo", team: "B", scores: [5, 5, 5] }] as unknown as Player[];
const cup: CupLine = { name: "Livingston Ryder Cup", aName: "Red", bName: "Blue", aColour: "#E0695B", bColour: "#5AA9E6", a: "9½", b: "6½",
  sessionNo: 3, sessionCount: 5, final: false, detail: "12 points left · Red need 5 more to win, Blue need 8" };

for (const mode of ["share", "app"] as const) {
  const t = renderScreen(<RecapBody game={game} recap={buildRecap(game, players)} mode={mode} cup={cup} />);
  const box = t.el.querySelector("[data-recap-cup]")?.textContent || "";
  ok(box.includes("LIVINGSTON RYDER CUP · AFTER THIS SESSION") && box.includes("Red 9½") && box.includes("Blue 6½") && box.includes("Red need 5 more to win, Blue need 8"), `${mode}: the Cup box`);
  ok((t.el.textContent || "").includes("Session 3 of 5"), `${mode}: "Session 3 of 5" in the header`);
  t.unmount();
}
const plain = renderScreen(<RecapBody game={game} recap={buildRecap(game, players)} mode="share" />);
ok(!plain.el.querySelector("[data-recap-cup]") && !(plain.el.textContent || "").includes("Session "), "a game that isn't a Cup session: no box");
plain.unmount();
report("cup on the recap");
