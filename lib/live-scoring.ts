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
