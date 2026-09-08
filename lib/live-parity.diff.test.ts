/**
 * PARITY HARNESS — the public live-share page must reach the SAME ANSWERS as the app.
 *
 * The share page keeps its own display (unauthenticated route, different payload, different
 * palette). It must not keep its own arithmetic. This feeds one game through both paths and fails
 * on any disagreement:
 *
 *   APP  path: chBasis + the shared engines, exactly as components/game/scoring-views.tsx calls them.
 *   LIVE path: the get_live_scorecard payload shape through lib/live-scoring.liveLegs.
 *
 * Compared: per-leg thru, lead, settled and the close-out result. NOT compared: markup — the two
 * layouts differ on purpose.
 *
 * Fixtures are real games wherever we have them. A format with no case here is NOT covered, and
 * ci/check_live_parity_coverage.py fails the build if a format the live page renders has no case.
 */
import { computeTrifecta, matchProgress, fourballProgress, matchCloseoutStatus, type FourballMember, type MatchHoleMeta } from "./golf";
import { chBasis } from "./game-shape";
import { liveLegs, type LiveLeg, type LiveScoringPlayer } from "./live-scoring";

let compared = 0, mismatches = 0; const details: string[] = [];
const report = (ctx: string, field: string, app: unknown, live: unknown) => {
  mismatches++;
  if (details.length < 40) details.push(`${ctx} · ${field}: APP=${JSON.stringify(app)} LIVE=${JSON.stringify(live)}`);
};

// ── Fixture shape ────────────────────────────────────────────────────────────────────────────────
type FixPlayer = {
  id: string; name: string; handicap_index: number; slope: number; rating: number;
  course_handicap: number; team?: string | null; no_show?: boolean; scores: (number | null)[];
};
type Fixture = {
  label: string;
  game_type: "match" | "fourball" | "trifecta";
  course_par: number;
  allowance_pct: number;
  team_score_mode: "best_ball" | "aggregate";
  holes: { n: number; par: number; si: number }[];
  players: FixPlayer[];
  pairings?: { a: string | null; b: string | null }[];
  foursomes?: { id: string; name: string; swap: boolean; a: (string | null)[]; b: (string | null)[] }[];
};

const H18_ARCHITECTS = [
  { n: 1, si: 11, par: 5 }, { n: 2, si: 13, par: 3 }, { n: 3, si: 5, par: 5 }, { n: 4, si: 7, par: 4 },
  { n: 5, si: 9, par: 4 }, { n: 6, si: 17, par: 3 }, { n: 7, si: 3, par: 4 }, { n: 8, si: 15, par: 3 },
  { n: 9, si: 1, par: 4 }, { n: 10, si: 14, par: 4 }, { n: 11, si: 10, par: 5 }, { n: 12, si: 18, par: 3 },
  { n: 13, si: 6, par: 5 }, { n: 14, si: 4, par: 4 }, { n: 15, si: 2, par: 4 }, { n: 16, si: 8, par: 4 },
  { n: 17, si: 16, par: 3 }, { n: 18, si: 12, par: 4 },
];
const H18_FRANCIS = [
  { n: 1, si: 5, par: 4 }, { n: 2, si: 11, par: 3 }, { n: 3, si: 7, par: 4 }, { n: 4, si: 13, par: 4 },
  { n: 5, si: 17, par: 3 }, { n: 6, si: 1, par: 4 }, { n: 7, si: 15, par: 4 }, { n: 8, si: 9, par: 4 },
  { n: 9, si: 3, par: 4 }, { n: 10, si: 10, par: 4 }, { n: 11, si: 8, par: 4 }, { n: 12, si: 2, par: 4 },
  { n: 13, si: 6, par: 4 }, { n: 14, si: 18, par: 3 }, { n: 15, si: 16, par: 5 }, { n: 16, si: 4, par: 4 },
  { n: 17, si: 12, par: 3 }, { n: 18, si: 14, par: 5 },
];
const FRONT9 = H18_FRANCIS.slice(0, 9);

// Real production rows.
const P_ARCH: Record<string, FixPlayer> = {
  karan: { id: "karan", name: "Karan", handicap_index: 9, slope: 129, rating: 71.5, course_handicap: 11, team: "A", scores: [4, 4, 7, 6, 4, 3, 4, 4, 5, 6, 5, 4, 6, 5, 5, 4, 4, 5] },
  sachin: { id: "sachin", name: "Sachin", handicap_index: 13, slope: 127, rating: 69.6, course_handicap: 13, team: "A", scores: [7, 3, 7, 7, 4, 4, 6, 4, 5, 5, 6, 3, 5, 3, 4, 5, 3, 4] },
  ashutosh: { id: "ashutosh", name: "Ashutosh", handicap_index: 10, slope: 129, rating: 71.5, course_handicap: 12, team: "B", scores: [5, 4, 5, 5, 4, 3, 4, 3, 5, 4, 5, 4, 7, 5, 5, 6, 3, 4] },
  bk: { id: "bk", name: "BK", handicap_index: 16, slope: 127, rating: 69.6, course_handicap: 17, team: "B", scores: [5, 4, 6, 6, 4, 5, 7, 5, 4, 5, 6, 5, 7, 4, 6, 6, 3, 6] },
};
const P_FB: Record<string, FixPlayer> = {
  chris: { id: "chris", name: "Chris", handicap_index: 9, slope: 137, rating: 72.9, course_handicap: 14, team: "A", scores: [4, 5, 5, 4, 4, 5, 5, 5, 4, 5, 5, 4, 6, 3, 6, 4, 4, 5] },
  amit: { id: "amit", name: "Amit", handicap_index: 23, slope: 135, rating: 70.9, course_handicap: 28, team: "A", scores: [6, 6, 5, 7, 4, 6, 5, 5, 6, 6, 6, 8, 6, 5, 7, 6, 5, 7] },
  christopher: { id: "christopher", name: "Christopher", handicap_index: 13, slope: 137, rating: 72.9, course_handicap: 19, team: "B", scores: [4, 4, 6, 6, 4, 6, 5, 7, 4, 6, 6, 6, 4, 3, 6, 7, 4, 6] },
  michael: { id: "michael", name: "Michael", handicap_index: 11, slope: 137, rating: 72.9, course_handicap: 16, team: "B", scores: [5, 4, 5, 6, 5, 6, 5, 5, 5, 5, 5, 5, 5, 4, 6, 6, 4, 5] },
};
const nine = (p: FixPlayer): FixPlayer => ({ ...p, scores: p.scores.slice(0, 9) });
const partial = (p: FixPlayer, upto: number): FixPlayer => ({ ...p, scores: p.scores.map((s, i) => (i < upto ? s : null)) });

const FIXTURES: Fixture[] = [
  {
    label: "Trifecta · Architects Jul 5 · 90% · aggregate · 18",
    game_type: "trifecta", course_par: 71, allowance_pct: 90, team_score_mode: "aggregate", holes: H18_ARCHITECTS,
    players: [P_ARCH.karan, P_ARCH.sachin, P_ARCH.ashutosh, P_ARCH.bk],
    foursomes: [{ id: "f1", name: "F1", swap: false, a: ["karan", "sachin"], b: ["ashutosh", "bk"] }],
  },
  {
    label: "Trifecta · FB 6/21 via 641032 · 85% · best_ball · 18 · swap",
    game_type: "trifecta", course_par: 70, allowance_pct: 85, team_score_mode: "best_ball", holes: H18_FRANCIS,
    players: [P_FB.chris, P_FB.amit, P_FB.christopher, P_FB.michael],
    foursomes: [{ id: "g1", name: "Group 1", swap: true, a: ["chris", "amit"], b: ["christopher", "michael"] }],
  },
  {
    label: "Trifecta · mid-round (9 of 18 scored)",
    game_type: "trifecta", course_par: 70, allowance_pct: 85, team_score_mode: "best_ball", holes: H18_FRANCIS,
    players: [P_FB.chris, P_FB.amit, P_FB.christopher, P_FB.michael].map((p) => partial(p, 9)),
    foursomes: [{ id: "g1", name: "Group 1", swap: true, a: ["chris", "amit"], b: ["christopher", "michael"] }],
  },
  {
    label: "Singles match · 18 · closes out on the 16th",
    game_type: "match", course_par: 70, allowance_pct: 100, team_score_mode: "best_ball", holes: H18_FRANCIS,
    players: [P_FB.chris, P_FB.michael],
    pairings: [{ a: "chris", b: "michael" }],
  },
  {
    label: "Singles match · NINE holes (front 9)",
    game_type: "match", course_par: 70, allowance_pct: 100, team_score_mode: "best_ball", holes: FRONT9,
    players: [nine(P_FB.chris), nine(P_FB.michael)],
    pairings: [{ a: "chris", b: "michael" }],
  },
  {
    label: "Four-ball · best ball · 18",
    game_type: "fourball", course_par: 70, allowance_pct: 85, team_score_mode: "best_ball", holes: H18_FRANCIS,
    players: [P_FB.chris, P_FB.amit, P_FB.christopher, P_FB.michael],
    foursomes: [{ id: "g1", name: "Group 1", swap: false, a: ["chris", "amit"], b: ["christopher", "michael"] }],
  },
  {
    label: "Four-ball · AGGREGATE (shootout) · 18",
    game_type: "fourball", course_par: 70, allowance_pct: 85, team_score_mode: "aggregate", holes: H18_FRANCIS,
    players: [P_FB.chris, P_FB.amit, P_FB.christopher, P_FB.michael],
    foursomes: [{ id: "g1", name: "Group 1", swap: false, a: ["chris", "amit"], b: ["christopher", "michael"] }],
  },
  {
    label: "Four-ball · NINE holes (front 9)",
    game_type: "fourball", course_par: 70, allowance_pct: 85, team_score_mode: "best_ball", holes: FRONT9,
    players: [P_FB.chris, P_FB.amit, P_FB.christopher, P_FB.michael].map(nine),
    foursomes: [{ id: "g1", name: "Group 1", swap: false, a: ["chris", "amit"], b: ["christopher", "michael"] }],
  },
];

// ── APP path: chBasis + the shared engines, as scoring-views calls them ──────────────────────────
function appLegs(f: Fixture): LiveLeg[] {
  const m: MatchHoleMeta[] = f.holes.map((h) => ({ n: h.n, par: h.par, si: h.si }));
  const chOf = (p: FixPlayer) => chBasis(p, f.course_par, f.holes.length);
  const byId = Object.fromEntries(f.players.map((p) => [p.id, p]));
  const mem = (ids: string[]): FourballMember[] =>
    ids.map((id) => ({ id, gross: byId[id].scores, ch: chOf(byId[id]), noShow: !!byId[id].no_show }));
  const closeout = (progress: (number | null)[], aIds: string[], bIds: string[], kind: LiveLeg["kind"]): LiveLeg => {
    const c = matchCloseoutStatus(progress, f.holes.length);
    return { kind, aIds, bIds, thru: c.thru, lead: c.lead, settled: c.decided, result: c.result };
  };
  if (f.game_type === "match") {
    return (f.pairings || []).filter((pr) => pr.a && pr.b).map((pr) => {
      const a = byId[pr.a as string], b = byId[pr.b as string];
      return closeout(matchProgress(m, a.scores, b.scores, chOf(a), chOf(b), f.allowance_pct), [a.id], [b.id], "single");
    });
  }
  if (f.game_type === "fourball") {
    return (f.foursomes || []).map((fs) => {
      const aIds = fs.a.filter(Boolean) as string[], bIds = fs.b.filter(Boolean) as string[];
      return closeout(fourballProgress(m, mem([...aIds, ...bIds]), aIds, bIds, f.allowance_pct, f.team_score_mode), aIds, bIds, "fourball");
    });
  }
  const out: LiveLeg[] = [];
  for (const fs of f.foursomes || []) {
    const aIds = fs.a.filter(Boolean) as string[], bIds = fs.b.filter(Boolean) as string[];
    const tri = computeTrifecta(m, mem([...aIds, ...bIds]), aIds, bIds, f.allowance_pct, f.team_score_mode, !!fs.swap);
    for (const c of tri.contests) out.push({ kind: c.kind, aIds: c.aIds, bIds: c.bIds, thru: c.thru, lead: c.lead, settled: c.settled, result: c.result });
  }
  return out;
}

// ── LIVE path: the get_live_scorecard payload through lib/live-scoring ───────────────────────────
function liveFrom(f: Fixture): LiveLeg[] {
  // get_live_scorecard returns `ch` as the EIGHTEEN-hole exact figure and a flat player list.
  const byId: Record<string, LiveScoringPlayer> = Object.fromEntries(
    f.players.map((p) => [p.id, {
      id: p.id,
      ch: chBasis({ handicap_index: p.handicap_index, slope: p.slope, rating: p.rating, course_handicap: p.course_handicap }, f.course_par, 18),
      team: p.team ?? null,
      no_show: !!p.no_show,
      scores: p.scores,
    }]),
  );
  return liveLegs(
    { game_type: f.game_type, allowance_pct: f.allowance_pct, team_score_mode: f.team_score_mode },
    byId,
    f.pairings || [],
    f.foursomes || [],
    f.holes.map((h) => ({ n: h.n, par: h.par, si: h.si })),
    f.allowance_pct,
  );
}

// ── Compare ──────────────────────────────────────────────────────────────────────────────────────
for (const f of FIXTURES) {
  const app = appLegs(f), live = liveFrom(f);
  if (app.length !== live.length) { report(f.label, "leg count", app.length, live.length); continue; }
  for (let i = 0; i < app.length; i++) {
    const a = app[i], l = live[i];
    const ctx = `${f.label} · ${a.kind} ${a.aIds.join("+")} v ${a.bIds.join("+")}`;
    for (const key of ["thru", "lead", "settled", "result"] as const) {
      compared++;
      if (JSON.stringify(a[key]) !== JSON.stringify(l[key])) report(ctx, key, a[key], l[key]);
    }
  }
}

// ── Fence: prove this harness CATCHES the behaviour the live page had before 184.0 ───────────────
// The old page used the raw eighteen-hole ch (no halving for a nine) and count-based status (no
// close-out freeze). If the harness cannot see those two, it is not doing its job.
function oldLiveLegs(f: Fixture): LiveLeg[] {
  const m: MatchHoleMeta[] = f.holes.map((h) => ({ n: h.n, par: h.par, si: h.si }));
  const rawCh = (p: FixPlayer) => chBasis(p, f.course_par, 18); // NOT halved for a nine
  const byId = Object.fromEntries(f.players.map((p) => [p.id, p]));
  const count = (progress: (number | null)[], aIds: string[], bIds: string[], kind: LiveLeg["kind"]): LiveLeg => {
    const played = progress.filter((x): x is number => x != null);
    const lead = played.length ? played[played.length - 1] : 0;
    return { kind, aIds, bIds, thru: played.length, lead, settled: played.length === f.holes.length, result: lead === 0 ? "AS" : `${Math.abs(lead)} UP` };
  };
  if (f.game_type === "match") {
    return (f.pairings || []).filter((pr) => pr.a && pr.b).map((pr) => {
      const a = byId[pr.a as string], b = byId[pr.b as string];
      return count(matchProgress(m, a.scores, b.scores, rawCh(a), rawCh(b), f.allowance_pct), [a.id], [b.id], "single");
    });
  }
  if (f.game_type === "fourball") {
    return (f.foursomes || []).map((fs) => {
      const aIds = fs.a.filter(Boolean) as string[], bIds = fs.b.filter(Boolean) as string[];
      const mem = [...aIds, ...bIds].map((id) => ({ id, gross: byId[id].scores, ch: rawCh(byId[id]), noShow: false }));
      return count(fourballProgress(m, mem, aIds, bIds, f.allowance_pct, f.team_score_mode), aIds, bIds, "fourball");
    });
  }
  return [];
}
let fenceCaught = 0;
for (const f of FIXTURES) {
  if (f.game_type === "trifecta") continue;
  const app = appLegs(f), old = oldLiveLegs(f);
  const differs = app.some((a, i) => (["thru", "lead", "settled", "result"] as const).some((k) => JSON.stringify(a[k]) !== JSON.stringify(old[i]?.[k])));
  if (differs) fenceCaught++;
}
if (fenceCaught === 0) {
  console.error("FENCE FAILED: the harness did not detect the pre-184.0 live behaviour on any fixture — it is not comparing what it claims to.");
  process.exit(1);
}
console.log(`  fence: pre-184.0 live behaviour detected on ${fenceCaught} of ${FIXTURES.filter((f) => f.game_type !== "trifecta").length} non-Trifecta fixture(s)`);

console.log(`live/app parity: ${compared} field comparisons across ${FIXTURES.length} fixture(s), ${mismatches} mismatch(es)`);
if (mismatches) {
  console.error("\nThe public share page disagrees with the app:");
  for (const d of details) console.error("  " + d);
  process.exit(1);
}
