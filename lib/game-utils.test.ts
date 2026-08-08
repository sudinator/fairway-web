import { makeCode, defaultTeeIdx, todayLocalStr, normalizeFavoriteCourse, refTee, blankCard, GP_STATE_DEFAULTS } from "./game-utils";
import type { Game, Player } from "./game-types";

let pass = 0, fail = 0; const fails: string[] = [];
function eq<T>(name: string, got: T, want: T) { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) pass++; else { fail++; fails.push(`${name} (got ${g}, want ${w})`); } }

// makeCode — 6 digits, never leading-zero
for (let i = 0; i < 200; i++) { const c = makeCode(); if (!/^[1-9]\d{5}$/.test(c)) { fail++; fails.push(`makeCode bad: ${c}`); break; } }
pass++;

// defaultTeeIdx — every branch
const T = (name: string, yds: number | null) => ({ name, yardages: yds == null ? undefined : Array(18).fill(yds / 18) });
eq("tee: empty -> 0", defaultTeeIdx([], true), 0);
eq("tee: not array -> 0", defaultTeeIdx(null as any, true), 0);
eq("tee: smart off -> 0", defaultTeeIdx([T("Blue", 7000), T("Member", 6400)], false), 0);
eq("tee: member wins", defaultTeeIdx([T("Blue", 7000), T("Member Tees", 5900)], true), 1);
eq("tee: closest to 6400", defaultTeeIdx([T("Tips", 7200), T("Blue", 6500), T("White", 6000)], true), 1);
eq("tee: no yardages -> 0", defaultTeeIdx([T("A", null), T("B", null)], true), 0);

// todayLocalStr — format + matches current local date
{
  const d = new Date();
  const want = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  eq("today: format+value", todayLocalStr(), want);
}

// normalizeFavoriteCourse — every branch
eq("norm: null -> {}", normalizeFavoriteCourse(null), {});
eq("norm: bare course passthrough", normalizeFavoriteCourse({ name: "X", holes: [{ n: 1 }] }).name, "X");
eq("norm: row.data unwrap", normalizeFavoriteCourse({ data: { name: "Y", holes: [{ n: 1 }] } }).name, "Y");
{
  const r = normalizeFavoriteCourse({ data: { name: "Z", tees: [{ name: "W", rating: 70, slope: 120, par: 72, yardages: [400], holes: [{ n: 1, par: 4 }] }] } });
  eq("norm: holes lifted from tee", r.holes, [{ n: 1, par: 4 }]);
  eq("norm: tees slimmed", r.tees, [{ name: "W", rating: 70, slope: 120, par: 72, yardages: [400] }]);
}
{
  const r = normalizeFavoriteCourse({ data: { name: "Q", holes: [{ n: 9 }], tees: [{ name: "T", holes: [{ n: 1 }] }] } });
  eq("norm: existing holes kept", r.holes, [{ n: 9 }]);
}

// refTee / blankCard
const P = (o: Partial<Player>): Player => ({ id: "p", game_id: "g", user_id: "u", display_name: "A", handicap_index: null, rating: null, slope: null, tee_name: null, course_handicap: 0, scores: [], putts: [], fairways: [], ...o }) as Player;
eq("refTee: first with data", refTee([P({}), P({ rating: 70.1, slope: 125, tee_name: "Blue" })]), { rating: 70.1, slope: 125, tee_name: "Blue" });
eq("refTee: fallback first", refTee([P({ rating: null }), P({ rating: null })]), { rating: null, slope: null, tee_name: null });
eq("refTee: empty -> nulls", refTee([]), { rating: null, slope: null, tee_name: null });
{
  const g9 = { holes_meta: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })) } as Game;
  eq("blank: 9-hole size", blankCard(g9).scores.length, 9);
  eq("blank: null game -> 18", blankCard(null).scores.length, 18);
  eq("blank: defaults merged", blankCard(null).is_marker, false);
  eq("blank: GP defaults shape", GP_STATE_DEFAULTS.group_locked, false);
}

console.log(`game-utils: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
