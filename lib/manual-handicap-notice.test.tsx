import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { OrganizerPanel } from "@/components/game/organizer-panel";
import type { Game, Player } from "@/lib/game-types";

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const P = (i: number, team: string | null, scored: boolean) => ({ id: `p${i}`, user_id: `u${i}`, display_name: `Player ${i}`, handicap_index: 10, course_handicap: 10, team, tee_group: 1, no_show: false, scores: scored ? [4, ...Array(17).fill(null)] : [] } as unknown as Player);
const noop = async () => {};
const panel = (game: Game, players: Player[]) => renderScreen(<OrganizerPanel section="players" game={game} players={players} user={{ id: "u1" }} courseTees={[]}
  onSetManualHandicap={noop} onSetTeam={noop} onOverride={noop} onSetTee={noop} onRemove={noop} onToggleNoShow={noop} onRename={noop} onDelete={noop} onEnd={noop} onReopen={noop} onReset={noop} onShare={noop}
  eligibleMembers={[{ id: "u9", display_name: "Late Member", handicap_index: 12 }]} onAddMember={noop} onAddGuest={noop} />);

for (const n of [9,18,9]) {
 const game = { id: "g", status: "active", game_type: "stableford", teams: null, pairings: [], foursomes: [], holes_meta: holes.slice(0,n), course_par: n*4, allowance_pct: 85 } as unknown as Game;
 const p = { ...P(1,null,false), course_handicap: 12, course_handicap_source: "manual" } as Player;
 const t=panel(game,[p]); const text=t.el.textContent || "";
 ok(text.includes(`applied as entered for this ${n}-hole game`), `${n}: saved override explains length`);
 ok(text.includes("Format allowance: 85%"), `${n}: allowance separate`);
 ok(n===18 || text.includes("It will not be halved"), "nine warns explicitly");
 t.unmount();
 const d=panel(game,[{ ...p, course_handicap_source: "derived" } as Player]);
 ok((d.el.textContent || "").includes(`A manual entry applies as entered for ${n} holes`), "entry notice before manual setting"); d.unmount();
}
report("manual handicap notice");
