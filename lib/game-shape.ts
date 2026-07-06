// Pure game-shape + stroke logic. No React. Single source of truth for "what mode
// is this game", plus the stroke-dot basis that MUST match golf.ts scoring.
// Unit-tested in game-shape.test.ts.
import { applyAllowance, matchAllowance, matchStrokesFor, strokesReceived } from "./golf";

export type GameType = "stableford" | "stroke" | "match" | "fourball" | "skins" | "trifecta";
export type TeamDef = { key: string; name: string };
export type FoursomeDef = { id: string; name: string; a: string[]; b: string[]; swap?: boolean };
export type PairDef = { a: string; b: string };
export type ShapeGame = { game_type: GameType; teams?: TeamDef[] | null; foursomes?: FoursomeDef[] | null };
export type ShapePlayer = { id: string; user_id: string | null; team?: string | null; no_show?: boolean | null; course_handicap: number | null; handicap_index?: number | null; slope?: number | null; rating?: number | null };
export type DotGame = ShapeGame & { allowance_pct?: number | null; course_par: number | null; pairings: PairDef[] };

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
  view: "stableford" | "stroke" | "match" | "fourball" | "trifecta" | "skins_individual" | "skins_team_11" | "skins_team_2v2";
};
export function shapeOf(game: ShapeGame): GameShape {
  const gt = game.game_type;
  const teams2 = Array.isArray(game.teams) && game.teams.length === 2;
  const hasFour = Array.isArray(game.foursomes);
  const skinsStyle: GameShape["skinsStyle"] =
    gt !== "skins" ? null : !teams2 ? "individual" : hasFour ? "team_2v2" : "team_11";
  const usesFoursomes = gt === "fourball" || gt === "trifecta" || skinsStyle === "team_2v2";
  // The global Teams step applies only when two named teams actually exist: team match,
  // team skins, trifecta (always), and the team-mode four-ball variant. Plain four-ball
  // builds its sides inside each foursome (pair A vs pair B), so it has NO global teams.
  const usesTeams =
    teams2 && (gt === "match" || gt === "fourball" || gt === "trifecta" || gt === "skins");
  const usesMatchups =
    gt === "match" || gt === "fourball" || gt === "trifecta" || (gt === "skins" && skinsStyle !== "individual" && skinsStyle !== null);
  const dotBasis: GameShape["dotBasis"] =
    gt === "match"
      ? "relative_pair"
      : gt === "fourball" || gt === "trifecta"
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
): number => {
  if (p.handicap_index != null && p.slope != null && p.rating != null && coursePar != null) {
    return p.handicap_index * (p.slope / 113) + (p.rating - coursePar);
  }
  return p.course_handicap ?? 0;
};

// Orange stroke dots a player RECEIVES on a hole. This MUST match the basis the
// game's net scoring uses, so the dots can never disagree with the result:
//   • match           — relative to the opponent (lower of the pair plays scratch)
//   • fourball / trifecta — relative to the lowest playing handicap in the foursome
//     (fourballNets), i.e. the low player plays off scratch
//   • everything else (stableford, stroke, 1:1 skins) — full playing handicap
// "Playing handicap" = course handicap with the allowance % applied. Posting a
// round to a handicap record still uses the full playing handicap (handled
// elsewhere) — that is intentionally different from the live match relativity.
export function dotStrokes(
  game: DotGame,
  p: ShapePlayer,
  si: number | null,
  allPlayers: ShapePlayer[],
): number {
  const allowance = game.allowance_pct ?? 100;
  const mine = applyAllowance(chBasis(p, game.course_par), allowance);
  const key = pkey(p);
  const basis = shapeOf(game).dotBasis;

  // Relative to the paired opponent (lower of the pair plays scratch):
  // singles & team match, and 1:1 team skins (matches matchAllowance scoring).
  if (basis === "relative_pair") {
    const pr = (game.pairings || []).find((x) => x.a === key || x.b === key);
    if (pr) {
      const oppId = pr.a === key ? pr.b : pr.a;
      const opp = allPlayers.find((x) => pkey(x) === oppId);
      const { a } = matchAllowance(chBasis(p, game.course_par), opp ? chBasis(opp, game.course_par) : null, allowance);
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
    const low = Math.min(...ref.map((x) => applyAllowance(chBasis(x, game.course_par), allowance)));
    return matchStrokesFor(Math.max(0, mine - low), si);
  }

  // Full playing handicap: stableford, stroke, individual skins.
  return strokesReceived(si, mine);
}

// Full playing handicap for an INDIVIDUAL competition (e.g. the Group-results low-net /
// Stableford side game): each player's own strokes vs the course, with NO relative/match
// subtraction, regardless of the game's format. Mirrors the full-handicap branch of dotStrokes.
export function fullStrokes(game: DotGame, p: ShapePlayer, si: number | null): number {
  const allowance = game.allowance_pct ?? 100;
  return strokesReceived(si, applyAllowance(chBasis(p, game.course_par), allowance));
}
