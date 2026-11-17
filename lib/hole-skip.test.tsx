/** 212.111 (owner, Nov 16): a skipped hole asks first — "Hole 2 hasn't been scored yet. You're probably on hole 2." */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { expectedNextHole, holeSkip } from "@/lib/hole-skip";
import { GroupScorecard } from "@/components/game/scorecard-views";
import type { Game, Player } from "@/lib/game-types";

const row = (...scored: number[]) => Array.from({ length: 18 }, (_, i) => (scored.includes(i + 1) ? 4 : null));
// ── the rule ──
ok(expectedNextHole([row()], 18) === null && holeSkip([row()], 18, 9) === null, "nothing scored yet: any hole may be first (a shotgun start)");
ok(expectedNextHole([row(1)], 18) === 1 && holeSkip([row(1)], 18, 2)?.expectedIdx === 1, "after hole 1, opening hole 3 skips hole 2");
ok(holeSkip([row(1)], 18, 1) === null, "after hole 1, opening hole 2 is right");
ok(holeSkip([row(1, 2, 3)], 18, 1) === null, "opening a hole already scored is an edit, never a warning");
ok(holeSkip([row(1), row(1, 2)], 18, 2) === null, "the expected hole scored by ANYONE in the group clears it");
ok(expectedNextHole([row(10, 11, 12)], 18) === 12 && holeSkip([row(10, 11, 12)], 18, 13)?.expectedIdx === 12, "a shotgun start on 10: after 12, opening 14 skips 13");
ok(expectedNextHole([row(10, 11, 12, 13, 14, 15, 16, 17, 18)], 18) === 0, "after 18 the run wraps to hole 1");
ok(expectedNextHole([row(10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2)], 18) === 2 && holeSkip([row(10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2)], 18, 2) === null && holeSkip([row(10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2)], 18, 3)?.expectedIdx === 2, "a wrapped run continues from the low holes: hole 3 is right, hole 4 skips it");
// ── the screen ──
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const P = (i: number, name: string, scores: (number | null)[]) => ({ id: `p${i}`, user_id: `u${i}`, display_name: name, handicap_index: 10, course_handicap: 10, tee_group: 1, no_show: false, scores, putts: [], fairways: [] } as unknown as Player);
const players = [P(1, "Amit", row(1)), P(2, "Probir", row(1))];
const game = { id: "g", status: "active", game_type: "stableford", teams: null, foursomes: null, pairings: [], holes_meta: holes, course_par: 72, allowance_pct: 100 } as unknown as Game;
const noop = async () => {};
const t = renderScreen(<GroupScorecard game={game} players={players} allPlayers={players} user={{ id: "u1" }} isMarker={true} markerName="Amit" onTakeOver={noop} onRelease={noop} onSetHole={noop} teeMode groupLabel="Group 1" />);
const cell = (holeN: number, name: string) => [...t.el.querySelectorAll("[data-hole-cell]")].find((c) => c.getAttribute("data-hole-cell") === `${holeN}:${name}`) as HTMLElement | undefined;
ok(!!cell(3, "Amit"), "the card marks its score cells");
act(() => { cell(3, "Amit")!.click(); });
ok(!!t.el.querySelector("[data-hole-skip-ask]") && (t.el.textContent || "").includes("Hole 2 hasn’t been scored yet"), "tapping hole 3 after hole 1 asks about hole 2");
t.click("Score hole 2");
ok(!t.el.querySelector("[data-hole-skip-ask]") && (t.el.textContent || "").includes("Hole 2") && !!t.el.querySelector("[data-hole-editor]"), "'Score hole 2' opens hole 2 instead");
t.unmount();
report("hole skip");
