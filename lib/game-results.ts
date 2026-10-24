// Game results — ONE implementation (207.2). The team standings each Results view used to compute
// inside its component, moved here VERBATIM so the Results screen, the completion recap and the
// completion notification all read the same numbers. Each rule is kept exactly as the view had it:
// singles call a match decided when the engine returns a result; four-ball / alternate shot when the
// lead exceeds the holes left or every hole is played.
import { matchStatus, fourballStatus, altShotStatus, computeTrifecta, computeSkins, computeHeadToHeadSkins, computeTeamBestBallSkins, type FourballMember, type SkinPlayer } from "@/lib/golf";
import { shapeOf, skinsTieOf } from "@/lib/game-shape";
import { pkey, chBasis, altShotSides } from "@/lib/game-shape";
import { readAltShotSideScores } from "@/lib/alt-shot-scores";
import { canonicalAltShotGross, type AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import { pointsOutlook } from "@/lib/points-outlook";
import type { Game, Player } from "@/lib/game-types";

/** Match points as golfers write them: 2, 2½, ½ (never "0½"). ONE formatter for screens and recap (207.2). */
export const fmtPoints = (n: number): string => Number.isInteger(n) ? String(n) : `${Math.floor(n) === 0 ? "" : Math.floor(n)}½`;

export type TeamStandings = { pts: Record<string, number>; decidedPts: Record<string, number>; out: number };
type Foursome = { id?: string; a: string[]; b: string[]; swap?: boolean };

export const playerLookup = (players: Player[]) => (uid: string) => players.find((p) => pkey(p) === uid) || null;

export function membersOf(game: Game, players: Player[], f: { a: string[]; b: string[] }): FourballMember[] {
  const playerOf = playerLookup(players);
  return [...f.a, ...f.b].map((uid) => {
    const p = playerOf(uid);
    return { id: uid, gross: p?.scores || [], ch: p ? chBasis(p, game.course_par, game.holes_meta?.length) : null, noShow: !!(p as any)?.no_show };
  });
}

export function altShotInputsFor(game: Game, players: Player[], altShotScores: AltShotScoreRow[], f: Foursome) {
  const isAltShot = game.game_type === "alt_shot";
  const holesCount = game.holes_meta?.length ?? 18;
  if (!isAltShot || f.a.length !== 2 || f.b.length !== 2) return null;
  const playerOf = playerLookup(players);
  const aRows = f.a.map(playerOf);
  const bRows = f.b.map(playerOf);
  if (aRows.some((x) => !x) || bRows.some((x) => !x)) return null;
  const sides = altShotSides(game as never, players as never, f as never);
  const arLegacy = readAltShotSideScores(aRows[0]!.scores, aRows[1]!.scores, holesCount);
  const brLegacy = readAltShotSideScores(bRows[0]!.scores, bRows[1]!.scores, holesCount);
  const aGross = canonicalAltShotGross(altShotScores, (f as any).id, "a", holesCount, arLegacy.gross);
  const bGross = canonicalAltShotGross(altShotScores, (f as any).id, "b", holesCount, brLegacy.gross);
  const conflictHoles = altShotScores.some((r) => r.foursome_id === (f as any).id) ? [] : Array.from(new Set([...arLegacy.conflictHoles, ...brLegacy.conflictHoles])).map((i) => game.holes_meta[i]?.n ?? i + 1);
  return { a: { ids: f.a, chs: [sides.aCh, 0], gross: aGross }, b: { ids: f.b, chs: [sides.bCh, 0], gross: bGross }, conflictHoles };
}

/** Singles match play with teams (was MatchView's teamStandings). */
export function singlesTeamStandings(game: Game, players: Player[]): TeamStandings {
  const playerOf = playerLookup(players);
  const pts: Record<string, number> = { A: 0, B: 0 };
  const decidedPts: Record<string, number> = { A: 0, B: 0 };
  let valid = 0, dec = 0;
  (game.pairings || []).forEach((pr) => {
    const pa = playerOf(pr.a), pb = playerOf(pr.b);
    if (!pa || !pb) return;
    const st = matchStatus(game.holes_meta, pa.scores || [], pb.scores || [], chBasis(pa, game.course_par, game.holes_meta?.length), chBasis(pb, game.course_par, game.holes_meta?.length), game.allowance_pct ?? 100);
    const ta = pa.team, tb = pb.team;
    if (!ta || !tb || ta === tb) return;
    valid++;
    const decided = !!st.result;
    if (decided) dec++;
    const award = (winnerTeam: string, half: boolean) => {
      if (half) { pts.A += 0.5; pts.B += 0.5; if (decided) { decidedPts.A += 0.5; decidedPts.B += 0.5; } }
      else { pts[winnerTeam] += 1; if (decided) decidedPts[winnerTeam] += 1; }
    };
    if (st.thru === 0) return;
    if (st.lead === 0) award("", true);
    else award(st.lead > 0 ? ta : tb, false);
  });
  return { pts, decidedPts, out: valid - dec };
}

/** Four-ball and alternate shot with teams (was FourballView's teamStandings). */
export function foursomeTeamStandings(game: Game, players: Player[], altShotScores: AltShotScoreRow[], foursomes: Foursome[] = game.foursomes || []): TeamStandings {
  const playerOf = playerLookup(players);
  const isAltShot = game.game_type === "alt_shot";
  const holesCount = game.holes_meta?.length ?? 18;
  const pts: Record<string, number> = { A: 0, B: 0 };
  const decidedPts: Record<string, number> = { A: 0, B: 0 };
  let valid = 0, dec = 0;
  foursomes.forEach((f) => {
    if (!f.a.length || !f.b.length) return;
    const ta = playerOf(f.a[0])?.team, tb = playerOf(f.b[0])?.team;
    if (!ta || !tb || ta === tb) return;
    const alt = altShotInputsFor(game, players, altShotScores, f);
    if (isAltShot && !alt) return;
    valid++;
    const st = isAltShot
      ? altShotStatus(game.holes_meta, alt!.a as never, alt!.b as never)
      : fourballStatus(game.holes_meta, membersOf(game, players, f), f.a, f.b, game.allowance_pct ?? 100, game.team_score_mode === "aggregate" ? "aggregate" : "best_ball");
    if (st.thru === 0) return;
    const decided = st.thru === holesCount || Math.abs(st.lead) > holesCount - st.thru;
    if (decided) dec++;
    if (st.lead === 0) { pts.A += 0.5; pts.B += 0.5; if (decided) { decidedPts.A += 0.5; decidedPts.B += 0.5; } }
    else { const w = st.lead > 0 ? ta : tb; pts[w] += 1; if (decided) decidedPts[w] += 1; }
  });
  return { pts, decidedPts, out: valid - dec };
}

/** Trifecta (was FourballView's trifectaStandings + trifectaOutlook). */
export function trifectaResults(game: Game, players: Player[], teamKeys: [string, string], foursomes: Foursome[] = game.foursomes || []) {
  const playerOf = playerLookup(players);
  const mode: "best_ball" | "aggregate" = game.team_score_mode === "aggregate" ? "aggregate" : "best_ball";
  const pts: Record<string, number> = { A: 0, B: 0 };
  const cs: { lead: number; thru: number; settled: boolean }[] = [];
  foursomes.forEach((f) => {
    if (!f.a.length || !f.b.length) return;
    const ta = playerOf(f.a[0])?.team, tb = playerOf(f.b[0])?.team;
    if (!ta || !tb || ta === tb) return;
    const r = computeTrifecta(game.holes_meta, membersOf(game, players, f), f.a, f.b, game.allowance_pct ?? 100, mode, !!f.swap);
    pts[ta] = (pts[ta] ?? 0) + r.aPts;
    pts[tb] = (pts[tb] ?? 0) + r.bPts;
    const flip = ta !== teamKeys[0];
    r.contests.forEach((c) => cs.push({ lead: flip ? -c.lead : c.lead, thru: c.thru, settled: c.settled }));
  });
  return { pts, outlook: pointsOutlook(cs) };
}

/** Skins totals, by the same engine call per style as SkinsView (207.2). byPlayer keyed by player key;
 *  byTeam for team styles (A/B). */
export function skinsTotals(game: Game, players: Player[]): { byPlayer: Record<string, number>; byTeam: Record<string, number> | null; carry: number } {
  const shape = shapeOf(game);
  const playerOf = playerLookup(players);
  const sp = (uid: string): SkinPlayer | null => { const p = playerOf(uid); return p ? { id: pkey(p), name: p.display_name, gross: p.scores || [], ch: chBasis(p, game.course_par, game.holes_meta?.length), noShow: !!p.no_show } : null; };
  if (shape.skinsStyle === "team_2v2") {
    let a = 0, b = 0, carry = 0;
    (game.foursomes || []).forEach((f) => {
      if (!f.a.length || !f.b.length) return;
      const r = computeTeamBestBallSkins(game.holes_meta, membersOf(game, players, f), f.a, f.b, game.allowance_pct ?? 100, game.team_score_mode === "aggregate" ? "aggregate" : "best_ball", skinsTieOf(game));
      a += r.skinsBySide.a || 0; b += r.skinsBySide.b || 0; carry += r.carryAtEnd;
    });
    return { byPlayer: {}, byTeam: { A: a, B: b }, carry };
  }
  if ((shape.skinsStyle === "team_11") && (game.pairings || []).length > 0) {
    const byPlayer: Record<string, number> = {}; let carry = 0;
    (game.pairings || []).forEach((pr) => {
      const pa = sp(pr.a), pb = sp(pr.b); if (!pa || !pb) return;
      const r = computeHeadToHeadSkins(game.holes_meta, pa, pb, game.allowance_pct ?? 100, skinsTieOf(game));
      Object.entries(r.skinsBySide).forEach(([id, n]) => { byPlayer[id] = (byPlayer[id] || 0) + n; });
      carry += r.carryAtEnd;
    });
    const byTeam: Record<string, number> = { A: 0, B: 0 };
    players.forEach((p) => { if (p.team === "A" || p.team === "B") byTeam[p.team] += byPlayer[pkey(p)] || 0; });
    return { byPlayer, byTeam, carry };
  }
  const r = computeSkins(game.holes_meta, players.map((p) => ({ id: p.id, name: p.display_name, gross: p.scores || [], ch: chBasis(p, game.course_par, game.holes_meta?.length) })), game.allowance_pct ?? 100, game.skins_mode === "split" ? "split" : "carryover");
  const byPlayer: Record<string, number> = {};
  players.forEach((p) => { byPlayer[pkey(p)] = r.skinsByPlayer[p.id] || 0; });
  return { byPlayer, byTeam: null, carry: r.carryAtEnd };
}
