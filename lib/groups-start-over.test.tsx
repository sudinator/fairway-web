/** 212.46 (owner, Oct 26) — Manage Game → Groups → Start over: clears every group, only before scores are entered;
 * after that, tapping it tells the organizer to reset the scores first, then redo the groups. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { decideSetupChange } from "@/lib/game-setup-policy";
import { GroupsBuilder } from "@/components/game/scorecard-views";
import type { Game, Player } from "@/lib/game-types";

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const teams = [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }];
const game = { id: "g", game_type: "fourball", status: "active", teams, holes_meta: holes, course_par: 72, allowance_pct: 85, pairings: [], foursomes: [] } as unknown as Game;
const P = (i: number, team: string, g: number | null, scored = false, locked = false) => ({ id: `p${i}`, user_id: `u${i}`, display_name: `P${i}`, course_handicap: 10 + i, course_handicap_source: "manual", team, tee_group: g, no_show: false, group_locked: locked, scores: scored ? [4, ...Array(17).fill(null)] : [] } as unknown as Player);
const fresh = [P(1, "A", 1), P(2, "A", 1), P(3, "B", 1), P(4, "B", 1)];
const rule = (players: Player[]) => decideSetupChange({ game, players, action: { type: "clear_groups" } } as never) as { decision: string; reason?: string };
ok(rule(fresh).decision !== "block", "Start over is allowed before any score");
const scored = rule([P(1, "A", 1, true), ...fresh.slice(1)]);
ok(scored.decision === "block" && (scored.reason || "").includes("Reset the scores first"), `once scores are in, it's blocked — and says to reset the scores first ("${scored.reason}")`);
ok(rule([P(1, "A", 1, false, true), ...fresh.slice(1)]).decision === "block", "a finished, locked group blocks it too");
(async () => {
  let cleared = 0;
  const on = renderScreen(<GroupsBuilder game={game} players={fresh} onSetTeeGroup={async () => {}} onSetTeamGroupSlot={async () => {}} onRandomize={async () => {}} canRandomize onClearGroups={async () => { cleared++; }} clearGroupsBlocked={null} />);
  const b1 = on.el.querySelector("[data-groups-start-over]") as HTMLButtonElement;
  ok(!!b1, "Manage Game's Groups shows Start over once groups exist");
  await act(async () => { b1.click(); });
  ok(cleared === 1, "before scores, Start over clears the groups");
  on.unmount();
  const msg = scored.reason ?? "";
  const off = renderScreen(<GroupsBuilder game={game} players={fresh} onSetTeeGroup={async () => {}} onSetTeamGroupSlot={async () => {}} onRandomize={async () => {}} canRandomize onClearGroups={async () => { cleared++; }} clearGroupsBlocked={msg} />);
  await act(async () => { (off.el.querySelector("[data-groups-start-over]") as HTMLButtonElement).click(); });
  ok(cleared === 1 && (off.el.querySelector("[data-groups-start-over-blocked]")?.textContent || "").includes("Reset the scores first"), "after scores, tapping it explains how to redo the groups — and clears nothing");
  off.unmount();
  report("groups start over");
})();
