/** 212.76 (owner, Oct 30): a live player's course handicap comes from ONE place. Set an override, clear it, change the
 *  tee: the leaderboard label, the organizer panel's line, the setup summary, the public line-up and the scoring basis
 *  all show the same figure at every step — including a row whose stored number is stale (the 947286 case). */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { LeaderRow } from "@/components/game/leader-row";
import { courseHandicapOf, chBasis, hasCourseHandicap } from "@/lib/game-shape";
import { buildSetupSummary } from "@/lib/setup-summary";
import { manualHandicapPatch } from "@/lib/manual-handicap";
import type { Player } from "@/lib/game-types";

const game = { id: "g", name: "Sunday", course: "Oak Hollow", course_par: 72, allowance_pct: 100, game_type: "stableford", holes_meta: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })) } as never;
const base = { id: "p1", user_id: "u1", display_name: "Ankur Tiku", handicap_index: 13, rating: 72.4, slope: 138, tee_name: "Blue", scores: [], no_show: false } as unknown as Player;
const derived = Math.round(13 * (138 / 113) + (72.4 - 72));   // 16 on this tee — the figure every screen must show
const figures = (p: Player) => {
  const t = renderScreen(<LeaderRow coursePar={72} holeCount={18} p={p} pos={1} tied={false} showTag={false} showBetStatus={false} user={{ id: "u9" }} isStroke={false} strokeNet={false}
    playerPoints={() => 0} playerThru={() => 0} playerNet={() => 0} playerGross={() => 0} parThru={() => 0} relToParStr={() => ""} leaderName={(x) => x} />);
  const label = (t.el.textContent || "").match(/CH (\d+)|no hcp/)?.[0] ?? "?"; t.unmount();
  const summary = buildSetupSummary(game, [p as never]).split("\n").find((l) => l.includes("Ankur"))?.match(/CH (\d+|—)/)?.[1] ?? "?";
  return { label, accessor: courseHandicapOf(p, 72, 18), scoring: Math.round(chBasis(p, 72, 18)), summary, has: hasCourseHandicap(p, 72) };
};
// 1. joined: stored = derived
const joined = { ...base, course_handicap: derived, course_handicap_source: "derived" } as Player;
let f = figures(joined);
ok(f.label === `CH ${derived}` && f.accessor === derived && f.scoring === derived && f.summary === String(derived), `joined: every reading ${derived} (got ${JSON.stringify(f)})`);
// 2. an override of 13
const over = { ...joined, ...manualHandicapPatch(joined, 72, 13, "u-amit") } as Player;
f = figures(over);
ok(f.label === "CH 13" && f.accessor === 13 && f.scoring === 13 && f.summary === "13", `override: every reading 13 (got ${JSON.stringify(f)})`);
// 3. cleared (212.75 stores the derived figure)
const cleared = { ...over, ...manualHandicapPatch(over, 72, null, "u-amit") } as Player;
f = figures(cleared);
ok(f.label === `CH ${derived}` && f.accessor === derived && f.scoring === derived && f.summary === String(derived), `cleared: every reading back to ${derived} (got ${JSON.stringify(f)})`);
// 4. the 947286 case: a row cleared by the OLD code (stored 13, source derived) — the displays must still agree with scoring
const stale = { ...base, course_handicap: 13, course_handicap_source: "derived" } as Player;
f = figures(stale);
ok(f.label === `CH ${derived}` && f.accessor === derived && f.scoring === derived && f.summary === String(derived), `a stale row: every reading ${derived}, never the stored 13 (got ${JSON.stringify(f)})`);
// 5. a tee change: the figure follows the tee everywhere
const whiteTee = { ...cleared, rating: 70.1, slope: 125 } as Player;
const onWhite = Math.round(13 * (125 / 113) + (70.1 - 72));
f = figures(whiteTee);
ok(f.label === `CH ${onWhite}` && f.accessor === onWhite && f.scoring === onWhite && f.summary === String(onWhite), `tee change: every reading ${onWhite} (got ${JSON.stringify(f)})`);
// 6. no handicap at all
f = figures({ ...base, handicap_index: null, rating: null, slope: null, course_handicap: null } as Player);
ok(f.label === "no hcp" && f.accessor === null && !f.has && f.summary === "—", `no handicap: "no hcp" everywhere (got ${JSON.stringify(f)})`);
report("course handicap one source");
