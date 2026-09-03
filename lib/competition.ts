import type { Game, Player } from "./game-types";
import { altShotProgress, computeTrifecta, fourballProgress, matchProgress, type FourballMember } from "./golf";
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
  schedule_status: "draft" | "locked";
  schedule_locked_at?: string | null;
  schedule_locked_by?: string | null;
  schedule_revision: number;
  tie_rule: "shared" | "team_a_retains" | "team_b_retains";
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
  format: "fourball" | "alt_shot" | "match" | "trifecta";
  session_order: number;
  play_date: string;
  points_per_match: number;
  planned_match_count: number;
  game_id?: string | null;
  created_at: string;
};

export type CompetitionSchedule = {
  totalPoints: number;
  scoringUnit: number;
  teamATarget: number;
  teamBTarget: number;
};

export type CompetitionTeamOutcome = {
  clinched: boolean;
  canWin: boolean;
  canShare: boolean;
  pointsNeeded: number;
  maxPoints: number;
};

export type CompetitionOutcome = {
  remainingPoints: number;
  teamA: CompetitionTeamOutcome;
  teamB: CompetitionTeamOutcome;
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
  const fraction = n - whole;
  const glyph = Math.abs(fraction - 0.25) < 1e-9 ? "¼" : Math.abs(fraction - 0.5) < 1e-9 ? "½" : Math.abs(fraction - 0.75) < 1e-9 ? "¾" : null;
  if (glyph) return whole ? `${whole}${glyph}` : glyph;
  return Number(n.toFixed(2)).toString();
}

export function competitionFormatLabel(format: CompetitionSession["format"]): string {
  return format === "fourball" ? "Four-Ball" : format === "alt_shot" ? "Alternate Shot" : format === "trifecta" ? "Trifecta" : "Singles";
}

export function competitionSchedule(sessions: CompetitionSession[], tieRule: Competition["tie_rule"] = "shared"): CompetitionSchedule {
  const scheduled = sessions.filter((s) => Number(s.planned_match_count) > 0 && Number(s.points_per_match) > 0);
  const totalPoints = scheduled.reduce((sum, s) => sum + Number(s.planned_match_count) * Number(s.points_per_match), 0);
  const units = scheduled.map((s) => Number(s.points_per_match) / 2).filter((n) => n > 0);
  const scoringUnit = units.length ? Math.min(...units) : 0.5;
  const half = totalPoints / 2;
  const outright = Math.floor((half + 1e-9) / scoringUnit) * scoringUnit + scoringUnit;
  return {
    totalPoints,
    scoringUnit,
    teamATarget: tieRule === "team_a_retains" ? half : outright,
    teamBTarget: tieRule === "team_b_retains" ? half : outright,
  };
}

export function competitionPointsNeeded(current: number, target: number): number {
  return Math.max(0, target - current);
}

export function competitionOutcome(
  currentA: number,
  currentB: number,
  schedule: CompetitionSchedule,
  tieRule: Competition["tie_rule"] = "shared",
): CompetitionOutcome {
  const remainingPoints = Math.max(0, schedule.totalPoints - currentA - currentB);
  const half = schedule.totalPoints / 2;
  const path = (current: number, opponent: number, target: number): CompetitionTeamOutcome => {
    const maxPoints = current + remainingPoints;
    const clinched = current + 1e-9 >= target;
    const canWin = clinched || maxPoints + 1e-9 >= target;
    const canShare = tieRule === "shared" && !canWin && maxPoints + 1e-9 >= half && opponent <= half + 1e-9;
    return { clinched, canWin, canShare, pointsNeeded: competitionPointsNeeded(current, target), maxPoints };
  };
  return {
    remainingPoints,
    teamA: path(currentA, currentB, schedule.teamATarget),
    teamB: path(currentB, currentA, schedule.teamBTarget),
  };
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

// Cup results stop at the first mathematical close-out. The ordinary scorecard
// engines and stored holes remain untouched; this only controls Cup aggregation.
function cupMatchStatus(progress: (number | null)[], holeCount: number) {
  const played = progress.filter((lead): lead is number => lead != null);
  if (!played.length) return { thru: 0, lead: 0, result: "", decided: false };
  for (let i = 0; i < played.length; i++) {
    const thru = i + 1, lead = played[i], remaining = holeCount - thru;
    if (remaining > 0 && Math.abs(lead) > remaining) return { thru, lead, result: `${Math.abs(lead)} & ${remaining}`, decided: true };
  }
  const thru = played.length, lead = played[played.length - 1];
  if (thru === holeCount) return { thru, lead, result: lead === 0 ? "Halved" : `${Math.abs(lead)} UP`, decided: true };
  return { thru, lead, result: "", decided: false };
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
      const st = cupMatchStatus(matchProgress(game.holes_meta, pa.scores || [], pb.scores || [], chBasis(pa, game.course_par, holesCount), chBasis(pb, game.course_par, holesCount), game.allowance_pct ?? 100), holesCount);
      const started = st.thru > 0;
      const decided = st.decided;
      const reversed = ta === "B" && tb === "A";
      const displayLead = reversed ? -st.lead : st.lead;
      const leftKey = reversed ? pr.b : pr.a;
      const rightKey = reversed ? pr.a : pr.b;
      out.matchCount++;
      if (decided) out.decidedCount++;
      if (started) award(out, st.lead, decided, ta, tb, pointsPerMatch);
      out.matches.push({ key: `pair-${i}`, leftNames: nameOf(leftKey), rightNames: nameOf(rightKey), thru: st.thru, lead: displayLead, result: st.result === "AS" ? "Halved" : st.result, started, decided, winnerTeam: displayLead === 0 ? null : (displayLead > 0 ? "A" : "B") });
    }
    return out;
  }

  if (game.game_type !== "fourball" && game.game_type !== "alt_shot" && game.game_type !== "trifecta") return out;
  for (const f of game.foursomes || []) {
    if (!f.a.length || !f.b.length) continue;
    const ta = teamOf(f.a[0]), tb = teamOf(f.b[0]);
    if (!ta || !tb || ta === tb) continue;
    let st: { thru: number; lead: number; result: string; decided: boolean } | null = null;
    if (game.game_type === "alt_shot") {
      if (f.a.length !== 2 || f.b.length !== 2) continue;
      const aRows = f.a.map(playerOf), bRows = f.b.map(playerOf);
      if (aRows.some((p) => !p) || bRows.some((p) => !p)) continue;
      const sides = altShotSides(game as never, players as never, f as never);
      const aLegacy = readAltShotSideScores(aRows[0]!.scores, aRows[1]!.scores, holesCount);
      const bLegacy = readAltShotSideScores(bRows[0]!.scores, bRows[1]!.scores, holesCount);
      const aGross = canonicalAltShotGross(altShotScores, f.id, "a", holesCount, aLegacy.gross);
      const bGross = canonicalAltShotGross(altShotScores, f.id, "b", holesCount, bLegacy.gross);
      st = cupMatchStatus(altShotProgress(game.holes_meta, { ids: f.a, chs: [sides.aCh, 0], gross: aGross } as never, { ids: f.b, chs: [sides.bCh, 0], gross: bGross } as never), holesCount);
    } else {
      const members: FourballMember[] = [...f.a, ...f.b].map((id) => {
        const p = playerOf(id);
        return { id, gross: p?.scores || [], ch: p ? chBasis(p, game.course_par, holesCount) : null, noShow: !!p?.no_show };
      });
      if (game.game_type === "trifecta") {
        if (f.a.length !== 2 || f.b.length !== 2) continue;
        const tri = computeTrifecta(game.holes_meta, members, f.a, f.b, game.allowance_pct ?? 100, "best_ball", !!f.swap, "match");
        for (let contestIndex = 0; contestIndex < tri.contests.length; contestIndex++) {
          const contest = tri.contests[contestIndex];
          let runningLead = 0;
          const progress = contest.perHole.map((hole) => {
            if (hole.r == null) return null;
            if (hole.r > 0) runningLead++;
            else if (hole.r < 0) runningLead--;
            return runningLead;
          });
          const contestStatus = cupMatchStatus(progress, holesCount);
          const started = contestStatus.thru > 0;
          const decided = contestStatus.decided;
          const reversed = ta === "B" && tb === "A";
          const displayLead = reversed ? -contestStatus.lead : contestStatus.lead;
          const leftIds = reversed ? contest.bIds : contest.aIds;
          const rightIds = reversed ? contest.aIds : contest.bIds;
          out.matchCount++;
          if (decided) out.decidedCount++;
          if (started) award(out, contestStatus.lead, decided, ta, tb, pointsPerMatch);
          out.matches.push({
            key: `${f.id}-${contest.kind}-${contestIndex}`,
            leftNames: leftIds.map(nameOf).join(" / "), rightNames: rightIds.map(nameOf).join(" / "),
            thru: contestStatus.thru, lead: displayLead,
            result: decided ? contestStatus.result : "", started, decided,
            winnerTeam: displayLead === 0 ? null : (displayLead > 0 ? "A" : "B"),
          });
        }
        continue;
      }
      st = cupMatchStatus(fourballProgress(game.holes_meta, members, f.a, f.b, game.allowance_pct ?? 100, game.team_score_mode === "aggregate" ? "aggregate" : "best_ball"), holesCount);
    }
    const started = st.thru > 0;
    const decided = st.decided;
    const reversed = ta === "B" && tb === "A";
    const displayLead = reversed ? -st.lead : st.lead;
    const leftIds = reversed ? f.b : f.a;
    const rightIds = reversed ? f.a : f.b;
    out.matchCount++;
    if (decided) out.decidedCount++;
    if (started) award(out, st.lead, decided, ta, tb, pointsPerMatch);
    out.matches.push({ key: f.id, leftNames: leftIds.map(nameOf).join(" / "), rightNames: rightIds.map(nameOf).join(" / "), thru: st.thru, lead: displayLead, result: decided ? (st.result === "AS" ? "Halved" : (st.result || "")) : "", started, decided, winnerTeam: displayLead === 0 ? null : (displayLead > 0 ? "A" : "B") });
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
