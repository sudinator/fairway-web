import "./test-dom";
import * as React from "react";
import { act } from "react";
import { GameSetupWorkspace, type SetupTab } from "../components/game/setup/game-setup-workspace";
import type { Game, Player } from "./game-types";
import { applyTeamGroupSlotMove } from "./grouping";
import { ok, renderToDom, report, text } from "./test-render";

const game = {
  id: "g1", code: "912410", name: "Cup Trifecta", course: "Test Course", course_par: 72,
  holes_meta: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })),
  game_type: "trifecta", allowance_pct: 100, pairings: [], status: "active",
  teams: [{ key: "A", name: "Violet" }, { key: "B", name: "Burgundy" }],
  foursomes: [
    { id: "f1", name: "Group 1", a: ["a1", "a2"], b: ["b1", "b2"], swap: false },
    { id: "f2", name: "Group 2", a: ["a3", "a4"], b: ["b3", "b4"], swap: true },
  ], team_score_mode: "best_ball", trifecta_scoring: "match", created_by: "owner", created_at: "2026-09-03T00:00:00Z",
} satisfies Game;

const rows = [["a1","A",1,"Alice Adams"],["a2","A",1,"Ariana Allen"],["a3","A",2,"Avery Archer"],["a4","A",2,"Amelia Avery"],["b1","B",1,"Blake Brown"],["b2","B",1,"Bailey Brooks"],["b3","B",2,"Brooke Bell"],["b4","B",2,"Brett Baker"]] as const;
const players: Player[] = rows.map(([id, team, tee_group, display_name]) => ({
  id, game_id: "g1", user_id: id, display_name, handicap_index: 10, rating: 72, slope: 113,
  tee_name: "Blue", course_handicap: 10, scores: Array(18).fill(null), putts: Array(18).fill(null),
  fairways: Array(18).fill(null), team, tee_group,
}));

function Harness({ complete }: { complete: boolean }) {
  const [tab, setTab] = React.useState<SetupTab>("overview");
  const [shownPlayers, setShownPlayers] = React.useState<Player[]>(() => complete ? players : players.map((p) => ({ ...p, tee_group: null })));
  return <GameSetupWorkspace game={complete ? game : { ...game, foursomes: [] }} players={shownPlayers}
    setupTab={tab} onSetupTabChange={setTab} organizerPanelProps={{} as any} onSetGameDate={async()=>{}}
    courseOptions={[]} onChangeCourse={async()=>{}} onSetTeeGroup={async()=>{}} onSetTeamGroupSlot={async(current,next,group)=>setShownPlayers((ps)=>applyTeamGroupSlotMove(ps,current?.id||null,next?.id||null,group))}
    getTeeGroupPolicy={()=>({ blocked:false })} onRandomizeGroups={async()=>{}} canRandomize randomizeReason=""
    randomizing={false} groupOverflow={[]} isCompetitionGame />;
}

function click(container: HTMLElement, label: string, exact = false) {
  const button = Array.from(container.querySelectorAll("button")).find((b) => exact ? (b.textContent || "").trim() === label : (b.textContent || "").includes(label));
  ok(button, `${label} button is reachable`);
  if (!button) return;
  act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

{
  const v = renderToDom(<Harness complete />);
  click(v.container, "Teams");
  let rendered = text(v.container);
  ok(rendered.includes("RYDER CUP TEAMS"), "completed Teams click opens Teams");
  ok(rendered.includes("Violet") && rendered.includes("Burgundy"), "both teams render");
  players.forEach((p) => ok(rendered.includes(p.display_name), `Teams renders ${p.display_name}`));
  ok(!rendered.includes("Share the line-up"), "completed Teams does not redirect to Review");
  click(v.container, "Groups", true);
  ok(text(v.container).includes("GROUPS · BUILD EACH MATCH"), "Teams to Groups works");
  const slot = (group: number) => v.container.querySelector<HTMLSelectElement>(`select[aria-label="Group ${group} Violet player 1"]`)!;
  const emptySlot = (group: number) => Array.from(v.container.querySelectorAll<HTMLSelectElement>(`select[aria-label^="Group ${group} Violet player"]`)).find((s) => s.value === "")!;
  ok(slot(1).options.length === 2, "fully assigned occupied slot shows only current player and Move to unassigned");
  act(() => { slot(1).value = ""; slot(1).dispatchEvent(new Event("change", { bubbles: true })); });
  act(() => { slot(2).value = ""; slot(2).dispatchEvent(new Event("change", { bubbles: true })); });
  ok(Array.from(emptySlot(1).options).map((o) => o.value).filter(Boolean).sort().join(",") === "a1,a3", "empty slot shows only the two unassigned players");
  act(() => { const s = emptySlot(1); s.value = "a3"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  ok(Array.from(emptySlot(2).options).map((o) => o.value).filter(Boolean).join(",") === "a1", "assigned A3 disappears and only unassigned A1 remains");
  act(() => { const s = emptySlot(2); s.value = "a1"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  ok(players.every((p) => text(v.container).includes(p.display_name)), "all players remain visible after the exchange");
  click(v.container, "Control center");
  click(v.container, "Teams");
  ok(text(v.container).includes("Alice Adams"), "Teams survives Groups round trip");
  v.unmount();
}

{
  const v = renderToDom(<Harness complete={false} />);
  click(v.container, "Teams");
  ok(text(v.container).includes("RYDER CUP TEAMS"), "incomplete Teams click opens Teams");
  v.unmount();
}

report("game setup workspace navigation");
