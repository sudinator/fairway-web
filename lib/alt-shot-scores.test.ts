/**
 * Score fan-out: one number entered for a side, written to both partners' rows.
 *
 * The cases that matter are the disagreements — a row edited outside the alternate-shot flow, or
 * an outbox still catching up. Preferring one partner silently would show a score nobody entered.
 */
import { altShotScoreWrites, sideScore, altShotStatsOwner, partnerRowIds, altShotFanOut } from "./alt-shot-scores";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const eq = <T,>(n: string, a: T, b: T) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ${JSON.stringify(b)}\n     actual   ${JSON.stringify(a)}`); }
};

// ── writing ────────────────────────────────────────────────────────────────
{
  const w = altShotScoreWrites(["amit", "bryan"], 3, 5);
  eq("writes to both partners", w.length, 2);
  eq("same hole for both", w.map((x) => x.holeIndex), [3, 3]);
  eq("SAME value for both", w.map((x) => x.strokes), [5, 5]);
  eq("both partners named", w.map((x) => x.playerId), ["amit", "bryan"]);
}
{
  // Clearing a hole must clear BOTH rows, or the side keeps a score it no longer has.
  const w = altShotScoreWrites(["amit", "bryan"], 0, null);
  eq("clearing writes null to both", w.map((x) => x.strokes), [null, null]);
  eq("clearing still touches both rows", w.length, 2);
}

// ── reading ────────────────────────────────────────────────────────────────
eq("both agree", sideScore([4, 5], [4, 5], 0), { strokes: 4, conflict: false });
eq("hole not yet played", sideScore([null], [null], 0), { strokes: null, conflict: false });

// A missing value on one row is NOT a conflict: the outbox may still be catching up, or a partner
// joined after scoring began. Take the value that exists.
eq("only the first row has it", sideScore([6], [null], 0), { strokes: 6, conflict: false });
eq("only the second row has it", sideScore([null], [6], 0), { strokes: 6, conflict: false });

// Two DIFFERENT numbers is a real disagreement — only reachable if a row was edited outside this
// flow. Reported rather than resolved.
eq("rows disagree", sideScore([4], [5], 0), { strokes: 4, conflict: true });

// Missing arrays entirely (a player row with no scores yet) must not throw.
eq("no arrays at all", sideScore(null, undefined, 2), { strokes: null, conflict: false });
eq("index beyond the array", sideScore([4], [4], 9), { strokes: null, conflict: false });

// Zero is a real score, not an absence. `?? null` rather than `|| null` is what makes this pass.
eq("zero is a value, not a blank", sideScore([0], [0], 0), { strokes: 0, conflict: false });

// ── stats are NOT fanned out ───────────────────────────────────────────────
// Whose putt was it? The question has no player-level answer in alternate shot, and duplicating a
// putt count would double the side's putts in any aggregate.
eq("stats belong to one row only", altShotStatsOwner(["amit", "bryan"]), "amit");
ok("stats owner is stable across calls", altShotStatsOwner(["amit", "bryan"]) === altShotStatsOwner(["amit", "bryan"]));


// ── finding the partner ────────────────────────────────────────────────────
// Foursome sides hold player KEYS (user_id ?? row id), not row ids. Writing scores needs row ids.
{
  const players = [
    { id: "row-amit", user_id: "u-amit" },
    { id: "row-bryan", user_id: "u-bryan" },
    { id: "row-guest", user_id: null },      // a guest: key IS the row id
    { id: "row-shubho", user_id: "u-shubho" },
  ];
  const foursomes = [{ id: "f1", a: ["u-amit", "u-bryan"], b: ["row-guest", "u-shubho"] }];

  // The mapping step is the point: passing keys straight through would return "u-amit", which is
  // not a row id, and the write would silently land nowhere.
  eq("side A resolves to ROW ids", partnerRowIds("row-amit", foursomes, players), ["row-amit", "row-bryan"]);
  eq("either partner finds the same pair", partnerRowIds("row-bryan", foursomes, players), ["row-amit", "row-bryan"]);
  // A guest is keyed by row id, which is exactly the case that would pass even with the bug.
  eq("side B with a guest", partnerRowIds("row-guest", foursomes, players), ["row-guest", "row-shubho"]);
  eq("the guest's partner finds it too", partnerRowIds("row-shubho", foursomes, players), ["row-guest", "row-shubho"]);

  eq("a player in no foursome", partnerRowIds("row-nobody", foursomes, players), null);
  eq("no foursomes at all", partnerRowIds("row-amit", null, players), null);
  eq("empty foursomes", partnerRowIds("row-amit", [], players), null);
}
{
  // A side must hold exactly two. One or three is not an alternate shot pair, and guessing which
  // two to write would put a score on someone who did not play the ball.
  const players = [{ id: "r1", user_id: "u1" }, { id: "r2", user_id: "u2" }, { id: "r3", user_id: "u3" }];
  eq("a side of one", partnerRowIds("r1", [{ id: "f", a: ["u1"], b: ["u2"] }], players), null);
  eq("a side of three", partnerRowIds("r1", [{ id: "f", a: ["u1", "u2", "u3"], b: [] }], players), null);
  // A player removed mid-round leaves a key resolving to nothing; writing to the survivor alone
  // would quietly turn the pair into a single.
  eq("a partner no longer in the game", partnerRowIds("r1", [{ id: "f", a: ["u1", "u-gone"], b: [] }], players), null);
}
{
  // Malformed data must not throw — foursomes come from the database.
  const players = [{ id: "r1", user_id: "u1" }];
  eq("null sides", partnerRowIds("r1", [{ id: "f", a: null, b: null }], players), null);
  eq("missing sides", partnerRowIds("r1", [{ id: "f" }], players), null);
}


// ── the fan-out decision, shared by BOTH write paths ──────────────────────
// There are two: the group card (scoring for anyone) and a player's own card. Both are reachable
// in the same game, so fanning out in only one would make a side's score depend on WHICH screen
// entered it — a bug that works in testing and diverges in play.
{
  const players = [
    { id: "r1", user_id: "u1" }, { id: "r2", user_id: "u2" },
    { id: "r3", user_id: "u3" }, { id: "r4", user_id: "u4" },
  ];
  const fs = [{ id: "f", a: ["u1", "u2"], b: ["u3", "u4"] }];

  {
    const out = altShotFanOut("alt_shot", "r1", { strokes: 5 }, fs, players);
    eq("writes to the partner", out.map((w) => w.playerId), ["r2"]);
    eq("with the same stroke", out[0].patch, { strokes: 5 });
    // Never back to the row already being written — that would double-write it.
    ok("does not include the edited row", !out.some((w) => w.playerId === "r1"));
  }
  {
    // Clearing must clear BOTH, or the side keeps a score it no longer has.
    const out = altShotFanOut("alt_shot", "r1", { strokes: null }, fs, players);
    eq("clearing fans out too", out.map((w) => w.patch.strokes), [null]);
  }

  // STATS ARE NOT FANNED OUT. Whose putt was it? Duplicating would double the side's putts.
  {
    const out = altShotFanOut("alt_shot", "r1", { strokes: 4, putts: 2, fairway: "hit" }, fs, players);
    eq("only the stroke reaches the partner", Object.keys(out[0].patch), ["strokes"]);
    ok("putts do not", !("putts" in out[0].patch));
    ok("fairway does not", !("fairway" in out[0].patch));
  }
  {
    // A stats-only patch fans out nothing at all.
    eq("stats-only patch is not fanned out",
       altShotFanOut("alt_shot", "r1", { putts: 2 }, fs, players).length, 0);
  }

  // Every other format is untouched — this must not change four-ball or singles.
  for (const gt of ["match", "fourball", "stableford", "stroke", "skins", "trifecta"]) {
    eq(`${gt} does not fan out`, altShotFanOut(gt, "r1", { strokes: 5 }, fs, players).length, 0);
  }

  // A player with no resolvable pair writes only their own row rather than guessing.
  eq("no foursome, no fan-out", altShotFanOut("alt_shot", "r1", { strokes: 5 }, null, players).length, 0);
  eq("player not in a foursome", altShotFanOut("alt_shot", "rX", { strokes: 5 }, fs, players).length, 0);
  eq("a side of one", altShotFanOut("alt_shot", "r1", { strokes: 5 }, [{ id: "f", a: ["u1"], b: [] }], players).length, 0);
}

console.log(`alt shot scores: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
