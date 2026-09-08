/**
 * PARITY — the public Ryder Cup page must reach the same points as the app's Cup view.
 *
 * lib/live-competition.ts turns match states into Cup points. The states themselves come from
 * liveLegs, already held to the app by lib/live-parity.diff.test.ts; this holds the POINTS layer to
 * lib/competition.ts's rule: projected counts every started match to whoever leads (half each if
 * level), decided counts only settled matches, both scaled by points_per_match.
 *
 * Also pins the "not started" contract: a session with no linked game, and a session with a game but
 * no scores, must both come back as sessions — the page shows them, expandable, rather than hiding
 * them (product decision, Sep 2026).
 */
import { liveCupSessionScore, liveCupStandings, liveCupContext, type LiveCupSession } from "./live-competition";
import { chBasis } from "./game-shape";

let pass = 0, fail = 0; const fails: string[] = [];
const eq = <T,>(n: string, a: T, b: T) => {
  if (Object.is(a, b)) pass++; else { fail++; fails.push(`FAIL ${n}\n     expected ${String(b)}\n     actual   ${String(a)}`); }
};

const H = [
  { n: 1, si: 5, par: 4 }, { n: 2, si: 11, par: 3 }, { n: 3, si: 7, par: 4 }, { n: 4, si: 13, par: 4 },
  { n: 5, si: 17, par: 3 }, { n: 6, si: 1, par: 4 }, { n: 7, si: 15, par: 4 }, { n: 8, si: 9, par: 4 },
  { n: 9, si: 3, par: 4 }, { n: 10, si: 10, par: 4 }, { n: 11, si: 8, par: 4 }, { n: 12, si: 2, par: 4 },
  { n: 13, si: 6, par: 4 }, { n: 14, si: 18, par: 3 }, { n: 15, si: 16, par: 5 }, { n: 16, si: 4, par: 4 },
  { n: 17, si: 12, par: 3 }, { n: 18, si: 14, par: 5 },
];
const mk = (id: string, name: string, hi: number, ch: number, team: "A" | "B", scores: (number | null)[]) => ({
  id, display_name: name, ch: chBasis({ handicap_index: hi, slope: 137, rating: 72.9, course_handicap: ch }, 70, 18),
  team, no_show: false, scores,
});
// FB 6/21 production rows, split across two Cup teams.
const CHRIS = mk("chris", "Chris", 9, 14, "A", [4, 5, 5, 4, 4, 5, 5, 5, 4, 5, 5, 4, 6, 3, 6, 4, 4, 5]);
const AMIT = mk("amit", "Amit", 23, 28, "A", [6, 6, 5, 7, 4, 6, 5, 5, 6, 6, 6, 8, 6, 5, 7, 6, 5, 7]);
const CHRISTOPHER = mk("christopher", "Christopher", 13, 19, "B", [4, 4, 6, 6, 4, 6, 5, 7, 4, 6, 6, 6, 4, 3, 6, 7, 4, 6]);
const MICHAEL = mk("michael", "Michael", 11, 16, "B", [5, 4, 5, 6, 5, 6, 5, 5, 5, 5, 5, 5, 5, 4, 6, 6, 4, 5]);

const baseGame = { game_type: "fourball", course_par: 70, allowance_pct: 85, team_score_mode: "best_ball" as const, holes_meta: H };
const session = (over: Partial<LiveCupSession>): LiveCupSession => ({
  id: "s1", name: "Session 1", format: "fourball", session_order: 1, play_date: "2026-06-21",
  points_per_match: 1, planned_match_count: 1,
  game: baseGame as never,
  players: [CHRIS, AMIT, CHRISTOPHER, MICHAEL] as never,
  pairings: [],
  foursomes: [{ id: "g1", name: "Group 1", swap: false, a: ["chris", "amit"], b: ["christopher", "michael"] }],
  ...over,
});

// ── A settled four-ball awards its point to the winner, in BOTH projected and decided ────────────
const s1 = liveCupSessionScore(session({}));
eq("one match", s1.matchCount, 1);
eq("session has started", s1.notStarted, false);
eq("decided total is one point", s1.decidedA + s1.decidedB, s1.decidedCount);
eq("projected mirrors decided once settled", `${s1.projectedA}/${s1.projectedB}`, `${s1.decidedA}/${s1.decidedB}`);
eq("the winning side took the point", Math.max(s1.decidedA, s1.decidedB), 1);

// ── points_per_match SCALES the award ────────────────────────────────────────────────────────────
const s2 = liveCupSessionScore(session({ points_per_match: 2 }));
eq("2 points per match doubles the award", Math.max(s2.decidedA, s2.decidedB), 2);
eq("scaling does not change the match count", s2.matchCount, 1);

// ── Orientation: A's lead is A's lead whichever side of the foursome A sits on ───────────────────
const flipped = liveCupSessionScore(session({
  foursomes: [{ id: "g1", name: "Group 1", swap: false, a: ["christopher", "michael"], b: ["chris", "amit"] }],
}));
eq("flipping the foursome does not move the point between teams",
  `${flipped.decidedA}/${flipped.decidedB}`, `${s1.decidedA}/${s1.decidedB}`);

// ── In progress: projected counts the leader, decided counts nothing ─────────────────────────────
const partial = liveCupSessionScore(session({
  players: [CHRIS, AMIT, CHRISTOPHER, MICHAEL].map((p) => ({ ...p, scores: p.scores.map((v, i) => (i < 4 ? v : null)) })) as never,
}));
eq("in progress: nothing decided", partial.decidedCount, 0);
eq("in progress: decided points are zero", partial.decidedA + partial.decidedB, 0);
eq("in progress: projected awards a full point to the leader", partial.projectedA + partial.projectedB, 1);
eq("in progress: the match still counts", partial.matchCount, 1);

// ── NOT STARTED sessions are returned, not hidden ────────────────────────────────────────────────
const noGame = liveCupSessionScore(session({ id: "s2", game: null, foursomes: [] }));
eq("no linked game: still a session", noGame.sessionId, "s2");
eq("no linked game: notStarted", noGame.notStarted, true);
eq("no linked game: no matches, no points", `${noGame.matchCount}/${noGame.projectedA}/${noGame.projectedB}`, "0/0/0");

const noScores = liveCupSessionScore(session({
  id: "s3",
  players: [CHRIS, AMIT, CHRISTOPHER, MICHAEL].map((p) => ({ ...p, scores: [] })) as never,
}));
eq("linked game, no scores: notStarted", noScores.notStarted, true);
eq("linked game, no scores: the match is still listed", noScores.matchCount, 1);
eq("linked game, no scores: no points awarded", noScores.projectedA + noScores.projectedB, 0);

// ── The Cup total is the sum of its sessions ─────────────────────────────────────────────────────
const cup = liveCupStandings([session({}), session({ id: "s2", points_per_match: 2 }), session({ id: "s3", game: null, foursomes: [] })]);
eq("three sessions", cup.scores.length, 3);
eq("total decided is 1 + 2 + 0", cup.total.decidedA + cup.total.decidedB, 3);
eq("total match count ignores the unlinked session", cup.total.matchCount, 2);

// ── CONTEXT: rosters, denominators and clinch targets ────────────────────────────────────────────
// The public page must be able to explain itself: who is playing, how many points exist, what each
// team needs. The clinch maths comes from lib/competition.ts, so this pins that it is WIRED, and
// that the roster de-duplicates players who appear in several sessions.
{
  const three = [
    session({ id: "a", planned_match_count: 4, points_per_match: 1 }),
    session({ id: "b", planned_match_count: 4, points_per_match: 1 }),
    session({ id: "c", planned_match_count: 10, points_per_match: 1, game: null, foursomes: [] }),
  ];
  const ctx = liveCupContext(three, "shared");
  eq("18 points from the PLANNED denominator, before games exist", ctx.schedule.totalPoints, 18);
  eq("planned matches counted from the schedule", ctx.plannedMatches, 18);
  eq("outright target is more than half", ctx.schedule.teamATarget, 9.5);
  eq("both teams need the same under a shared tie rule", ctx.schedule.teamATarget, ctx.schedule.teamBTarget);
  eq("roster de-duplicates across sessions", ctx.roster.length, 4);
  eq("team A roster", ctx.teamA.map((r) => r.name).sort().join(","), "Amit,Chris");
  eq("team B roster", ctx.teamB.map((r) => r.name).sort().join(","), "Christopher,Michael");
  eq("points remaining starts from the planned total", ctx.pointsRemaining, 18 - (ctx.total.decidedA + ctx.total.decidedB));
  eq("needed = target minus decided", ctx.neededA, 9.5 - ctx.total.decidedA);

  // A retain rule lowers ONE team's bar to exactly half; the other still needs outright.
  const retain = liveCupContext(three, "team_a_retains");
  eq("holder retains on a tie", retain.schedule.teamATarget, 9);
  eq("challenger still needs outright", retain.schedule.teamBTarget, 9.5);
}

console.log(`live cup parity: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
