// Unit tests for lib/card — run with `npm test`.
import { rollingForm, computeCardStats } from "./card";
import type { Round } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; fails.push("FAIL " + name); } };

// gross-only round: differential = (113/slope)*(gross-rating) = gross-72 with slope 113, rating 72
const g = (gross: number, day: string): Round => ({
  id: "r" + gross + day, course: "X", tee_name: null, rating: 72, slope: 113, course_par: 72,
  handicap_index: null, course_handicap: null, played_at: day, gross_score: gross, holes: [],
});

{
  // diffs [8,8,8,8,8,2] -> rolling5 [8,8,8,8,8,6.8]
  const rs = [g(80, "2026-01-01"), g(80, "2026-01-02"), g(80, "2026-01-03"), g(80, "2026-01-04"), g(80, "2026-01-05"), g(74, "2026-01-06")];
  const f = rollingForm(rs);
  ok("rolling form length = 6", f.length === 6);
  ok("rolling form first = 8", f[0] === 8);
  ok("rolling form last = 6.8", f[5] === 6.8);
}
{
  // chronological independence: unsorted input still sorts by played_at
  const f = rollingForm([g(74, "2026-01-06"), g(80, "2026-01-01")]);
  ok("sorts by date: first is the earlier (8)", f[0] === 8);
}
{
  const rs = [g(90, "2026-01-01"), g(90, "2026-01-02"), g(90, "2026-01-03"), g(90, "2026-01-04"), g(90, "2026-01-05"), g(74, "2026-01-06"), g(74, "2026-01-07"), g(74, "2026-01-08")];
  const s = computeCardStats(rs);
  ok("rounds counted", s.rounds === 8);
  ok("form present", s.form.length > 0);
  ok("index computed (>=3 rounds)", s.idx != null);
  ok("trend improving after low rounds (<= 0)", s.idx_trend != null && s.idx_trend <= 0);
}
{
  // 7 rounds: prior (excluding last 5) has only 2 rounds -> trend null by design
  const rs = [g(90, "2026-01-01"), g(90, "2026-01-02"), g(90, "2026-01-03"), g(90, "2026-01-04"), g(90, "2026-01-05"), g(74, "2026-01-06"), g(74, "2026-01-07")];
  ok("trend null when <8 rounds", computeCardStats(rs).idx_trend == null);
}
{
  const s = computeCardStats([g(85, "2026-01-01")]);
  ok("single round: index null (<3)", s.idx == null);
  ok("single round: trend null", s.idx_trend == null);
}

console.log(`card: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
