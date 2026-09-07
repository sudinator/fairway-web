/**
 * The public live-share page's SCORING, extracted from app/live/[token]/page.tsx so it can be held
 * against the app's own answers in CI (lib/live-parity.diff.test.ts).
 *
 * The share page keeps its own DISPLAY on purpose — it is an unauthenticated route with a different
 * palette, a flattened RPC payload and no access to auth, drafts or the offline snapshot. What it
 * must NOT keep is its own arithmetic. This module is the seam: the page renders, this computes,
 * and the parity test proves this agrees with the app for every format we have real data for.
 *
 * Behaviour here is a faithful extraction of what the page did at 183.1 — including the places it
 * disagrees with the app. Those disagreements are findings for the parity test to report, not
 * things to quietly fix during an extraction.
 */
import { strokeSets } from "./game-shape";
import {
  matchProgress,
  fourballProgress,
  computeTrifecta,
  matchCloseoutStatus,
  type FourballMember,
  type MatchHoleMeta,
} from "./golf";

export type LiveScoringMeta = { n: number; par: number; si: number | null };
export type LiveScoringPlayer = {
  id: string;
  ch: number;
  team: string | null;
  no_show: boolean;
  scores: (number | null)[];
};
export type LiveScoringGame = {
  game_type: string;
  allowance_pct: number | null;
  team_score_mode: "best_ball" | "aggregate" | null;
};

/** One matchup leg, in the same vocabulary computeTrifecta uses, so the two paths are comparable. */
export type LiveLeg = {
  kind: "single" | "fourball" | "team";
  aIds: string[];
  bIds: string[];
  thru: number;
  lead: number;
  settled: boolean;
  result: string;
};

/**
 * The handicap the share page scores a player off.
 * `ch` from get_live_scorecard is the eighteen-hole figure; a nine-hole card halves it (matching
 * chBasis). computePlayer on the page does this; the matchup helpers historically did not, which is
 * exactly the kind of gap the parity test exists to catch.
 */
export function liveCh(ch: number | null, holes: number): number | null {
  if (ch == null) return null;
  return holes === 9 ? ch / 2 : ch;
}

const asMeta = (meta: LiveScoringMeta[]): MatchHoleMeta[] =>
  meta.map((m) => ({ n: m.n, par: m.par, si: m.si }));

const memberOf = (p: LiveScoringPlayer | undefined, id: string, holes: number): FourballMember => ({
  id,
  gross: p?.scores || [],
  ch: liveCh(p?.ch ?? null, holes),
  noShow: !!p?.no_show,
});

/**
 * Every matchup leg the share page can draw, computed the way the app computes it.
 * Singles and four-balls go through matchCloseoutStatus so a decided match freezes at its margin
 * (a 4 & 2 stays 4 & 2 through 18); Trifecta legs come straight from computeTrifecta's contests.
 */
export function liveLegs(
  game: LiveScoringGame,
  byId: Record<string, LiveScoringPlayer>,
  pairings: { a: string | null; b: string | null }[],
  foursomes: { id: string; name: string; swap: boolean; a: (string | null)[]; b: (string | null)[] }[],
  meta: LiveScoringMeta[],
  allowance: number,
): LiveLeg[] {
  const holes = meta.length;
  const m = asMeta(meta);
  const mem = (ids: (string | null)[]): FourballMember[] =>
    ids.filter(Boolean).map((id) => memberOf(byId[id as string], id as string, holes));

  const fromProgress = (progress: (number | null)[], aIds: string[], bIds: string[], kind: LiveLeg["kind"]): LiveLeg => {
    const c = matchCloseoutStatus(progress, holes);
    return { kind, aIds, bIds, thru: c.thru, lead: c.lead, settled: c.decided, result: c.result };
  };

  if (game.game_type === "match") {
    return pairings
      .filter((pr) => pr.a && pr.b)
      .map((pr) => {
        const a = byId[pr.a as string], b = byId[pr.b as string];
        const progress = matchProgress(m, a?.scores || [], b?.scores || [], liveCh(a?.ch ?? null, holes), liveCh(b?.ch ?? null, holes), allowance);
        return fromProgress(progress, [pr.a as string], [pr.b as string], "single");
      });
  }

  if (game.game_type === "fourball") {
    const mode = game.team_score_mode === "aggregate" ? "aggregate" : "best_ball";
    return foursomes
      .filter((f) => f.a.filter(Boolean).length && f.b.filter(Boolean).length)
      .map((f) => {
        const aIds = f.a.filter(Boolean) as string[], bIds = f.b.filter(Boolean) as string[];
        const progress = fourballProgress(m, mem([...aIds, ...bIds]), aIds, bIds, allowance, mode);
        return fromProgress(progress, aIds, bIds, "fourball");
      });
  }

  if (game.game_type === "trifecta") {
    const mode = game.team_score_mode === "aggregate" ? "aggregate" : "best_ball";
    const out: LiveLeg[] = [];
    for (const f of foursomes) {
      const aIds = f.a.filter(Boolean) as string[], bIds = f.b.filter(Boolean) as string[];
      if (!aIds.length || !bIds.length) continue;
      const tri = computeTrifecta(m, mem([...aIds, ...bIds]), aIds, bIds, allowance, mode, !!f.swap);
      for (const c of tri.contests) {
        out.push({ kind: c.kind, aIds: c.aIds, bIds: c.bIds, thru: c.thru, lead: c.lead, settled: c.settled, result: c.result });
      }
    }
    return out;
  }

  return [];
}

/**
 * The stroke sets the share page should draw for one player, from the SAME source the app uses
 * (lib/game-shape.strokeSets). The share page's own per-player scorecard drew a single hardcoded
 * orange dot row off the full course handicap: right colour by luck under the 185.0 scheme, but it
 * never showed the basis the match is actually scored on — a four-ball card showed "team 3 up" in
 * the header and none of the team-leg strokes that produced it.
 *
 * `ch` from get_live_scorecard is the exact EIGHTEEN-hole figure, so it is passed as
 * course_handicap and chBasis halves it for a nine, matching liveCh.
 */
export function liveStrokeSets(
  game: LiveScoringGame & { course_par: number | null },
  byId: Record<string, LiveScoringPlayer & { display_name?: string | null }>,
  pairings: { a: string | null; b: string | null }[],
  foursomes: { id: string; name: string; swap: boolean; a: (string | null)[]; b: (string | null)[] }[],
  meta: LiveScoringMeta[],
  playerId: string,
  si: number | null,
) {
  const shapeGame = {
    game_type: game.game_type,
    course_par: game.course_par,
    allowance_pct: game.allowance_pct,
    team_score_mode: game.team_score_mode,
    holes_meta: meta,
    pairings: pairings.map((p) => ({ a: p.a, b: p.b })),
    foursomes: foursomes.map((f) => ({ id: f.id, name: f.name, swap: f.swap, a: f.a.filter(Boolean), b: f.b.filter(Boolean) })),
    teams: [{ key: "A" }, { key: "B" }],
  } as unknown as Parameters<typeof strokeSets>[0];
  const asShape = (p: LiveScoringPlayer & { display_name?: string | null }) => ({
    id: p.id, user_id: p.id, display_name: p.display_name ?? null,
    course_handicap: p.ch, team: p.team, no_show: p.no_show,
  }) as unknown as Parameters<typeof strokeSets>[1];
  const me = byId[playerId];
  if (!me) return [];
  return strokeSets(shapeGame, asShape(me), si, Object.values(byId).map(asShape));
}
