// Unit tests for lib/grouping.ts — run with `npm test`.
import { buildParties, seatParties, randomTeeGroups, seededRng, GPlayer } from "./grouping";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; fails.push("FAIL " + name); } };
const eq = (name: string, got: any, exp: any) => ok(name + " (got " + JSON.stringify(got) + ")", JSON.stringify(got) === JSON.stringify(exp));

const M = (id: string): GPlayer => ({ id, userId: "u_" + id, isGuest: false, guestOf: null });
const G = (id: string, sponsor: string | null): GPlayer => ({ id, userId: null, isGuest: true, guestOf: sponsor ? "u_" + sponsor : null });

// group sizes from an assignment set
const sizes = (r: { assignments: { playerId: string; group: number }[] }) => {
  const m = new Map<number, number>();
  r.assignments.forEach((a) => m.set(a.group, (m.get(a.group) || 0) + 1));
  return [...m.values()].sort((a, b) => b - a);
};
const groupOf = (r: { assignments: { playerId: string; group: number }[] }, id: string) =>
  r.assignments.find((a) => a.playerId === id)?.group;

// ---- 1. No group ever exceeds 4, across many field sizes and seeds ----
for (let n = 1; n <= 24; n++) {
  const field = Array.from({ length: n }, (_, i) => M("m" + i));
  for (let s = 1; s <= 5; s++) {
    const r = randomTeeGroups(field, 4, seededRng(s * 100 + n));
    ok("n=" + n + " seed=" + s + " no group > 4", sizes(r).every((x) => x <= 4));
    ok("n=" + n + " seed=" + s + " everyone placed", r.assignments.length === n);
  }
}

// ---- 2. Balanced sizes (no lone single when avoidable) ----
eq("5 members -> [3,2]", sizes(randomTeeGroups(Array.from({ length: 5 }, (_, i) => M("m" + i)), 4, seededRng(7))), [3, 2]);
eq("8 members -> [4,4]", sizes(randomTeeGroups(Array.from({ length: 8 }, (_, i) => M("m" + i)), 4, seededRng(7))), [4, 4]);
eq("10 members -> [4,3,3]", sizes(randomTeeGroups(Array.from({ length: 10 }, (_, i) => M("m" + i)), 4, seededRng(7))), [4, 3, 3]);
eq("9 members -> [3,3,3]", sizes(randomTeeGroups(Array.from({ length: 9 }, (_, i) => M("m" + i)), 4, seededRng(7))), [3, 3, 3]);

// ---- 3. Guests stay with their sponsor ----
{
  const field = [M("a"), M("b"), M("c"), M("d"), M("e"), M("f"), G("g1", "a"), G("g2", "a")];
  for (let s = 1; s <= 8; s++) {
    const r = randomTeeGroups(field, 4, seededRng(s));
    const ga = groupOf(r, "a");
    ok("seed=" + s + " guest g1 with sponsor a", groupOf(r, "g1") === ga);
    ok("seed=" + s + " guest g2 with sponsor a", groupOf(r, "g2") === ga);
    ok("seed=" + s + " no group > 4", sizes(r).every((x) => x <= 4));
  }
}

// ---- 4. Sponsor + exactly 3 guests fills one foursome, no overflow ----
{
  const field = [M("a"), G("g1", "a"), G("g2", "a"), G("g3", "a"), M("b"), M("c")];
  const r = randomTeeGroups(field, 4, seededRng(3));
  const ga = groupOf(r, "a");
  ok("a+3 guests same group", ["g1", "g2", "g3"].every((g) => groupOf(r, g) === ga));
  eq("a's foursome has 4", sizes(r).includes(4), true);
  eq("no overflow at 3 guests", r.overflowGuestIds, []);
}

// ---- 5. Sponsor + 4 guests -> one guest overflows (left unassigned) ----
{
  const field = [M("a"), G("g1", "a"), G("g2", "a"), G("g3", "a"), G("g4", "a"), M("b")];
  const r = randomTeeGroups(field, 4, seededRng(3));
  eq("exactly one overflow guest", r.overflowGuestIds.length, 1);
  ok("overflow guest is one of a's", r.overflowGuestIds.every((id) => id.startsWith("g")));
  ok("overflow guest not assigned a group", r.assignments.every((x) => x.playerId !== r.overflowGuestIds[0]));
  const ga = groupOf(r, "a");
  ok("a still with its seated 3 guests", ["g1", "g2", "g3", "g4"].filter((g) => groupOf(r, g) === ga).length === 3);
}

// ---- 6. buildParties: orphan guest (sponsor not in field) becomes a solo party ----
{
  const bp = buildParties([M("a"), G("x", "zzz")], 4);
  ok("orphan guest is its own party", bp.parties.some((p) => p.playerIds.length === 1 && p.playerIds[0] === "x"));
  eq("orphan produces no overflow", bp.overflow, []);
}

// ---- 7. Determinism: same seed -> same assignment ----
{
  const field = [M("a"), M("b"), M("c"), M("d"), M("e"), G("g1", "b")];
  const r1 = randomTeeGroups(field, 4, seededRng(42));
  const r2 = randomTeeGroups(field, 4, seededRng(42));
  eq("same seed is deterministic", r1.assignments, r2.assignments);
}

// ---- 8. Two 3-parties + a 2-party can't force a >4 group (needs 3 groups) ----
{
  const field = [M("a"), G("a1", "a"), G("a2", "a"), M("b"), G("b1", "b"), G("b2", "b"), M("c"), G("c1", "c")];
  const r = randomTeeGroups(field, 4, seededRng(5));
  ok("no group > 4 with multiple guest parties", sizes(r).every((x) => x <= 4));
  ok("a party stays intact", groupOf(r, "a") === groupOf(r, "a1") && groupOf(r, "a1") === groupOf(r, "a2"));
  ok("b party stays intact", groupOf(r, "b") === groupOf(r, "b1") && groupOf(r, "b1") === groupOf(r, "b2"));
}

if (fail) { console.log(fails.join("\n")); console.log("grouping tests: PASS " + pass + "  FAIL " + fail); process.exit(1); }
else console.log("grouping tests: PASS " + pass + "  FAIL " + fail);
