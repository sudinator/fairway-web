// Pure game-shape + stroke logic. No React. Single source of truth for "what mode
// is this game", plus the stroke-dot basis that MUST match golf.ts scoring.
// Unit-tested in game-shape.test.ts.
import { applyAllowance, matchAllowance, matchStrokesFor, strokesReceived, allocateStrokes } from "./golf";

/**
 * `alt_shot` is foursomes: 2v2 match play with ONE ball per side, partners alternating strokes.
 * Distinct from `fourball`, which is also 2v2 but with four balls and the better score counting.
 * The single ball is what drives everything else — a side has one score rather than two, and the
 * handicap allowance is 50% of the partners' combined Course Handicaps.
 */
export type GameType = "stableford" | "stroke" | "match" | "fourball" | "skins" | "trifecta" | "alt_shot";

/** Every game type, for exhaustiveness tests and for building pickers without hardcoding a list. */
export const GAME_TYPES: GameType[] = [
  "stableford", "stroke", "match", "fourball", "skins", "trifecta", "alt_shot",
];
export type TeamDef = { key: string; name: string };
export type FoursomeDef = { id: string; name: string; a: string[]; b: string[]; swap?: boolean };
export type PairDef = { a: string; b: string };
export type ShapeGame = { game_type: GameType; teams?: TeamDef[] | null; foursomes?: FoursomeDef[] | null };
export type ShapePlayer = { id: string; user_id: string | null; team?: string | null; no_show?: boolean | null; course_handicap: number | null; handicap_index?: number | null; slope?: number | null; rating?: number | null };
export type DotGame = ShapeGame & {
  allowance_pct?: number | null;
  course_par: number | null;
  pairings: PairDef[];
  /** Holes in play. Optional: absent means 18, which is what every pre-nine caller assumes. */
  holes_meta?: { n: number; par: number; si: number | null }[] | null;
};

export const pkey = (p: { user_id: string | null; id: string }) => p.user_id ?? p.id;

// ── Canonical game shape ─────────────────────────────────────────────────────
// shapeOf is the SINGLE place that decides "what mode is this game". Every other
// site reads these fields instead of re-inferring from teams/foursomes/pairings
// presence, so leftover or stashed structure can never change behavior. dotBasis
// is defined to EQUAL the scoring function's basis — keep these in lockstep:
//   absolute          → computeSkins / allocateStrokes  (stableford, stroke, individual skins)
//   relative_pair     → matchAllowance                  (singles & team match; 1:1 team skins / computeHeadToHeadSkins)
//   relative_foursome → fourballNets                    (four-ball, trifecta; 2v2 best-ball skins / computeTeamBestBallSkins)
export type GameShape = {
  type: GameType;
  skinsStyle: "individual" | "team_11" | "team_2v2" | null;
  usesTeams: boolean;
  usesMatchups: boolean;
  usesFoursomes: boolean;
  dotBasis: "absolute" | "relative_pair" | "relative_foursome";
  view: "stableford" | "stroke" | "match" | "fourball" | "trifecta" | "alt_shot" | "skins_individual" | "skins_team_11" | "skins_team_2v2";
};
export function shapeOf(game: ShapeGame): GameShape {
  const gt = game.game_type;
  const teams2 = Array.isArray(game.teams) && game.teams.length === 2;
  const hasFour = Array.isArray(game.foursomes);
  const skinsStyle: GameShape["skinsStyle"] =
    gt !== "skins" ? null : !teams2 ? "individual" : hasFour ? "team_2v2" : "team_11";
  const usesFoursomes =
    gt === "fourball" || gt === "trifecta" || gt === "alt_shot" || skinsStyle === "team_2v2";
  // The global Teams step applies only when two named teams actually exist: team match,
  // team skins, trifecta (always), and the team-mode four-ball variant. Plain four-ball
  // builds its sides inside each foursome (pair A vs pair B), so it has NO global teams.
  const usesTeams =
    teams2 && (gt === "match" || gt === "fourball" || gt === "trifecta" || gt === "skins" || gt === "alt_shot");
  const usesMatchups =
    gt === "match" || gt === "fourball" || gt === "trifecta" || gt === "alt_shot" || (gt === "skins" && skinsStyle !== "individual" && skinsStyle !== null);
  const dotBasis: GameShape["dotBasis"] =
    gt === "match"
      ? "relative_pair"
      : gt === "fourball" || gt === "trifecta" || gt === "alt_shot"
      ? "relative_foursome"
      : gt === "skins"
      ? (skinsStyle === "team_2v2" ? "relative_foursome" : skinsStyle === "team_11" ? "relative_pair" : "absolute")
      : "absolute";
  const view: GameShape["view"] = gt === "skins" ? (`skins_${skinsStyle}` as GameShape["view"]) : gt;
  return { type: gt, skinsStyle, usesTeams, usesMatchups, usesFoursomes, dotBasis, view };
}

export const chBasis = (
  p: { handicap_index?: number | null; slope?: number | null; rating?: number | null; course_handicap: number | null },
  coursePar: number | null | undefined,
  /**
   * Holes actually being played. Omit for 18 — every existing caller does, and omitting it keeps
   * today's behaviour exactly, which matters because this is the scoring engine.
   */
  holeCount?: number | null,
): number => {
  const base =
    p.handicap_index != null && p.slope != null && p.rating != null && coursePar != null
      ? p.handicap_index * (p.slope / 113) + (p.rating - coursePar)
      : p.course_handicap ?? 0;

  // A nine gets half the 18-hole Course Handicap. The WHOLE figure halves, not the par term: the
  // slope term dominates and par does not touch it, so slicing coursePar instead gives ~52 where
  // the answer is ~8. WHS proper would use that nine's own Rating and Slope; BNN has only the
  // 18-hole pair because GolfCourseAPI publishes no per-nine figures, so halving is the documented
  // practical substitute. NOT rounded here — rounding belongs at the end of the chain, where a
  // whole number is actually required.
  return holeCount != null && holeCount > 0 && holeCount <= 9 ? base / 2 : base;
};

// Orange stroke dots a player RECEIVES on a hole. This MUST match the basis the
// game's net scoring uses, so the dots can never disagree with the result:
//   • match           — relative to the opponent (lower of the pair plays scratch)
//   • fourball / trifecta — relative to the lowest playing handicap in the foursome
//     (fourballNets), i.e. the low player plays off scratch
//   • everything else (stableford, stroke, 1:1 skins) — full playing handicap
// "Playing handicap" = course handicap with the allowance % applied. Posting a
// round to a handicap record still uses the full playing handicap (handled

/**
 * Strokes a player receives on the hole with stroke index `si`, allocated by RANK across the holes
 * actually in play.
 *
 * Uses allocateStrokes rather than the `si <= ch % 18` form, because that form hardcodes 18 and a
 * nine-hole game holds only half the indexes — it would match si <= ch and hand out roughly half
 * the strokes owed. Ranking is also immune to duplicate, missing or out-of-range indexes.
 */
function recvByRank(game: DotGame, si: number | null, ch: number): number {
  if (si == null) return 0;
  const meta = game.holes_meta;
  // No hole list (older callers, hand-built DotGames in tests): fall back to the 18-hole form,
  // which is correct for a full round and is what those callers have always used.
  if (!Array.isArray(meta) || meta.length === 0) return strokesReceived(si, ch);
  const alloc = allocateStrokes(
    meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })),
    ch,
  );
  // Find the hole carrying this stroke index. Duplicate indexes would be a data fault; the first
  // match is taken, matching the ranking order allocateStrokes itself used.
  const hole = meta.find((m) => m.si === si);
  return hole ? alloc[hole.n] ?? 0 : 0;
}

// elsewhere) — that is intentionally different from the live match relativity.
export function dotStrokes(
  game: DotGame,
  p: ShapePlayer,
  si: number | null,
  allPlayers: ShapePlayer[],
): number {
  const allowance = game.allowance_pct ?? 100;
  const mine = applyAllowance(chBasis(p, game.course_par, game.holes_meta?.length), allowance);
  const key = pkey(p);
  const basis = shapeOf(game).dotBasis;

  // Relative to the paired opponent (lower of the pair plays scratch):
  // singles & team match, and 1:1 team skins (matches matchAllowance scoring).
  if (basis === "relative_pair") {
    const pr = (game.pairings || []).find((x) => x.a === key || x.b === key);
    if (pr) {
      const oppId = pr.a === key ? pr.b : pr.a;
      const opp = allPlayers.find((x) => pkey(x) === oppId);
      const { a } = matchAllowance(chBasis(p, game.course_par, game.holes_meta?.length), opp ? chBasis(opp, game.course_par, game.holes_meta?.length) : null, allowance);
      return matchStrokesFor(a, si);
    }
    return matchStrokesFor(mine, si);
  }

  // Relative to the foursome's lowest playing handicap (low plays scratch):
  // four-ball, trifecta, 2v2 best-ball skins (matches fourballNets scoring).
  if (basis === "relative_foursome") {
    const fs = (game.foursomes || []).find((f) => [...f.a, ...f.b].includes(key));
    let group = allPlayers;
    if (fs) {
      const ids = new Set([...fs.a, ...fs.b]);
      group = allPlayers.filter((x) => ids.has(pkey(x)));
    }
    const active = group.filter((x) => !x.no_show);
    const ref = active.length ? active : group;
    const low = Math.min(...ref.map((x) => applyAllowance(chBasis(x, game.course_par, game.holes_meta?.length), allowance)));
    return matchStrokesFor(Math.max(0, mine - low), si);
  }

  // Full playing handicap: stableford, stroke, individual skins.
  return recvByRank(game, si, mine);
}

// Full COURSE handicap for an INDIVIDUAL competition (e.g. the Group-results low-net /
// Stableford side game): each player's own strokes vs the course at 100% (no match
// allowance, no relative subtraction), regardless of the game's format. This is the
// "course hcp" / blue-dot basis; the match's own allowance %% lives only in dotStrokes.
export function fullStrokes(game: DotGame, p: ShapePlayer, si: number | null): number {
  return recvByRank(game, si, applyAllowance(chBasis(p, game.course_par, game.holes_meta?.length), 100));
}
