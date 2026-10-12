function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
function assert(v: unknown, m: string): asserts v { if (!v) throw new Error(m); }
import { balanceTeams, balanceSummary, playingHandicapOf } from "./balance-teams";
const H = Array.from({ length: 18 }, (_, i) => ({ n: i + 1 }));
const G = { allowance_pct: 100, course_par: 72, holes_meta: H, teams: [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }] };
const P = (id: string, name: string, ch: number | null, team: string | null = null) => ({ id, user_id: id, display_name: name, course_handicap: ch, team });

// Eight players, descending 20..6: snake gives A,B,B,A,A,B,B,A → sums equal.
{
  const ps = [P("1","a",20),P("2","b",18),P("3","c",16),P("4","d",14),P("5","e",12),P("6","f",10),P("7","g",8),P("8","h",6)];
  const r = balanceTeams(G, ps);
  eq(r.teams[0].total, 52, "Red total"); eq(r.teams[1].total, 52, "Blue total");
  eq(r.assignments.length, 8, "all eight placed (none had a team)");
  eq(r.teams[0].members.join(","), "a,d,e,h", "snake: 1st, 4th, 5th, 8th");
  assert(balanceSummary(r).startsWith("Red 52 (avg 13) · Blue 52 (avg 13) — difference 0"), balanceSummary(r));
}
// Odd count: the extra player goes to the lighter side.
{
  const r = balanceTeams(G, [P("1","a",20),P("2","b",10),P("3","c",10)]);
  eq(r.teams[0].total, 20, "Red: the 20"); eq(r.teams[1].total, 20, "Blue: both 10s");
}
// Allowance applies: the basis is the PLAYING handicap (90% of CH, rounded), as the match is played.
{
  const g90 = { ...G, allowance_pct: 90 };
  eq(playingHandicapOf(g90, P("1","a",15)), 14, "15 at 90% plays off 14");
}
// Locked (scored) players stay put and count toward their side.
{
  const ps = [P("1","a",20,"B"),P("2","b",18),P("3","c",16),P("4","d",14)];
  const r = balanceTeams(G, ps, new Set(["1"]));
  assert(!r.assignments.find((x) => x.id === "1"), "locked player not reassigned");
  eq(r.teams[1].members[0], "a", "locked player counted on Blue");
  const diff = Math.abs(r.teams[0].total - r.teams[1].total);
  assert(diff <= 4, `sides within one player of each other after honouring the lock (diff ${diff})`);
}
// No-shows are ignored; unrated players are placed last, counted as 0, and named.
{
  const ps = [P("1","a",20),P("2","b",null),{ ...P("3","c",10), no_show: true },P("4","d",12)];
  const r = balanceTeams(G, ps);
  eq(r.unrated.join(","), "b", "unrated named");
  assert(!r.teams.some((t) => t.members.includes("c")), "no-show not placed");
}
// Fewer than two teams: nothing to do.
eq(balanceTeams({ ...G, teams: [{ key: "A", name: "Only" }] }, [P("1","a",10)]).assignments.length, 0, "one team → no assignments");
// Only CHANGES are listed: a player already on the right side is not rewritten.
{
  const ps = [P("1","a",20,"A"),P("2","b",18,"B"),P("3","c",16,"B"),P("4","d",14,"A")];
  eq(balanceTeams(G, ps).assignments.length, 0, "already balanced → no writes");
}
// 203.1: the callers refuse to proceed while anyone is unrated — the library must always NAME them.
{
  const r = balanceTeams(G, [P("1","a",20),P("2","b",null),P("3","c",null)]);
  eq(r.unrated.join(","), "b,c", "every unrated player named, in roster order");
}
// THE BUG (2026-10-12): a skewed field. Lighter-side-only dealing put the 30 alone against three 2s.
// Equal numbers are the hard rule: 2 v 2, and the best split within that is {30,2} v {2,2}.
{
  const r = balanceTeams(G, [P("1","big",30),P("2","a",2),P("3","b",2),P("4","c",2)]);
  eq(r.teams[0].members.length, 2, "two a side"); eq(r.teams[1].members.length, 2, "two a side");
  eq(Math.max(r.teams[0].total, r.teams[1].total), 32, "best achievable with equal counts");
}
// Equal counts on every even field, one apart on every odd field, across random handicaps.
{
  let seed = 7; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let trial = 0; trial < 60; trial++) {
    const sz = 4 + Math.floor(rnd() * 17);
    const ps = Array.from({ length: sz }, (_, i) => P(String(i), "p" + i, Math.floor(rnd() * 36)));
    const r = balanceTeams(G, ps);
    const diff = Math.abs(r.teams[0].members.length - r.teams[1].members.length);
    assert(diff === (sz % 2), `field of ${sz}: counts ${r.teams[0].members.length} v ${r.teams[1].members.length}`);
  }
}
// The swap pass never widens a gap and finds the best equal-count split on a small field.
{
  const r = balanceTeams(G, [P("1","a",25),P("2","b",10),P("3","c",9),P("4","d",1)]);
  eq(Math.abs(r.teams[0].total - r.teams[1].total), 7, "{25,1} v {10,9}: the best equal-count split");
}
console.log("balance-teams tests passed");
