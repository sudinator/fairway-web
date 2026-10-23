// 212.24 — the segment side contest for individual games: three sixes (default) / front 9 & back 9 / off; TGC money
// games always three sixes. The new general calculation must equal the original sixes exactly (the money game's).
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { segOf, segLeadersFrom, indivSegScheme, segRanges, segValues, segLeadersFor } from "@/lib/segments";
import { IndivSegmentChoice } from "@/components/game/segment-views";
import type { Game, Player } from "@/lib/game-types";

const PAR = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4], SI = [7, 3, 17, 1, 11, 15, 5, 9, 13, 8, 2, 18, 4, 12, 6, 16, 10, 14];
const holes = PAR.map((p, i) => ({ n: i + 1, par: p, si: SI[i] }));
let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const mk = (k: number, thru: number) => ({ id: `p${k}`, user_id: `p${k}`, display_name: `P${k}`, course_handicap: Math.floor(rnd() * 25), course_handicap_source: "manual",
  scores: PAR.map((p, i) => (i < thru ? Math.max(1, p + Math.floor(rnd() * 4) - 1) : null)), no_show: false } as unknown as Player);
for (const gt of ["stableford", "stroke"]) {
  const game = { id: "g", game_type: gt, holes_meta: holes, course_par: 72, allowance_pct: 100 } as unknown as Game;
  let same = true;
  for (let t = 0; t < 40; t++) {
    const ps = Array.from({ length: 2 + (t % 4) }, (_, k) => mk(k, [18, 12, 7, 18, 3][t % 5]));
    const six = segRanges("sixes", 18);
    for (const p of ps) if (JSON.stringify(segValues(p, game, six)) !== JSON.stringify(segOf(p, game))) same = false;
    const a = segLeadersFor(ps.map((p) => ({ p, seg: segValues(p, game, six) })), game, six);
    const b = segLeadersFrom(ps.map((p) => ({ p, seg: segOf(p, game) })), game);
    if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
  }
  ok(same, `${gt}: three sixes — the new calculation equals the original (the money game's) exactly, 40 random groups`);
}
const nines = segRanges("nines", 18);
ok(nines.length === 2 && nines[0].from === 0 && nines[0].to === 9 && nines[1].label === "Back 9", "front 9 & back 9");
ok(segRanges("nines", 9).length === 1 && segRanges("nines", 9)[0].label === "Front 9" && segRanges("none", 18).length === 0, "a 9-hole game: front only; off: none");
const g = (scheme?: string) => ({ id: "g", game_type: "stableford", holes_meta: holes, ...(scheme ? { leg_config: { scheme, metric: "pts", points: {} } } : {}) } as unknown as Game);
ok(indivSegScheme(g(), false) === "sixes" && indivSegScheme(g("nines"), false) === "nines" && indivSegScheme(g("none"), false) === "none", "default three sixes; nines and off as chosen");
ok(indivSegScheme(g("nines"), true) === "sixes" && indivSegScheme(g("none"), true) === "sixes", "a TGC money game is always three sixes");
{
  let saved: any = null;
  const c = renderScreen(<IndivSegmentChoice game={g()} moneyGame={false} onSave={(cfg) => { saved = cfg; }} />);
  const nineBtn = Array.from(c.el.querySelectorAll("button")).find((b) => b.textContent === "Nines") as HTMLButtonElement;
  act(() => { nineBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(c.el.querySelectorAll("button").length === 3 && saved?.scheme === "nines", `three choices; Nines saves "nines" (got ${saved?.scheme})`);
  c.unmount();
  const m = renderScreen(<IndivSegmentChoice game={g()} moneyGame onSave={() => {}} />);
  ok(m.el.querySelectorAll("button").length === 0 && (m.el.textContent || "").includes("Three sixes — the money game pays on them."), "a money game: three sixes, shown not offered");
  m.unmount();
}
report("segment schemes");
