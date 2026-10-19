// A Cup session's recap: the Cup's overall standing after this session (209.5, owner-approved mock).
// Pure — the numbers are the Cup standings page's own (lib/competition): decided points only, counted over
// this session and the ones before it, against the Cup's schedule and tie rule.
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import { combineCompetitionScores, competitionOutcome, competitionSchedule, fmtCompetitionPoints, scoreCompetitionGame,
  type Competition, type CompetitionSession } from "@/lib/competition";
import { teamAccent } from "@/lib/game-colors";

export type CupSession = CompetitionSession & { game: Game | null; players: Player[]; altScores: AltShotScoreRow[] };
export type CupLine = {
  name: string; aName: string; bName: string; aColour: string; bColour: string;
  a: string; b: string;                 // formatted points ("9½")
  sessionNo: number; sessionCount: number | null; final: boolean;   // sessionCount null while the schedule isn't locked
  detail: string;                        // "12 points left · Red need 5 more to win, Blue need 8" / "🏆 …"
};

export function cupStandingAfter(competition: Competition, sessions: CupSession[], gameId: string): CupLine | null {
  const ordered = [...sessions].sort((x, y) => x.session_order - y.session_order);
  const idx = ordered.findIndex((s) => s.game_id === gameId);
  if (idx < 0) return null;
  const upTo = ordered.slice(0, idx + 1);
  const scores = upTo.map((s) => (s.game ? scoreCompetitionGame(s.game, s.players, s.altScores, Number(s.points_per_match || 1))
    : { projectedA: 0, projectedB: 0, decidedA: 0, decidedB: 0, matchCount: 0, decidedCount: 0, matches: [] }));
  const total = combineCompetitionScores(scores);
  const a = total.decidedA, b = total.decidedB;
  const tie = competition.tie_rule || "shared";
  const schedule = competitionSchedule(ordered, tie);
  const out = competitionOutcome(a, b, schedule, tie);
  const A = competition.team_a_name, B = competition.team_b_name, name = competition.name;
  const cur = scores[scores.length - 1];
  const final = idx === ordered.length - 1 && cur.matchCount > 0 && cur.decidedCount === cur.matchCount;
  const spare = ordered.length - (idx + 1);
  // An UNLOCKED Cup (schedule still a draft): the points total can change, so — like the Cup standings page —
  // no winner, clinch, shared Cup or "need" is declared; the secured score still shows. (209.6)
  if (competition.schedule_status !== "locked") {
    return { name, aName: A, bName: B, aColour: teamAccent(A, 0), bColour: teamAccent(B, 1), a: fmtCompetitionPoints(a), b: fmtCompetitionPoints(b),
      sessionNo: idx + 1, sessionCount: null, final: false, detail: "Schedule not locked yet — no winner until it is" };
  }
  let detail: string;
  if (final && out.remainingPoints < 1e-9) {
    if (a > b + 1e-9) detail = `🏆 ${A} won the ${name}`;
    else if (b > a + 1e-9) detail = `🏆 ${B} won the ${name}`;
    else detail = tie === "team_a_retains" ? `🏆 ${A} retain the ${name}` : tie === "team_b_retains" ? `🏆 ${B} retain the ${name}` : "The Cup is shared";
  } else if (out.teamA.clinched || out.teamB.clinched) {
    const who = out.teamA.clinched ? A : B;
    detail = `🏆 ${who} have won the Cup${spare > 0 ? ` — with ${spare} session${spare === 1 ? "" : "s"} to spare` : ""}`;
  } else {
    const need = (team: string, o: typeof out.teamA) => (o.canWin ? `${team} need ${fmtCompetitionPoints(o.pointsNeeded)} more to win` : `${team} can no longer win`);
    detail = `${fmtCompetitionPoints(out.remainingPoints)} point${Math.abs(out.remainingPoints - 1) < 1e-9 ? "" : "s"} left · ${need(A, out.teamA)}, ${need(B, out.teamB).replace(/ more to win$/, "")}`;
  }
  return { name, aName: A, bName: B, aColour: teamAccent(A, 0), bColour: teamAccent(B, 1),
    a: fmtCompetitionPoints(a), b: fmtCompetitionPoints(b), sessionNo: idx + 1, sessionCount: ordered.length, final, detail };
}
