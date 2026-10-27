/** 212.51 (owner, Oct 26: "I can still enter details for a guest … no message either way") — when adding players isn't
 * allowed, Manage Game → Players shows WHY instead of forms that can only fail; when it is allowed, the forms work. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { OrganizerPanel } from "@/components/game/organizer-panel";
import type { Game, Player } from "@/lib/game-types";

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const P = (i: number, team: string | null, scored: boolean) => ({ id: `p${i}`, user_id: `u${i}`, display_name: `Player ${i}`, handicap_index: 10, course_handicap: 10, team, tee_group: 1, no_show: false, scores: scored ? [4, ...Array(17).fill(null)] : [] } as unknown as Player);
const noop = async () => {};
const panel = (game: Game, players: Player[]) => renderScreen(<OrganizerPanel section="players" game={game} players={players} user={{ id: "u1" }} courseTees={[]}
  onSetTeam={noop} onOverride={noop} onSetTee={noop} onRemove={noop} onToggleNoShow={noop} onRename={noop} onDelete={noop} onEnd={noop} onReopen={noop} onReset={noop} onShare={noop}
  eligibleMembers={[{ id: "u9", display_name: "Late Member", handicap_index: 12 }]} onAddMember={noop} onAddGuest={noop} />);

const fourball = { id: "g", status: "active", game_type: "fourball", teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }], foursomes: [], pairings: [], holes_meta: holes, course_par: 72, allowance_pct: 85 } as unknown as Game;
const scoredFour = [P(1, "A", true), P(2, "A", false), P(3, "B", false), P(4, "B", false)];
let t = renderScreen(<div />); t.unmount();
t = panel(fourball, scoredFour);
const note = t.el.querySelector("[data-add-blocked]")?.textContent || "";
ok(note.includes("cannot be added after scoring starts") && !t.el.querySelector('input[placeholder="Guest name"]') && !(t.el.textContent || "").includes("Late Member"),
  `four-ball underway: the reason shows instead of the add forms ("${note.slice(0, 80)}")`);
t.unmount();
t = panel({ ...fourball, status: "ended", game_type: "stableford", teams: null } as unknown as Game, scoredFour.map((p) => ({ ...p, team: null }) as Player));
ok(!!t.el.querySelector("[data-add-blocked]") && (t.el.querySelector("[data-add-blocked]")?.textContent || "").includes("ended"), "an ended game: the reason (reopen first) shows instead of the forms");
t.unmount();
t = panel({ ...fourball, game_type: "stableford", teams: null } as unknown as Game, scoredFour.map((p) => ({ ...p, team: null }) as Player));
ok(!t.el.querySelector("[data-add-blocked]") && !!t.el.querySelector('input[placeholder="Guest name"]') && (t.el.textContent || "").includes("Late Member"), "Stableford underway: adding is allowed (after a confirmation), so the forms are there");
t.unmount();
t = panel(fourball, scoredFour.map((p) => ({ ...p, scores: [] }) as Player));
ok(!t.el.querySelector("[data-add-blocked]") && !!t.el.querySelector('input[placeholder="Guest name"]'), "four-ball before any score: the forms are there");
t.unmount();
report("add player blocked");
