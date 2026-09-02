import type { Game, Player } from "./game-types";
import { altShotStatus, fourballStatus, matchStatus, type FourballMember } from "./golf";
import { pkey, chBasis, altShotSides } from "./game-shape";
import { readAltShotSideScores } from "./alt-shot-scores";
import { canonicalAltShotGross, type AltShotScoreRow } from "./alt-shot-side-scores";

export type Competition = {
  id: string;
  group_id: string;
  name: string;
  location?: string | null;
  start_date: string;
  status: "draft" | "active" | "complete";
  team_a_name: string;
  team_b_name: string;
  created_by: string;
  created_at: string;
  completed_at?: string | null;
};

export type CompetitionPlayer = {
  competition_id: string;
  user_id: string;
  team_key: "A" | "B";
  display_name: string;
  avatar_url?: string | null;
  handicap_index?: number | null;
};

export type CompetitionSession = {
  id: string;
  competition_id: string;
  name: string;
  format: "fourball" | "alt_shot" | "match";
  session_order: number;
  play_date: string;
  points_per_match: number;
  game_id?: string | null;
  created_at: string;
};

export type CompetitionMatchState = {
  key: string;
  leftNames: string;
  rightNames: string;
  thru: number;
  lead: number;
  result: string;
  started: boolean;
  decided: boolean;
  winnerTeam: "A" | "B" | null;
};

export type CompetitionSessionScore = {
  projectedA: number;
  projectedB: number;
  decidedA: number;
  decidedB: number;
  matchCount: number;
  decidedCount: number;
  matches: CompetitionMatchState[];
};

const emptyScore = (): CompetitionSessionScore => ({ projectedA: 0, projectedB: 0, decidedA: 0, decidedB: 0, matchCount: 0, decidedCount: 0, matches: [] });

export function fmtCompetitionPoints(n: number): string {
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  const whole = Math.floor(n);
  return whole ? `${whole}½` : "½";
}

export function competitionFormatLabel(format: CompetitionSession["format"]): string {
  return format === "fourball" ? "Four-Ball" : format === "alt_shot" ? "Alternate Shot" : "Singles";
}

function award(out: CompetitionSessionScore, lead: number, decided: boolean, aTeam: "A" | "B", bTeam: "A" | "B", scale = 1) {
  if (lead === 0) {
    out.projectedA += 0.5 * scale;
    out.projectedB += 0.5 * scale;
    if (decided) { out.decidedA += 0.5 * scale; out.decidedB += 0.5 * scale; }
  } else {
    const winner = lead > 0 ? aTeam : bTeam;
    if (winner === "A") out.projectedA += scale;
    else out.projectedB += scale;
    if (decided) {
      if (winner === "A") out.decidedA += scale;
      else out.decidedB += scale;
    }
  }
}

export function scoreCompetitionGame(game: Game, players: Player[], altShotScores: AltShotScoreRow[] = [], pointsPerMatch = 1): CompetitionSessionScore {
  const out = emptyScore();
  const playerOf = (key: string) => players.find((p) => pkey(p) === key) || null;
  const teamOf = (key: string): "A" | "B" | null => {
    const t = playerOf(key)?.team;
    return t === "A" || t === "B" ? t : null;
  };
  const nameOf = (key: string) => playerOf(key)?.display_name || "—";
  const holesCount = game.holes_meta?.length || 18;

  if (game.game_type === "match") {
    for (let i = 0; i < (game.pairings || []).length; i++) {
      const pr = game.pairings[i];
      const pa = playerOf(pr.a), pb = playerOf(pr.b);
      const ta = teamOf(pr.a), tb = teamOf(pr.b);
      if (!pa || !pb || !ta || !tb || ta === tb) continue;
      const st = matchStatus(game.holes_meta, pa.scores || [], pb.scores || [], chBasis(pa, game.course_par, holesCount), chBasis(pb, game.course_par, holesCount), game.allowance_pct ?? 100);
      const started = st.thru > 0;
      const decided = !!st.result;
      const reversed = ta === "B" && tb === "A";
      const displayLead = reversed ? -st.lead : st.lead;
      const leftKey = reversed ? pr.b : pr.a;
      const rightKey = reversed ? pr.a : pr.b;
      out.matchCount++;
      if (decided) out.decidedCount++;
      if (started) award(out, st.lead, decided, ta, tb, pointsPerMatch);
      out.matches.push({ key: `pair-${i}`, leftNames: nameOf(leftKey), rightNames: nameOf(rightKey), thru: st.thru, lead: displayLead, result: st.result, started, decided, winnerTeam: displayLead === 0 ? null : (displayLead > 0 ? "A" : "B") });
    }
    return out;
  }

  if (game.game_type !== "fourball" && game.game_type !== "alt_shot") return out;
  for (const f of game.foursomes || []) {
    if (!f.a.length || !f.b.length) continue;
    const ta = teamOf(f.a[0]), tb = teamOf(f.b[0]);
    if (!ta || !tb || ta === tb) continue;
    let st: { thru: number; lead: number; result?: string } | null = null;
    if (game.game_type === "alt_shot") {
      if (f.a.length !== 2 || f.b.length !== 2) continue;
      const aRows = f.a.map(playerOf), bRows = f.b.map(playerOf);
      if (aRows.some((p) => !p) || bRows.some((p) => !p)) continue;
      const sides = altShotSides(game as never, players as never, f as never);
      const aLegacy = readAltShotSideScores(aRows[0]!.scores, aRows[1]!.scores, holesCount);
      const bLegacy = readAltShotSideScores(bRows[0]!.scores, bRows[1]!.scores, holesCount);
      const aGross = canonicalAltShotGross(altShotScores, f.id, "a", holesCount, aLegacy.gross);
      const bGross = canonicalAltShotGross(altShotScores, f.id, "b", holesCount, bLegacy.gross);
      st = altShotStatus(game.holes_meta, { ids: f.a, chs: [sides.aCh, 0], gross: aGross } as never, { ids: f.b, chs: [sides.bCh, 0], gross: bGross } as never);
    } else {
      const members: FourballMember[] = [...f.a, ...f.b].map((id) => {
        const p = playerOf(id);
        return { id, gross: p?.scores || [], ch: p ? chBasis(p, game.course_par, holesCount) : null, noShow: !!p?.no_show };
      });
      st = fourballStatus(game.holes_meta, members, f.a, f.b, game.allowance_pct ?? 100, game.team_score_mode === "aggregate" ? "aggregate" : "best_ball");
    }
    const started = st.thru > 0;
    const decided = !!st.result || (started && (st.thru === holesCount || Math.abs(st.lead) > holesCount - st.thru));
    const reversed = ta === "B" && tb === "A";
    const displayLead = reversed ? -st.lead : st.lead;
    const leftIds = reversed ? f.b : f.a;
    const rightIds = reversed ? f.a : f.b;
    out.matchCount++;
    if (decided) out.decidedCount++;
    if (started) award(out, st.lead, decided, ta, tb, pointsPerMatch);
    out.matches.push({ key: f.id, leftNames: leftIds.map(nameOf).join(" / "), rightNames: rightIds.map(nameOf).join(" / "), thru: st.thru, lead: displayLead, result: st.result || "", started, decided, winnerTeam: displayLead === 0 ? null : (displayLead > 0 ? "A" : "B") });
  }
  return out;
}

export function combineCompetitionScores(scores: CompetitionSessionScore[]) {
  return scores.reduce((acc, s) => ({
    projectedA: acc.projectedA + s.projectedA,
    projectedB: acc.projectedB + s.projectedB,
    decidedA: acc.decidedA + s.decidedA,
    decidedB: acc.decidedB + s.decidedB,
    matchCount: acc.matchCount + s.matchCount,
    decidedCount: acc.decidedCount + s.decidedCount,
  }), { projectedA: 0, projectedB: 0, decidedA: 0, decidedB: 0, matchCount: 0, decidedCount: 0 });
}
