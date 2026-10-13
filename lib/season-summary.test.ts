function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
import { buildSeasonSummary } from "./season-summary";
import { runningHandicap, handicapRounds, type Round } from "./golf";
import { prepareRounds } from "./round-prep";
// 20 identical rounds with one triple-bogey hole on SI 1. A 19-handicap receives a stroke there, so
// net double bogey caps it at par+3, not par+2. Without stroke allocation the season builder capped
// it lower and understated the index (real data: 11.9 against the Dashboard's 12.8, 2026-10-13).
const pars = [4,4,3,5,4,3,4,5,4, 4,3,5,4,4,3,4,5,4];
const mk = (i: number): Round => ({ id: `r${i}`, course: "Test CC", tee_name: "Blue", rating: 72, slope: 130, course_par: 72, handicap_index: 16, course_handicap: 19,
  played_at: `2026-${String(4 + Math.floor(i / 4)).padStart(2, "0")}-${String(1 + (i % 4) * 7).padStart(2, "0")}`, status: "final",
  holes: pars.map((par, h) => ({ hole_number: h + 1, par, stroke_index: h + 1, strokes: h === 0 ? par + 3 : par + 1, putts: 2, fairway: null, penalties: 0 })) });
const rounds = Array.from({ length: 20 }, (_, i) => mk(i));
const s = buildSeasonSummary({ year: 2026, name: "T", rounds });
const idx = (s.cards.find((c) => c.kind === "index") as any).end;
eq(idx, runningHandicap(handicapRounds(prepareRounds(rounds))).index, "season index equals the Dashboard computation");
eq(idx !== runningHandicap(handicapRounds(rounds)).index, true, "and differs from the unallocated computation (the bug)");
eq(s.cards.some((c) => (c as any).kind === "money"), false, "no money card");
console.log("season-summary tests passed");
