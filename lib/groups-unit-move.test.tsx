/** 212.61 (owner, Oct 27: a matchup must move as one unit — "go through all formats") — the groups builder moves a unit
 * (a matchup) in ONE save when the caller offers a unit save (Manage Game: one server call), and member by member otherwise. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { GroupsBuilder } from "@/components/game/scorecard-views";
import type { Game, Player } from "@/lib/game-types";

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const P = (i: number) => ({ id: `p${i}`, user_id: `u${i}`, display_name: `Player ${i}`, handicap_index: 10, course_handicap: 10, tee_group: null, no_show: false, scores: [] } as unknown as Player);
const players = [1, 2, 3, 4].map(P);
const match = { id: "g", status: "active", game_type: "match", pairings: [{ a: "u1", b: "u2" }, { a: "u3", b: "u4" }], foursomes: null, teams: null, holes_meta: holes, course_par: 72 } as unknown as Game;

(async () => {
const unitCalls: { members: string[]; group: number | null }[] = [];
const singleCalls: { id: string; group: number | null }[] = [];
let t = renderScreen(<GroupsBuilder game={match} players={players}
  onSetTeeGroup={async (p, g) => { singleCalls.push({ id: p.id, group: g }); }}
  onSetUnitGroup={async (ms, g) => { unitCalls.push({ members: ms.map((m) => m.id), group: g }); }} />);
const unitSelects = () => [...t.el.querySelectorAll("select")].filter((sel) => [...(sel as HTMLSelectElement).options].some((o) => o.textContent === "No group")) as HTMLSelectElement[];
ok(unitSelects().length === 2 && (t.el.textContent || "").includes("Player 1 v Player 2"), "match play: the units are the two matchups, named by their players");
await act(async () => { const sel = unitSelects()[0]; sel.value = "1"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
ok(unitCalls.length === 1 && JSON.stringify(unitCalls[0]) === JSON.stringify({ members: ["p1", "p2"], group: 1 }) && singleCalls.length === 0,
  `moving a matchup is ONE save with both players (got unit ${JSON.stringify(unitCalls)}, single ${JSON.stringify(singleCalls)})`);
t.unmount();

// without a unit save on offer: member by member, both members, same group
unitCalls.length = 0;
t = renderScreen(<GroupsBuilder game={match} players={players} onSetTeeGroup={async (p, g) => { singleCalls.push({ id: p.id, group: g }); }} />);
await act(async () => { const sel = unitSelects()[1]; sel.value = "2"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
ok(JSON.stringify(singleCalls) === JSON.stringify([{ id: "p3", group: 2 }, { id: "p4", group: 2 }]), `without a unit save, both members are set one after the other (got ${JSON.stringify(singleCalls)})`);
ok(!!t.el.querySelector("[data-build-match-groups]") === false, "no Build groups button when the caller offers no group builder");
t.unmount();
report("groups unit move");
})();
