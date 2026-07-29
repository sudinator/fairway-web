import {
  Contest, ContestEntry, contestLeaderboard, overallLeaders, parThrees,
  fmtContestValue, ftInToInches, contestDefaults,
} from "./contests";

let pass = 0, fail = 0; const fails: string[] = [];
function ok(name: string, cond: boolean) { if (cond) pass++; else { fail++; fails.push(name); } }

let _seq = 0;
function E(p: Partial<ContestEntry> & { hole: number; value: number; player_name: string }): ContestEntry {
  _seq++;
  return {
    id: p.id ?? `e${_seq}`, contest_id: p.contest_id ?? "c1", hole: p.hole, value: p.value,
    player_id: p.player_id ?? p.player_name, guest_id: p.guest_id ?? null, player_name: p.player_name,
    recorded_by: p.recorded_by ?? "org", created_at: p.created_at ?? `2026-07-20T10:00:${String(_seq).padStart(2, "0")}Z`,
    voided: p.voided ?? false,
  };
}
const ctp: Contest = { id: "c1", game_id: "g1", kind: "ctp", label: "CTP", holes: [3, 7, 12], unit: "ft_in", better: "low" };
const ld: Contest = { id: "c1", game_id: "g1", kind: "long_drive", label: "LD", holes: [7], unit: "yards", better: "high" };

// ---- min wins (CTP) ----
{
  const es = [E({ hole: 3, value: 120, player_name: "A" }), E({ hole: 3, value: 75, player_name: "B" }), E({ hole: 3, value: 200, player_name: "C" })];
  const b = contestLeaderboard(ctp, es);
  const h3 = b.find((w) => w.hole === 3)!;
  ok("CTP min wins", h3.best?.player_name === "B" && h3.best?.value === 75);
  ok("CTP attempts sorted best-first", h3.attempts.map((a) => a.player_name).join("") === "BAC");
}

// ---- max wins (long drive) ----
{
  const es = [E({ hole: 7, value: 240, player_name: "A" }), E({ hole: 7, value: 305, player_name: "B" }), E({ hole: 7, value: 288, player_name: "C" })];
  const b = contestLeaderboard(ld, es);
  ok("long drive max wins", b[0].best?.player_name === "B" && b[0].best?.value === 305);
}

// ---- order independence (the offline-sync guarantee) ----
{
  const base = [E({ hole: 7, value: 240, player_name: "A" }), E({ hole: 7, value: 305, player_name: "B" }), E({ hole: 7, value: 288, player_name: "C" }), E({ hole: 7, value: 260, player_name: "D" })];
  const rev = [...base].reverse();
  const shuffled = [base[2], base[0], base[3], base[1]];
  const w1 = contestLeaderboard(ld, base)[0].best?.player_name;
  const w2 = contestLeaderboard(ld, rev)[0].best?.player_name;
  const w3 = contestLeaderboard(ld, shuffled)[0].best?.player_name;
  ok("winner is order-independent", w1 === "B" && w2 === "B" && w3 === "B");
  // a partial (offline) subset still reduces correctly
  const partial = contestLeaderboard(ld, [base[0], base[3]])[0].best?.player_name;
  ok("partial subset reduces correctly", partial === "D");
}

// ---- tie on value -> earliest recorded holds it ----
{
  const early = E({ hole: 3, value: 60, player_name: "First", created_at: "2026-07-20T09:00:00Z" });
  const late = E({ hole: 3, value: 60, player_name: "Second", created_at: "2026-07-20T11:00:00Z" });
  ok("tie -> earliest wins (in order)", contestLeaderboard(ctp, [early, late]).find((w) => w.hole === 3)!.best?.player_name === "First");
  ok("tie -> earliest wins (reversed)", contestLeaderboard(ctp, [late, early]).find((w) => w.hole === 3)!.best?.player_name === "First");
}

// ---- voided entries excluded ----
{
  const es = [E({ hole: 7, value: 350, player_name: "Cheater", voided: true }), E({ hole: 7, value: 300, player_name: "Real" })];
  ok("voided entry ignored", contestLeaderboard(ld, es)[0].best?.player_name === "Real");
}

// ---- per-hole winners for CTP across par-3s ----
{
  const es = [
    E({ hole: 3, value: 90, player_name: "A" }), E({ hole: 3, value: 50, player_name: "B" }),
    E({ hole: 12, value: 40, player_name: "C" }), E({ hole: 12, value: 41, player_name: "A" }),
  ];
  const b = contestLeaderboard(ctp, es);
  ok("hole 3 winner", b.find((w) => w.hole === 3)!.best?.player_name === "B");
  ok("hole 12 winner", b.find((w) => w.hole === 12)!.best?.player_name === "C");
  ok("hole 7 empty -> best null", b.find((w) => w.hole === 7)!.best === null);
  ok("board sorted by hole", b.map((w) => w.hole).join(",") === "3,7,12");
}

// ---- entries outside contest holes / wrong contest ignored ----
{
  const es = [E({ hole: 5, value: 10, player_name: "X" }), E({ hole: 7, value: 400, player_name: "Y", contest_id: "other" })];
  const b = contestLeaderboard(ld, es);
  ok("off-hole + foreign-contest entries ignored", b[0].best === null);
}

// ---- overall leaders (holes won) ----
{
  const es = [
    E({ hole: 3, value: 50, player_name: "B" }),
    E({ hole: 12, value: 40, player_name: "B" }),
    E({ hole: 7, value: 30, player_name: "C" }),
  ];
  const leaders = overallLeaders(contestLeaderboard(ctp, es));
  ok("overall: B leads with 2 holes", leaders[0].name === "B" && leaders[0].holesWon === 2);
  ok("overall: C has 1", leaders.find((l) => l.name === "C")!.holesWon === 1);
}

// ---- parThrees ----
{
  const meta = [{ hole_number: 1, par: 4 }, { hole_number: 2, par: 3 }, { hole_number: 3, par: 5 }, { hole_number: 4, par: 3 }];
  ok("parThrees from objects", parThrees(meta).join(",") === "2,4");
  ok("parThrees from bare par array", parThrees([4, 3, 3, 5]).join(",") === "2,3");
  ok("parThrees empty on junk", parThrees(null).length === 0);
}

// ---- formatting / parsing ----
{
  ok("ft_in format", fmtContestValue("ft_in", 75) === "6'3\"");
  ok("ft_in exact feet", fmtContestValue("ft_in", 24) === "2'0\"");
  ok("yards format", fmtContestValue("yards", 305) === "305 yd");
  ok("ft_center format", fmtContestValue("ft_center", 12) === "12 ft");
  ok("null -> dash", fmtContestValue("ft_in", null) === "—");
  ok("ftInToInches", ftInToInches(6, 3) === 75);
  ok("defaults ctp", contestDefaults("ctp").better === "low" && contestDefaults("ctp").unit === "ft_in");
  ok("defaults long_drive", contestDefaults("long_drive").better === "high");
}

console.log(`contests: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
